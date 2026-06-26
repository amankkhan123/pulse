# Pulse

A real-time, multiplayer **room** where everyone draws, votes, asks, and reacts
together &mdash; live. Built with **ASP.NET Core MVC** and **SignalR** for a
3rd-year Web Development project.

Open a room, share the link, and everyone in it sees each other's actions
instantly &mdash; no refresh.

## What's live in a room
- **Shared canvas** &mdash; place coloured pixels; the artwork forms in real time
- **Live polls** &mdash; launch a poll; the vote bars update live for everyone
- **Live Q&A** &mdash; post questions, upvote, and the list re-sorts live by votes
- **Reactions** &mdash; floating emoji everyone sees
- **Presence + live cursors** &mdash; who's here, and where their cursor is on the canvas
- **Export** the canvas to a PNG

## Tech stack
- ASP.NET Core **MVC (.NET 8)**
- **SignalR** for real-time multi-user updates (a single `PulseHub`)
- **Entity Framework Core** (code-first) with **SQLite**

## Running locally
```bash
dotnet restore
dotnet run
```
Open the URL shown (e.g. `http://localhost:5090`), create a room, then open the
room link in a **second browser tab** to watch everything update in real time.

## Project structure
| Path | Purpose |
|------|---------|
| `Hubs/PulseHub.cs` | the SignalR hub &mdash; every real-time action |
| `Controllers/RoomsController.cs` | create / join / render a room |
| `Models/` | `Room`, `Pixel`, `Poll`, `Message` |
| `Data/AppDbContext.cs` | EF Core database context |
| `wwwroot/js/pulse.js` | the real-time browser client |
