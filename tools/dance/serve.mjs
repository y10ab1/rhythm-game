// Live viewer: node tools/dance/serve.mjs [port]  →  http://127.0.0.1:<port>/index.html?live&song=starlight-stage
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const LIB = process.env.GUYE_LIB || join(process.env.HOME, 'coding/data/guyeh');
const MOUNTS = [['/lib/', LIB], ['/work/', join(ROOT, 'tools/mv_work/dance')], ['/songs/', join(ROOT, 'songs')], ['/', HERE]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg' };
const PORT = +(process.argv[2] || 8765);

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  for (const [pre, dir] of MOUNTS) {
    if (!url.startsWith(pre)) continue;
    const p = resolve(dir, '.' + url.slice(pre.length - 1));
    if (!p.startsWith(resolve(dir)) || !existsSync(p) || statSync(p).isDirectory()) break;
    const size = statSync(p).size, type = TYPES[extname(p).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) { // range requests so the audio seek bar works
      const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return createReadStream(p, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    return createReadStream(p).pipe(res);
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/index.html?live&song=starlight-stage`));
