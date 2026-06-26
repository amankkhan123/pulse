using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Pulse.Data;
using Pulse.Models;

namespace Pulse.Hubs;

// The single real-time hub that powers every live panel in a room.
public class PulseHub : Hub
{
    // connectionId -> (room code, display name). Lives for the process; presence only.
    private static readonly ConcurrentDictionary<string, (string Room, string Name)> Connections = new();

    // connectionId -> last placement time, for a light anti-spam cooldown.
    private static readonly ConcurrentDictionary<string, DateTime> LastPlace = new();

    // The board is a fixed coordinate space; every client matches these.
    private const double BoardW = 900, BoardH = 560, Gap = 8, MinSize = 20, MaxSize = 360;
    private const int PlaceCooldownMs = 450;
    private static readonly string[] AllowedKinds = { "note", "image", "draw", "stamp" };

    // Axis-aligned overlap test with a small gap so items never touch.
    private static bool Overlaps(CanvasItem a, double x, double y, double w, double h)
        => !(a.X + a.Width + Gap <= x || x + w + Gap <= a.X
          || a.Y + a.Height + Gap <= y || y + h + Gap <= a.Y);

    private static object Payload(CanvasItem i) => new
    {
        id = i.Id, kind = i.Kind, x = i.X, y = i.Y, width = i.Width, height = i.Height,
        content = i.Content, color = i.Color, ownerName = i.OwnerName, ownerKey = i.OwnerKey
    };

    private readonly AppDbContext _db;
    public PulseHub(AppDbContext db) => _db = db;

    private string MyName => Connections.TryGetValue(Context.ConnectionId, out var c) ? c.Name : "anon";

    public async Task JoinRoom(string roomCode, string displayName)
    {
        displayName = string.IsNullOrWhiteSpace(displayName) ? "guest" : displayName.Trim();
        await Groups.AddToGroupAsync(Context.ConnectionId, roomCode);
        Connections[Context.ConnectionId] = (roomCode, displayName);
        await BroadcastPresence(roomCode);
    }

    // Place a new element. Server-authoritative: validates size/bounds/content,
    // enforces the cooldown, and rejects anything that would overlap (first-claim-wins).
    public async Task PlaceItem(string roomCode, string ownerKey, string kind,
        double x, double y, double width, double height, string content, string color)
    {
        var room = await _db.Rooms.FirstOrDefaultAsync(r => r.Code == roomCode);
        if (room == null) return;

        var now = DateTime.UtcNow;
        if (LastPlace.TryGetValue(Context.ConnectionId, out var last)
            && (now - last).TotalMilliseconds < PlaceCooldownMs)
        {
            await Clients.Caller.SendAsync("ItemRejected", new { reason = "One moment — placing too fast." });
            return;
        }

        kind = (kind ?? "").Trim().ToLowerInvariant();
        if (Array.IndexOf(AllowedKinds, kind) < 0) return;
        if (width < MinSize || height < MinSize || width > MaxSize || height > MaxSize) return;

        content ??= "";
        if (kind == "note")
        {
            content = content.Trim();
            if (content.Length == 0) return;
            if (content.Length > 180) content = content[..180];
        }
        else if (kind == "stamp")
        {
            if (content.Length == 0 || content.Length > 16) return;
        }
        else // image | draw -> data URL
        {
            if (!content.StartsWith("data:image/")) return;
            if (content.Length > 400_000)
            {
                await Clients.Caller.SendAsync("ItemRejected", new { reason = "Image is too large." });
                return;
            }
        }

        color = string.IsNullOrWhiteSpace(color) ? "#f5eee2" : color.Trim();
        if (color.Length > 9) color = color[..9];

        // Keep the element fully inside the board.
        x = Math.Clamp(x, 0, Math.Max(0, BoardW - width));
        y = Math.Clamp(y, 0, Math.Max(0, BoardH - height));

        var existing = await _db.CanvasItems.Where(i => i.RoomId == room.Id).ToListAsync();
        if (existing.Any(a => Overlaps(a, x, y, width, height)))
        {
            await Clients.Caller.SendAsync("ItemRejected", new { reason = "That spot's taken — try an empty area." });
            return;
        }

        var item = new CanvasItem
        {
            RoomId = room.Id, Kind = kind, X = x, Y = y, Width = width, Height = height,
            Content = content, Color = color, OwnerKey = ownerKey ?? "", OwnerName = MyName, CreatedAt = now
        };
        _db.CanvasItems.Add(item);
        await _db.SaveChangesAsync();
        LastPlace[Context.ConnectionId] = now;

        await Clients.Group(roomCode).SendAsync("ItemPlaced", Payload(item));
    }

    // Move an element you own. Re-validates bounds and overlap against everything else.
    public async Task MoveItem(int itemId, string ownerKey, double x, double y)
    {
        var item = await _db.CanvasItems.FindAsync(itemId);
        if (item == null) return;
        var room = await _db.Rooms.FindAsync(item.RoomId);
        if (room == null) return;

        if (item.OwnerKey != (ownerKey ?? ""))
        {
            await Clients.Caller.SendAsync("ItemRejected", new { reason = "Only the owner can move this.", id = item.Id, x = item.X, y = item.Y });
            return;
        }

        x = Math.Clamp(x, 0, Math.Max(0, BoardW - item.Width));
        y = Math.Clamp(y, 0, Math.Max(0, BoardH - item.Height));

        var others = await _db.CanvasItems.Where(i => i.RoomId == item.RoomId && i.Id != item.Id).ToListAsync();
        if (others.Any(a => Overlaps(a, x, y, item.Width, item.Height)))
        {
            await Clients.Caller.SendAsync("ItemRejected", new { reason = "Can't drop there — it overlaps.", id = item.Id, x = item.X, y = item.Y });
            return;
        }

        item.X = x; item.Y = y;
        await _db.SaveChangesAsync();
        await Clients.Group(room.Code).SendAsync("ItemMoved", item.Id, item.X, item.Y);
    }

