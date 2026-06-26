using System.ComponentModel.DataAnnotations;

namespace Pulse.Models;

public class Poll
{
    public int Id { get; set; }
    public int RoomId { get; set; }

    [Required]
    public string Question { get; set; } = string.Empty;

    public bool IsOpen { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<PollOption> Options { get; set; } = new();
}

public class PollOption
{
    public int Id { get; set; }
    public int PollId { get; set; }
    public string Text { get; set; } = string.Empty;

    // Denormalised running count so live updates are cheap to broadcast.
    public int Votes { get; set; }
}

// Records one vote so a given connection can only vote once per poll.
public class Vote
{
    public int Id { get; set; }
    public int PollId { get; set; }
    public int PollOptionId { get; set; }
    public string VoterKey { get; set; } = string.Empty;
}
