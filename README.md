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

Single `index.html` file — vanilla JS, Canvas 2D, Web Audio API. No dependencies.

## Deployment

Pushes to `master` auto-deploy to GitHub Pages via the included workflow (`.github/workflows/pages.yml`).

## License

MIT
