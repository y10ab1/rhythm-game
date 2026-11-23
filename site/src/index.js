// guye.gamaniaocc.com — the game itself is plain Workers Static Assets (the repo, see ../../.assetsignore);
// this Worker only runs for /assets/* (孤夜 art + MV videos, kept out of the public repo, stored in R2)
// and /robots.txt. R2 has no 25 MiB per-file limit, and does range requests itself (Safari needs them for video).

const CORS = {
  'Access-Control-Allow-Origin': '*',   // the GitHub Pages build loads the art and MVs from here
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
};

const TYPES = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', webm: 'video/webm', json: 'application/json' };

async function media(req, env, url) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Max-Age': '86400' } });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const key = decodeURIComponent(url.pathname.slice(1));   // "assets/guye/..."
  let obj;
  try {
    obj = req.method === 'HEAD' ? await env.MEDIA.head(key) : await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  } catch {
    const head = await env.MEDIA.head(key);
    return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${head ? head.size : 0}` } });
  }
  if (!obj) return new Response('Not Found', { status: 404, headers: CORS });

  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  if (!h.has('Content-Type')) h.set('Content-Type', TYPES[key.split('.').pop().toLowerCase()] || 'application/octet-stream');
  h.set('ETag', obj.httpEtag);
  h.set('Accept-Ranges', 'bytes');
  // manifests change with every MV rebuild; media files keep their names when regenerated, so only an hour
  h.set('Cache-Control', key.endsWith('.json') ? 'no-cache' : 'public, max-age=3600');

  if (req.method === 'HEAD') { h.set('Content-Length', String(obj.size)); return new Response(null, { headers: h }); }
  if (!('body' in obj)) return new Response(null, { status: req.headers.has('If-None-Match') ? 304 : 412, headers: h });

  const asked = /^bytes=(\d+)-/.exec(req.headers.get('Range') || '');
  if (asked && Number(asked[1]) >= obj.size) {
    return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${obj.size}` } });
  }
  const r = req.headers.has('Range') && obj.range;
  if (!r) { h.set('Content-Length', String(obj.size)); return new Response(obj.body, { headers: h }); }
  const start = 'suffix' in r ? obj.size - r.suffix : (r.offset || 0);
  const length = 'suffix' in r ? r.suffix : (r.length ?? obj.size - start);
  h.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`);
  h.set('Content-Length', String(length));
  return new Response(obj.body, { status: 206, headers: h });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
    if (url.pathname.startsWith('/assets/')) return media(req, env, url);
    return env.ASSETS.fetch(req);
  },
};
