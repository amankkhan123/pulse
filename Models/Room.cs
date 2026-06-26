using System.ComponentModel.DataAnnotations;

namespace Pulse.Models;

public class Room
{
    public int Id { get; set; }

    // Short shareable code used in the room URL, e.g. /room/ABCDE
    [Required]
    public string Code { get; set; } = string.Empty;

    [Required]
    public string Name { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
