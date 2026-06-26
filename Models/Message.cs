using System.ComponentModel.DataAnnotations;

namespace Pulse.Models;

// A question / message on the room's live Q&A wall.
public class Message
{
    public int Id { get; set; }
    public int RoomId { get; set; }

    [Required]
    public string Author { get; set; } = "anon";

    [Required]
    public string Text { get; set; } = string.Empty;

    public int Upvotes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Records one upvote so a connection can only upvote a message once.
public class MessageVote
{
    public int Id { get; set; }
    public int MessageId { get; set; }
    public string VoterKey { get; set; } = string.Empty;
}
