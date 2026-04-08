# MIDI Rhythm Master

A browser-based rhythm game that plays MIDI files. No installation required — just open and play.

**Play now:** [https://y10ab1.github.io/rhythm-game/](https://y10ab1.github.io/rhythm-game/)

## Features

- **MIDI file support** — Load any `.mid` / `.midi` file and play it as a rhythm game
- **Built-in songs** — Fur Elise (Beethoven), plus two demo tracks (Pulse, Storm)
- **4-lane gameplay** — MIDI pitches are automatically mapped to 4 lanes
- **Difficulty settings** — Easy / Normal / Hard with adjustable note speed
- **Hold notes** — Long notes that require sustained input
- **Scoring system** — Perfect / Great / Good / Miss judgments with combo multiplier
- **Audio engine** — Real-time synth playback via Web Audio API, synced to AudioContext clock
- **Touch & keyboard** — Works on desktop (D F J K keys) and mobile (tap lanes)
- **Leaderboard** — Global and per-song leaderboards powered by Cloudflare Workers + D1

## Controls

| Input | Action |
|-------|--------|
| `D` `F` `J` `K` | Hit lanes 1-4 |
| `ESC` | Pause / Resume |
| Touch | Tap lanes directly on mobile |

## How It Works

1. MIDI files are parsed in-browser (no server needed)
2. Notes are mapped to 4 lanes based on pitch distribution
3. A per-lane and global minimum gap filter ensures playability
4. Game timing is driven by `AudioContext.currentTime` for precise audio-visual sync
5. MIDI playback emphasizes game notes over filtered accompaniment notes

## Tech Stack

- **Frontend:** Single `index.html` — vanilla JS, Canvas 2D, Web Audio API. No dependencies.
- **Backend (Leaderboard):** Cloudflare Workers + D1 (SQLite). See `worker/` directory.

## Deployment

### Frontend (GitHub Pages)

Pushes to `master` auto-deploy via `.github/workflows/pages.yml`.

### Leaderboard API (Cloudflare)

Requires [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and a Cloudflare account.

```bash
cd worker

# Create the D1 database
wrangler d1 create rhythm-game-leaderboard
# Copy the database_id from the output into wrangler.toml

# Initialize the schema
wrangler d1 execute rhythm-game-leaderboard --file=schema.sql --remote

# Deploy the Worker
wrangler deploy
```

After deploying, copy the Worker URL and set `API_BASE` in `index.html`:

```js
const API_BASE = 'https://rhythm-game-api.<your-subdomain>.workers.dev';
```

## License

MIT
