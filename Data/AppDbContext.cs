using Microsoft.EntityFrameworkCore;
using Pulse.Models;

namespace Pulse.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<CanvasItem> CanvasItems => Set<CanvasItem>();
    public DbSet<Poll> Polls => Set<Poll>();
    public DbSet<PollOption> PollOptions => Set<PollOption>();
    public DbSet<Vote> Votes => Set<Vote>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageVote> MessageVotes => Set<MessageVote>();
}
