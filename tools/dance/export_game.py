#!/usr/bin/env python3
"""Turn the in-game dance masters (render.mjs game ...) into web MV files + a manifest entry.

    W=1920 H=1080 FLAGS="mocap=aist&frame=center" node tools/dance/render.mjs game starlight-stage
    W=720  H=1280 FLAGS="mocap=aist&frame=portrait"  node tools/dance/render.mjs game starlight-stage
    python3 tools/dance/export_game.py starlight-stage

Writes assets/guye/mv/<song>-dance.mp4 (1280x720, wide screens), hd/<song>-dance.mp4 (2560x1440 from a 1440p MSAA master, big
desktops) and <song>-dance-portrait.mp4 (1080x1920, phones), (the deploy stores files over 25 MiB in parts), and sets songs[<song>].dance in the manifest
(the song's old clips stay listed, so uploads keep using them in their shuffled mix).
Also writes <song>-dance-body.json / -portrait-body.json: her skeleton per frame, which the game uses to
make the lanes see-through over her (js/character.js xrayMask). `center` = she dances behind the middle of
the lanes on wide screens (frame=center); without it she is framed right of them (frame=landscape).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
WORK = os.path.join(ROOT, "tools", "mv_work", "dance", "game")
OUT = os.path.join(ROOT, "assets", "guye", "mv")


# The bitrates keep her face and hair sharp (1.5 Mbps for a whole song did not), which makes the files
# bigger than Cloudflare Workers' 25 MiB asset limit: guye-rhythm-deploy/deploy.sh stores those in parts
# and its Worker joins them again (with range requests), so the game still sees one plain file.
FRAG = ["-movflags", "+faststart", "-g", "30"]


def duration(src):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def done(dst):
    print(dst, os.path.getsize(dst) // 1024, "KB")


def encode(src, dst, size, kbps, roi=-0.2):
    """H.264, two-pass at a fixed bitrate. The middle of the frame, where she dances, gets a few more of the
    bits (addroi; not on phones, she fills the width). Keyframe every second: the game seeks into it."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    log = os.path.join(WORK, "x264pass")
    vf = f"scale={size}:flags=lanczos" + (f",addroi=x=iw*0.28:y=0:w=iw*0.44:h=ih:qoffset={roi}" if roi else "")
    common = ["-vf", vf, "-an", "-c:v", "libx264", "-preset", "slow",
              "-b:v", f"{kbps}k", "-maxrate", f"{kbps * 2}k", "-bufsize", f"{kbps * 4}k",
              "-pix_fmt", "yuv420p", "-passlogfile", log]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, *common, "-g", "30", "-pass", "1", "-f", "mp4", os.devnull], check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, *common, *FRAG, "-pass", "2", dst], check=True)
    done(dst)


def encode_av1(src, dst, size, kbps):
    """AV1 (8-bit): sharper for the bits. Used where AV1 is hardware-decoded (js/character.js mvAv1)."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"scale={size}:flags=lanczos", "-an",
                    "-c:v", "libsvtav1", "-preset", "5", "-b:v", f"{kbps}k", "-svtav1-params", "tune=0",
                    "-pix_fmt", "yuv420p", *FRAG, dst], check=True)
    done(dst)


def track(path):
    info = json.load(open(path))
    fps, fr = info["fps"], info["frames"]
    step = fps / 4  # one value per 0.25 s, like the Gemini-tracked clips
    return [round(fr[min(len(fr) - 1, round(i * step))]["x"], 3) for i in range(int(len(fr) / step) + 1)]


def body(path, dst, fps=15):
    """BODY_JOINTS points every 1/fps s, as ints (x1000), flattened: {fps, n, f}."""
    info = json.load(open(path))
    fr = info["frames"]
    step = info["fps"] / fps
    n = len(fr[0]["body"])
    flat = []
    for i in range(int(len(fr) / step) + 1):
        for x, y in fr[min(len(fr) - 1, round(i * step))]["body"]:
            flat += [round(x * 1000), round(y * 1000)]
    json.dump({"fps": fps, "n": n, "f": flat}, open(dst, "w"), separators=(",", ":"))
    print(dst, os.path.getsize(dst) // 1024, "KB")


def main(song, frame="center"):
    land, port = os.path.join(WORK, f"{song}_{frame}"), os.path.join(WORK, f"{song}_portrait")
    body(land + ".json", os.path.join(OUT, f"{song}-dance-body.json"))
    body(port + ".json", os.path.join(OUT, f"{song}-dance-portrait-body.json"))
    # remove older encodes of this dance (single files, parts, chunks)
    import glob
    for f in glob.glob(os.path.join(OUT, "**", f"{song}-dance*.m*4*"), recursive=True):
        os.remove(f)
    L, P = {"hd": True}, {}
    for d, target, src, size, kbps, enc in [
            ("", L, land, "1280:720", 3500, encode), ("hd/", L, land, "2560:1440", 10000, encode),
            ("", P, port, "1080:1920", 5000, lambda *a: encode(*a, roi=0)),
            ("av1/", L, land, "1280:720", 2200, encode_av1), ("av1/hd/", L, land, "2560:1440", 6500, encode_av1),
            ("av1/", P, port, "1080:1920", 3500, encode_av1)]:
        name = f"{song}-dance.mp4" if target is L else f"{song}-dance-portrait.mp4"
        enc(src + ".mp4", os.path.join(OUT, d, name), size, kbps)
    dur = round(duration(land + ".mp4"), 3)
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path))
    man["songs"].setdefault(song, {})["dance"] = {
        "src": f"{song}-dance.mp4", "track": track(land + ".json"), "body": f"{song}-dance-body.json", "av1": True, "dur": dur, **L,
        **({"center": True} if frame == "center" else {}),
        "portrait": {"src": f"{song}-dance-portrait.mp4", "track": track(port + ".json"),
                     "body": f"{song}-dance-portrait-body.json", "av1": True, "dur": dur, **P},
    }
    json.dump(man, open(man_path, "w"), ensure_ascii=False, indent=1)
    print("manifest:", song, "dance")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "starlight-stage", sys.argv[2] if len(sys.argv) > 2 else "center")
