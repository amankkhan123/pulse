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

    public async Task PlacePixel(string roomCode, int x, int y, string color)
    {
        var room = await _db.Rooms.FirstOrDefaultAsync(r => r.Code == roomCode);
        if (room == null) return;

        var px = await _db.Pixels.FirstOrDefaultAsync(p => p.RoomId == room.Id && p.X == x && p.Y == y);
        if (px == null)
        {
            _db.Pixels.Add(new Pixel { RoomId = room.Id, X = x, Y = y, Color = color, ByName = MyName, At = DateTime.UtcNow });
        }
        else
        {
            px.Color = color;
            px.ByName = MyName;
            px.At = DateTime.UtcNow;
        }
        await _db.SaveChangesAsync();

        await Clients.Group(roomCode).SendAsync("PixelPlaced", x, y, color, MyName);
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
