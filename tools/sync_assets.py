#!/usr/bin/env python3
"""Upload assets/ (孤夜 art + MV videos, not in git) to the R2 bucket the site Worker serves /assets/* from.

Only new or changed files are uploaded, and files deleted locally are deleted from the bucket; what is in the
bucket is tracked in tools/.r2-sync.json (not in git). --force uploads everything again.
Uses your wrangler login, or CLOUDFLARE_API_TOKEN if set (the account comes from site/wrangler.jsonc).

    python3 tools/sync_assets.py [--force] [--dry-run]
"""
import hashlib
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
STATE = os.path.join(ROOT, "tools", ".r2-sync.json")
BUCKET = "guye-rhythm-assets"
TYPES = {".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json"}


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def wrangler(*args):
    r = subprocess.run(["npx", "--yes", "wrangler@4", "r2", "object", *args, "--remote"], cwd=SITE,
                       capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"wrangler r2 object {args[0]} {args[1]}: {r.stdout[-400:]}{r.stderr[-400:]}")


def main():
    force, dry = "--force" in sys.argv, "--dry-run" in sys.argv
    state = {} if force or not os.path.exists(STATE) else json.load(open(STATE))
    local = {}
    for root, _, files in os.walk(os.path.join(ROOT, "assets")):
        for f in files:
            path = os.path.join(root, f)
            local[os.path.relpath(path, ROOT).replace(os.sep, "/")] = path
    changed = [k for k in sorted(local) if state.get(k) != md5(local[k])]
    gone = [k for k in sorted(state) if k not in local]
    size = sum(os.path.getsize(local[k]) for k in changed)
    print(f"{len(local)} files: {len(changed)} to upload ({size / 1048576:.0f} MiB), {len(gone)} to delete")
    if dry:
        for k in changed: print("  put", k)
        for k in gone: print("  del", k)
        return

    def put(k):
        ctype = TYPES.get(os.path.splitext(k)[1].lower(), "application/octet-stream")
        wrangler("put", f"{BUCKET}/{k}", "--file", local[k], "--content-type", ctype)
        return k

    def save():
        with open(STATE, "w") as f:
            json.dump(state, f, indent=1, sort_keys=True)

    failed = 0
    with ThreadPoolExecutor(4) as pool:
        for fut in [pool.submit(put, k) for k in changed]:
            try:
                k = fut.result()
                state[k] = md5(local[k])
                save()          # after every file, so an interrupted run resumes where it stopped
                print("  put", k, flush=True)
            except RuntimeError as e:
                failed += 1
                print("  FAILED", e, flush=True)
    for k in gone:
        wrangler("delete", f"{BUCKET}/{k}")
        state.pop(k, None)
        save()
        print("  del", k, flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
