#!/usr/bin/env python3
"""Generate the built-in songs with Google Lyria (Gemini API).

Usage:
    GEMINI_API_KEY=... python3 tools/generate_lyria.py [song_id ...]

Writes songs/<id>.mp3. Run tools/build_charts.mjs afterwards to analyse
the audio and write the charts + songs/manifest.json.
"""
import base64
import concurrent.futures as cf
import json
import os
import sys
import urllib.request

MODEL = os.environ.get("LYRIA_MODEL", "lyria-3.5")
API = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "songs")

COMMON = (
    "Instrumental only, absolutely no vocals or singing. "
    "Keep a perfectly steady tempo from start to finish with no tempo changes, "
    "no rubato and no free-time intro: the beat starts within the first two seconds. "
    "Crisp, clearly defined drum hits and rhythmic accents that are easy to tap along to. "
    "Total length about 1 minute 45 seconds, with a clean ending."
)

SONGS = {
    "neon-drift": (
        "A relaxed, warm synthwave / chillwave track at exactly 88 BPM in 4/4. "
        "Soft punchy kick on every beat, snare on beats 2 and 4, gentle shimmering arpeggios, "
        "lush retro pads and a simple catchy lead melody. Structure: short intro, verse, "
        "chorus, breakdown, final chorus, outro."
    ),
    "skyline-run": (
        "An upbeat, bright funky nu-disco / electro-pop track at exactly 116 BPM in 4/4. "
        "Four-on-the-floor kick, tight claps on 2 and 4, groovy slap bass line, "
        "chopped funky guitar stabs, sparkling synth hooks. Structure: intro, groove, "
        "build-up, chorus drop, bridge, final chorus, outro."
    ),
    "voltage-rush": (
        "A high-energy electro house / big-room EDM track at exactly 140 BPM in 4/4. "
        "Hard four-on-the-floor kick, sharp claps, driving off-beat bass, rapid sixteenth-note "
        "synth riffs, snare-roll build-ups and powerful drops. Structure: intro, build-up, drop, "
        "breakdown, build-up, second bigger drop, outro."
    ),
    "hyper-circuit": (
        "An intense, fast liquid / neurofunk drum and bass track at exactly 174 BPM in 4/4. "
        "Breakbeat drums with crisp snares on beats 2 and 4, rolling sub bass, fast "
        "syncopated hi-hats, aggressive reese bass stabs and a soaring synth lead. Structure: "
        "short intro, build-up, drop, breakdown, second drop, outro."
    ),
    "sunset-boulevard": (
        "A groovy 1980s Japanese city pop instrumental at exactly 106 BPM in 4/4. "
        "Tight live-sounding drums, punchy slap bass, bright electric piano chords, funky clean "
        "guitar cutting, brass section hits and a catchy synth lead melody. Structure: intro, "
        "verse, pre-chorus, chorus, guitar solo, final chorus, outro."
    ),
    "groove-machine": (
        "A tight, danceable 1970s funk / disco instrumental at exactly 112 BPM in 4/4. "
        "Four-on-the-floor kick, open hi-hats on the off-beats, syncopated funky bass riffs, "
        "chicken-scratch guitar, punchy horn stabs and string swells. Structure: intro, groove, "
        "horn break, chorus, bass break, final chorus, outro."
    ),
    "starlight-stage": (
        "An energetic K-pop dance instrumental at exactly 124 BPM in 4/4. "
        "Hard-hitting dance drums with claps, deep 808 bass, glossy synth chords, "
        "a memorable synth hook, rhythmic vocal-chop-like synth stabs (no real vocals) and a "
        "powerful dance-break drop. Structure: intro, verse, pre-chorus build, chorus drop, "
        "dance break, final chorus, outro."
    ),
    "pixel-quest": (
        "An upbeat 8-bit chiptune video game boss-battle track at exactly 150 BPM in 4/4. "
        "Square-wave lead melody with fast arpeggios, triangle bass, punchy noise-channel drums "
        "with clear kick and snare. Structure: intro fanfare, main theme, faster arpeggio "
        "section, bridge, main theme reprise, victory outro."
    ),
    "neon-riot": (
        "A fast, high-energy pop-punk / J-rock instrumental at exactly 168 BPM in 4/4. "
        "Driving live drums with loud snare backbeats and crash accents, distorted power-chord "
        "guitars, melodic lead guitar riffs and a pumping bass. Structure: intro riff, verse, "
        "chorus, guitar solo, breakdown, final chorus, outro."
    ),
    "fiesta-caliente": (
        "A hot Latin reggaeton / moombahton instrumental at exactly 96 BPM in 4/4. "
        "Classic dembow drum rhythm with punchy kick and snappy rim shots, deep bass, "
        "Latin percussion (congas, timbales, shakers), plucky synth and Spanish guitar melody "
        "and brass hits. Structure: intro, verse groove, chorus, breakdown, final chorus, outro."
    ),
}


def generate(song_id: str) -> str:
    prompt = f"{SONGS[song_id]} {COMMON}"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["AUDIO", "TEXT"]},
    }).encode()
    req = urllib.request.Request(API, data=body, headers={
        "x-goog-api-key": os.environ["GEMINI_API_KEY"],
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=900) as res:
        data = json.load(res)
    for part in data["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            path = os.path.join(OUT_DIR, f"{song_id}.mp3")
            with open(path, "wb") as f:
                f.write(base64.b64decode(part["inlineData"]["data"]))
            return f"{song_id}: saved {path}"
    return f"{song_id}: no audio in response: {json.dumps(data)[:500]}"


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    ids = sys.argv[1:] or list(SONGS)
    with cf.ThreadPoolExecutor(len(ids)) as pool:
        for line in pool.map(generate, ids):
            print(line, flush=True)