    // Delete an element you own.
    public async Task RemoveItem(int itemId, string ownerKey)
    {
        var item = await _db.CanvasItems.FindAsync(itemId);
        if (item == null) return;
        if (item.OwnerKey != (ownerKey ?? "")) return;

        var room = await _db.Rooms.FindAsync(item.RoomId);
        _db.CanvasItems.Remove(item);
        await _db.SaveChangesAsync();
        if (room != null) await Clients.Group(room.Code).SendAsync("ItemRemoved", itemId);
    }

    public async Task PostMessage(string roomCode, string text)
    {
        text = (text ?? string.Empty).Trim();
        if (text.Length == 0) return;
        if (text.Length > 280) text = text[..280];

        var room = await _db.Rooms.FirstOrDefaultAsync(r => r.Code == roomCode);
        if (room == null) return;

        var msg = new Message { RoomId = room.Id, Author = MyName, Text = text, CreatedAt = DateTime.UtcNow };
        _db.Messages.Add(msg);
        await _db.SaveChangesAsync();

        await Clients.Group(roomCode).SendAsync("MessagePosted", msg.Id, msg.Author, msg.Text, msg.Upvotes);
    }

    public async Task UpvoteMessage(int messageId)
    {
        var msg = await _db.Messages.FindAsync(messageId);
        if (msg == null) return;

        if (!await _db.MessageVotes.AnyAsync(v => v.MessageId == messageId && v.VoterKey == Context.ConnectionId))
        {
            _db.MessageVotes.Add(new MessageVote { MessageId = messageId, VoterKey = Context.ConnectionId });
            msg.Upvotes++;
            await _db.SaveChangesAsync();
        }

        var room = await _db.Rooms.FindAsync(msg.RoomId);
        if (room != null)
            await Clients.Group(room.Code).SendAsync("MessageUpdated", msg.Id, msg.Upvotes);
    }

    public async Task CreatePoll(string roomCode, string question, string[] options)
    {
        var room = await _db.Rooms.FirstOrDefaultAsync(r => r.Code == roomCode);
        if (room == null) return;

        question = (question ?? string.Empty).Trim();
        var opts = (options ?? Array.Empty<string>())
            .Select(o => (o ?? string.Empty).Trim())
            .Where(o => o.Length > 0)
            .Take(6)
            .ToList();
        if (question.Length == 0 || opts.Count < 2) return;

        var poll = new Poll
        {
            RoomId = room.Id,
            Question = question,
            IsOpen = true,
            CreatedAt = DateTime.UtcNow,
            Options = opts.Select(t => new PollOption { Text = t }).ToList()
        };
        _db.Polls.Add(poll);
        await _db.SaveChangesAsync();

        await Clients.Group(roomCode).SendAsync("PollCreated", new
        {
            id = poll.Id,
            question = poll.Question,
            isOpen = poll.IsOpen,
            options = poll.Options.Select(o => new { id = o.Id, text = o.Text, votes = o.Votes })
        });
    }

    public async Task Vote(int pollId, int optionId)
    {
        var poll = await _db.Polls.Include(p => p.Options).FirstOrDefaultAsync(p => p.Id == pollId);
        if (poll == null || !poll.IsOpen) return;

        var option = poll.Options.FirstOrDefault(o => o.Id == optionId);
        if (option == null) return;

        if (!await _db.Votes.AnyAsync(v => v.PollId == pollId && v.VoterKey == Context.ConnectionId))
        {
            _db.Votes.Add(new Vote { PollId = pollId, PollOptionId = optionId, VoterKey = Context.ConnectionId });
            option.Votes++;
            await _db.SaveChangesAsync();
        }

        var room = await _db.Rooms.FindAsync(poll.RoomId);
        if (room != null)
            await Clients.Group(room.Code).SendAsync("PollUpdated", poll.Id, poll.Options.Select(o => new { id = o.Id, votes = o.Votes }));
    }

    public async Task ClosePoll(int pollId)
    {
        var poll = await _db.Polls.FindAsync(pollId);
        if (poll == null) return;

        poll.IsOpen = false;
        await _db.SaveChangesAsync();

        var room = await _db.Rooms.FindAsync(poll.RoomId);
        if (room != null)
            await Clients.Group(room.Code).SendAsync("PollClosed", poll.Id);
    }

    public Task SendReaction(string roomCode, string emoji)
        => Clients.Group(roomCode).SendAsync("ReactionSent", emoji, MyName);

    public Task MoveCursor(string roomCode, double x, double y)
        => Clients.OthersInGroup(roomCode).SendAsync("CursorMoved", Context.ConnectionId, MyName, x, y);

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Connections.TryRemove(Context.ConnectionId, out var info))
        {
            await Clients.Group(info.Room).SendAsync("CursorGone", Context.ConnectionId);
            await BroadcastPresence(info.Room);
        }
        await base.OnDisconnectedAsync(exception);
    }

    private Task BroadcastPresence(string roomCode)
    {
        var names = Connections.Values.Where(v => v.Room == roomCode).Select(v => v.Name).ToList();
        return Clients.Group(roomCode).SendAsync("PresenceUpdated", names.Count, names);
    }
}
