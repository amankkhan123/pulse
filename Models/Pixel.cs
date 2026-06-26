namespace Pulse.Models;

// One coloured cell on a room's shared canvas.
public class Pixel
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public string Color { get; set; } = "#000000";
    public string ByName { get; set; } = "anon";
    public DateTime At { get; set; } = DateTime.UtcNow;
}
