# Rhythm Master

A browser-based 4-key rhythm game. Play the built-in songs (generated with Google **Lyria 3.5**), or upload your own audio / MIDI — beats and charts are detected automatically in the browser. No installation required.

**Play now:** [https://guye.gamaniaocc.com/](https://guye.gamaniaocc.com/) (also on [GitHub Pages](https://y10ab1.github.io/rhythm-game/))

## Features

- **Upload your own songs** — MP3 / WAV / OGG / M4A / FLAC / MIDI (file picker or drag & drop). Songs and their analysis are kept in the browser (IndexedDB).
- **Automatic beat detection** — multi-band spectral-flux onset detection, tempo estimation with octave / 2:3 correction, a sub-millisecond beat-grid fit and drift correction for live recordings.
- **4 difficulties per song** — Easy / Normal / Hard / Expert with a level number, generated from the detected onsets snapped to the beat grid (16ths, or triplets for swung music), with chords and hold notes.
- **Gimmick notes** (Settings → 譜面 華麗 / 經典) — sweeps (Normal+: a staircase of steps along the melody), slides (Hard+: holds that bend into the next lane, the next key takes over) and scroll-speed changes per song section (Hard+, with a brake before the drop on Expert). Judging times never change.
- **Built-in songs** — 孤夜's own song 《星空的歸途》 (music & lyrics: Luci, Gamania; from the [official MV](https://www.youtube.com/watch?v=S2Uni6OgNSU)), 10 Lyria 3.5 tracks in different styles (synthwave, reggaeton, city pop, funk/disco, nu-disco, K-pop, electro house, chiptune, pop-punk, drum & bass; 90–175 BPM).
- **Accurate timing** — the song clock follows the audio hardware clock (`getOutputTimestamp`, output latency compensated), input is judged at the event timestamp, not the frame time.
- **Tutorial** (title screen) — a short demo chart plays itself, then the player plays it; their median hit offset becomes a one-tap offset fix.
- **Latency calibration** — tap-along calibration screen, plus a per-play suggestion based on your median hit offset.
- **Feedback** — instant hit sound on press, hit bursts, FAST/SLOW + ms readout, hit-error bar, beat lines and beat-synced visuals.
- **中文 / 日本語** — UI and 孤夜's lines in both; picked from the browser language, switchable on the title screen and in Settings, or linked directly with `?lang=ja` / `?lang=zh` (`js/i18n.js`).
- **Leaderboard** — global and per-song leaderboards powered by Cloudflare Workers + D1.
- **Play log** — every play is logged anonymously (result, settings, per-note timing) for tuning the charts; see [Play log](#play-log).
- **孤夜 + 黑白無常** — the on-stage character and her two robots (black and white). Every built-in song has its own 3D music video (3 clips + a FEVER clip) that plays behind the lanes once you hold a 30 combo; uploaded songs get a mix of all of them. Starlight Stage and 《星空的歸途》 instead have a full-length 3D dance performance by 孤夜, synced to the song (`tools/dance`).

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
js/chart.js           chart generation per difficulty (follows the lead melody when there is one)
js/lead.js            in-browser lead-melody estimate for uploaded songs (predominant pitch tracking)
js/midi.js            MIDI parser
js/storage.js         IndexedDB for uploaded songs + analysis cache
js/character.js       孤夜, her robots, per-song MV player, FEVER cut-in
js/i18n.js            UI language (中文 / 日本語): strings, character lines, font stack
songs/                built-in songs + manifest.json; <id>.lead.json = offline lead-melody transcription
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

# 3D dance performance (孤夜 VRM on the 3D stage, AIST++ motion), e.g. for xingkong-de-guitu:
# song structure in tools/dance/timelines.js (sections, cameras, moods) + PLANS_AIST in tools/dance/mocap_prep.py
node tools/dance/analyze.mjs songs/xingkong-de-guitu.mp3 tools/mv_work/dance/xingkong-de-guitu.json
python -I tools/dance/mocap_prep.py aist <aist_dir> <aist_dir>/beats.json tools/mv_work/dance/xingkong-de-guitu.json \
  <guyeh>/3D/孤夜/Guye1_1.vrm tools/mv_work/dance/mocap/xingkong-de-guitu_aist.json
W=2560 H=1440 FLAGS="mocap=xingkong-de-guitu_aist&frame=center" node tools/dance/render.mjs game xingkong-de-guitu
W=1080 H=1920 FLAGS="mocap=xingkong-de-guitu_aist&frame=portrait" node tools/dance/render.mjs game xingkong-de-guitu
python3 tools/dance/export_game.py xingkong-de-guitu    # -> assets/guye/mv/ + manifest, then tools/sync_assets.py

# lead melody of the built-in songs -> songs/<id>.lead.json (Demucs stems + basic-pitch, GPU; setup in the
# script's docstring, a venv at ~/.venvs/lead). --preview also writes /tmp/lead-preview/<id>.wav (song + sine lead)
~/.venvs/lead/bin/python tools/lead/extract_lead.py            # or: <song_id ...> [--preview]

# rebuild songs/manifest.json (BPM, length, levels; picks up songs/<id>.lead.json) — needs ffmpeg
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

Set `API_BASE` in `js/main.js` to the Worker URL. The worker is deployed by hand (not by CI).

### Play log

Every play (cleared, failed, quit, retried or closed mid-song) sends one record to `POST /api/play`, stored in
the D1 table `plays` (see `worker/schema.sql`): result, settings, keyboard/touch, screen, country and each reached
note's timing (`[ms, lane, offset or null = miss, flags]`). Anonymous (a random browser id, no IP); players can turn
it off in Settings (提供遊玩數據). Not sent for `?auto=1` / `?debug=1`. About 8–25 KB per full play.

```bash
cd worker
Q() { npx wrangler@4 d1 execute rhythm-game-leaderboard --remote --command "$1"; }
# plays per day, players, clears
Q "SELECT date(created_at) d, COUNT(*) plays, COUNT(DISTINCT client_id) players, SUM(outcome='clear') clears FROM plays GROUP BY d ORDER BY d DESC LIMIT 14"
# per song + difficulty: clear rate, quit rate, average accuracy, where people quit
Q "SELECT song_id, difficulty, COUNT(*) n, ROUND(AVG(outcome='clear')*100) clear_pct, ROUND(AVG(outcome IN ('quit','retry','closed'))*100) quit_pct,
     ROUND(AVG(accuracy),1) acc, ROUND(AVG(CASE WHEN outcome!='clear' THEN song_ms*100.0/end_ms END)) quit_at_pct FROM plays GROUP BY 1,2 ORDER BY 1,2"
# hardest moments of a chart: miss rate per second of the song
Q "SELECT j.value->>0/1000 sec, COUNT(*) n, ROUND(AVG(j.value->>2 IS NULL)*100) miss_pct FROM plays, json_each(plays.notes) j
     WHERE song_id='skyline-run' AND difficulty='hard' GROUP BY sec HAVING n>=5 ORDER BY miss_pct DESC LIMIT 20"
# keyboard vs touch, and median timing offset (calibration)
Q "SELECT input, COUNT(*) n, ROUND(AVG(accuracy),1) acc, ROUND(AVG(median_offset)) offset FROM plays GROUP BY input"
```

## License

MIT for the code. 《星空的歸途》 (`songs/xingkong-de-guitu.mp3`) belongs to Gamania and is not covered by the MIT license; the other built-in tracks were generated with Google Lyria; the MV clips with Gemini image models and Gemini Omni.
