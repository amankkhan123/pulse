using System.ComponentModel.DataAnnotations;

namespace Pulse.Models;

// One non-overlapping element placed on a room's collage board.
// Kind is one of: note | image | draw | stamp.
public class CanvasItem
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public string Kind { get; set; } = "note";

    // Position + size in board coordinates (top-left origin).
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }

    // note -> text, image/draw -> data URL, stamp -> emoji.
    [MaxLength(400_000)]
    public string Content { get; set; } = "";
    public string Color { get; set; } = "#f5eee2";

    // Soft ownership: a per-client key kept in the browser. Only the
    // owner may move or delete the element.
    public string OwnerKey { get; set; } = "";
    public string OwnerName { get; set; } = "anon";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
