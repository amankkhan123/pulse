using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Pulse.Data;
using Pulse.Models;
using System.Text.Json;

namespace Pulse.Controllers;

public class RoomsController : Controller
{
    private readonly AppDbContext _db;
    public RoomsController(AppDbContext db) => _db = db;

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(string name)
    {
        name = string.IsNullOrWhiteSpace(name) ? "Untitled room" : name.Trim();
        var code = await GenerateCodeAsync();
        _db.Rooms.Add(new Room { Code = code, Name = name, CreatedAt = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        return Redirect($"/room/{code}");
    }

    [HttpPost]
    public IActionResult Join(string code)
    {
        code = (code ?? string.Empty).Trim().ToUpperInvariant();
        return Redirect($"/room/{code}");
    }

    [HttpGet("/room/{code}")]
    public async Task<IActionResult> Room(string code)
    {
        code = (code ?? string.Empty).Trim().ToUpperInvariant();
        var room = await _db.Rooms.FirstOrDefaultAsync(r => r.Code == code);
        if (room == null)
            return View("RoomNotFound", code);

        var items = await _db.CanvasItems.Where(i => i.RoomId == room.Id).OrderBy(i => i.Id)
            .Select(i => new
            {
                id = i.Id, kind = i.Kind, x = i.X, y = i.Y, width = i.Width, height = i.Height,
                content = i.Content, color = i.Color, ownerName = i.OwnerName, ownerKey = i.OwnerKey
            }).ToListAsync();

        var polls = await _db.Polls.Where(p => p.RoomId == room.Id).Include(p => p.Options)
            .Select(p => new
            {
                id = p.Id,
                question = p.Question,
                isOpen = p.IsOpen,
                options = p.Options.Select(o => new { id = o.Id, text = o.Text, votes = o.Votes })
            }).ToListAsync();

        var messages = await _db.Messages.Where(m => m.RoomId == room.Id)
            .OrderByDescending(m => m.Upvotes).ThenByDescending(m => m.Id)
            .Select(m => new { id = m.Id, author = m.Author, text = m.Text, upvotes = m.Upvotes }).ToListAsync();

        ViewData["InitialState"] = JsonSerializer.Serialize(new { items, polls, messages, board = new { w = 900, h = 560 } });
        return View(room);
    }

    private async Task<string> GenerateCodeAsync()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        string code;
        do
        {
            code = new string(Enumerable.Range(0, 5).Select(_ => chars[Random.Shared.Next(chars.Length)]).ToArray());
        }
        while (await _db.Rooms.AnyAsync(r => r.Code == code));
        return code;
    }
}
