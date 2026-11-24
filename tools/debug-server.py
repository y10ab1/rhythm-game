#!/usr/bin/env python3
"""Serve the game on the LAN for testing on a phone, and collect debug logs.

    python3 tools/debug-server.py [port]

Open http://<this machine's LAN IP>:<port>/?debug=1 on the phone. Every finished song in debug mode
POSTs its log to /debug-log, saved under debug-logs/.
"""
import http.server
import json
import os
import re
import socket
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS = os.path.join(ROOT, 'debug-logs')
MAX_BODY = 20 * 1024 * 1024
PUBLIC = {'index.html', 'css', 'js', 'songs', 'assets', 'fur_elise.mid'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # only what the game loads: the server may be exposed through a public tunnel
    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        parts = [p for p in path.split('/') if p]
        if parts and (parts[0] not in PUBLIC or any(p.startswith('.') or '..' in p for p in parts)):
            self.send_error(404)
            return
        m = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range', ''))
        fpath = self.translate_path(self.path)
        if m and os.path.isfile(fpath):   # iOS Safari plays video only with range requests
            size = os.path.getsize(fpath)
            a, b = m.groups()
            start, end = (int(a), int(b) if b else size - 1) if a else (max(0, size - int(b or 0)), size - 1)
            end = min(end, size - 1)
            if start > end:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
            self.send_response(206)
            self.send_header('Content-Type', self.guess_type(fpath))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            try:
                with open(fpath, 'rb') as f:
                    f.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = f.read(min(1 << 16, left))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        left -= len(chunk)
            except (ConnectionResetError, BrokenPipeError):
                pass
            return
        try:
            super().do_GET()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def do_HEAD(self):
        self.do_GET()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if not self.path.split('?')[0].endswith('/debug-log'):
            self.send_error(404)
            return
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > MAX_BODY:
            self.send_error(413)
            return
        body = self.rfile.read(n)
        try:
            json.loads(body)
        except ValueError:
            self.send_error(400)
            return
        os.makedirs(LOGS, exist_ok=True)
        name = datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.json'
        m = re.search(r'name=([\w.-]+\.json)', self.path)
        if m:
            name = m.group(1)
        with open(os.path.join(LOGS, os.path.basename(name)), 'wb') as f:
            f.write(body)
        print(f'saved debug-logs/{name} ({n} bytes)', flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'open on the phone: http://{lan_ip()}:{port}/?debug=1', flush=True)
    http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
