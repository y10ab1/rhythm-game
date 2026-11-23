# Rhythm Master

A browser-based 4-key rhythm game. Play the built-in songs (generated with Google **Lyria 3.5**), or upload your own audio / MIDI — beats and charts are detected automatically in the browser. No installation required.

**Play now:** [https://guye.gamaniaocc.com/](https://guye.gamaniaocc.com/) (also on [GitHub Pages](https://y10ab1.github.io/rhythm-game/))

## Features

- **Upload your own songs** — MP3 / WAV / OGG / M4A / FLAC / MIDI (file picker or drag & drop). Songs and their analysis are kept in the browser (IndexedDB).
- **Automatic beat detection** — multi-band spectral-flux onset detection, tempo estimation with octave / 2:3 correction, a sub-millisecond beat-grid fit and drift correction for live recordings.
- **4 difficulties per song** — Easy / Normal / Hard / Expert with a level number, generated from the detected onsets snapped to the beat grid (16ths, or triplets for swung music), with chords and hold notes.
- **Gimmick notes** (Settings → 譜面 華麗 / 經典) — sweeps (Normal+: a staircase of steps along the melody), slides (Hard+: holds that bend into the next lane, the next key takes over) and scroll-speed changes per song section (Hard+, with a brake before the drop on Expert). Judging times never change.
- **Built-in songs** — 10 Lyria 3.5 tracks in different styles (synthwave, reggaeton, city pop, funk/disco, nu-disco, K-pop, electro house, chiptune, pop-punk, drum & bass; 90–175 BPM) plus Für Elise (a grid-exact MIDI arrangement, `tools/make_fur_elise.py`).
- **Accurate timing** — the song clock follows the audio hardware clock (`getOutputTimestamp`, output latency compensated), input is judged at the event timestamp, not the frame time.
- **Latency calibration** — tap-along calibration screen, plus a per-play suggestion based on your median hit offset.
- **Feedback** — instant hit sound on press, hit bursts, FAST/SLOW + ms readout, hit-error bar, beat lines and beat-synced visuals.
- **中文 / 日本語** — UI and 孤夜's lines in both; picked from the browser language, switchable on the title screen and in Settings, or linked directly with `?lang=ja` / `?lang=zh` (`js/i18n.js`).
- **Leaderboard** — global and per-song leaderboards powered by Cloudflare Workers + D1.
- **孤夜 + 黑白無常** — the on-stage character and her two robots (black and white). Every built-in song has its own 3D music video (3 clips + a FEVER clip) that plays behind the lanes once you hold a 30 combo; uploaded songs get a mix of all of them.

## Controls

| Input | Action |
|-------|--------|
| `D` `F` `J` `K` (rebindable) | Hit lanes 1-4 |
| `ESC` | Pause / Resume |
| `↑` `↓` `←` `→` `Enter` | Song select: song, difficulty, start |
| `R` | Retry on the results screen |
| Touch | Tap / slide on the lanes |

Judgement windows: Perfect ±42 ms, Great ±85 ms, Good ±130 ms.

## Project layout

```
index.html            markup
css/style.css         styles
js/main.js            menus, library, uploads, settings, calibration, leaderboard
js/game.js            gameplay: clock, judging, rendering
js/audio.js           Web Audio engine (latency-aware clock, hit sounds, music, MIDI synth)
js/analyzer.js        beat / onset detection (pure JS, runs in a Worker and in Node)
js/chart.js           chart generation per difficulty
js/midi.js            MIDI parser
js/storage.js         IndexedDB for uploaded songs + analysis cache
js/character.js       孤夜, her robots, per-song MV player, FEVER cut-in
js/i18n.js            UI language (中文 / 日本語): strings, character lines, font stack
songs/                built-in songs + manifest.json
assets/guye/          character art, robot sprite sheets; mv/ = per-song MV clips + manifest.json
tools/                Lyria + MV generation, manifest build, analyzer tests
```

## Tools

```bash
# generate the built-in songs with Lyria 3.5 (needs GEMINI_API_KEY)
python3 tools/generate_lyria.py

# generate the per-song MVs with Gemini image + Omni video (needs GEMINI_API_KEY and ffmpeg):
# keyframes -> review tools/mv_work/kf/ (delete bad ones and rerun) -> clips -> encode -> track -> manifest
python3 tools/generate_mv.py keyframes
python3 tools/generate_mv.py all            # or: all <song_id ...>

# rebuild songs/manifest.json (BPM, length, levels) — needs ffmpeg
node tools/build_manifest.mjs

# beat-detection accuracy test (synthetic drums, or real files)
node tools/test_analyzer.mjs
node tools/test_analyzer.mjs songs/*.mp3

# chart statistics per song / difficulty
node tools/chart_report.mjs
```

## Deployment

The game is a static site; to run it locally serve the folder over HTTP (ES modules do not load from `file://`):

```bash
python3 -m http.server 8000
```

The 孤夜 art and MVs (`assets/`) are not in the repo (private sources, ~760 MB of video); they live in the
R2 bucket `guye-rhythm-assets`, served at `https://guye.gamaniaocc.com/assets/...`.

| Push to `master` | Deploys | How |
|---|---|---|
| any change | GitHub Pages | `.github/workflows/pages.yml`; `assets/guye/` paths are rewritten to load from guye.gamaniaocc.com |
| `index.html`, `css/`, `js/`, `songs/`, `site/` | **guye.gamaniaocc.com** (Cloudflare Worker `guye-rhythm`, Workers Static Assets + R2) | `.github/workflows/site.yml` (repo secret `CLOUDFLARE_API_TOKEN`) |

```bash
python3 tools/sync_assets.py --dry-run   # which art / MV files changed
python3 tools/sync_assets.py             # upload them to R2 (uses your wrangler login or CLOUDFLARE_API_TOKEN)
cd site && npx wrangler@4 deploy         # deploy the site by hand
```

`.assetsignore` keeps everything but `index.html`, `css/`, `js/` and `songs/` out of the static upload.

### Leaderboard API (Cloudflare)

```bash
cd worker
wrangler d1 create rhythm-game-leaderboard     # copy database_id into wrangler.toml
wrangler d1 execute rhythm-game-leaderboard --file=schema.sql --remote
wrangler deploy
```

Set `API_BASE` in `js/main.js` to the Worker URL.

## License

MIT. Built-in tracks were generated with Google Lyria; the MV clips with Gemini image models and Gemini Omni.
