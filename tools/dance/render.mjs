// Render 孤夜's dance (tools/dance/index.html) frame by frame in headless Chrome, mux with the song via ffmpeg.
//   node tools/dance/render.mjs probe                      -> GPU / scene info
//   node tools/dance/render.mjs shots <song> t1 t2 ...     -> PNG stills at those times (seconds)
//   node tools/dance/render.mjs video <song> [from] [to]   -> tools/mv_work/dance/<song>.mp4
// Env: W, H (default 1920x1080), FPS (default 30)
import http from 'node:http';
import { createReadStream, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WORK = join(ROOT, 'tools/mv_work/dance');
const LIB = process.env.GUYE_LIB || join(process.env.HOME, 'coding/data/guyeh');
const W = +(process.env.W || 1920), H = +(process.env.H || 1080), FPS = +(process.env.FPS || 30);
const MOUNTS = [['/lib/', LIB], ['/work/', WORK], ['/songs/', join(ROOT, 'songs')], ['/', HERE]];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

function serve() {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    for (const [pre, dir] of MOUNTS) {
      if (!url.startsWith(pre)) continue;
      const p = resolve(dir, '.' + url.slice(pre.length - 1));
      if (!p.startsWith(resolve(dir)) || !existsSync(p) || statSync(p).isDirectory()) break;
      res.writeHead(200, { 'Content-Type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream' });
      return createReadStream(p).pipe(res);
    }
    res.writeHead(404); res.end();
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

const [mode = 'probe', song = 'starlight-stage', ...rest] = process.argv.slice(2);
const srv = await serve();
const port = srv.address().port;
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  // this combination gets ANGLE on the NVIDIA card in headless mode (anything else falls back to SwiftShader)
  args: ['--use-angle=vulkan', '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan', '--disable-vulkan-surface', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?song=${song}&w=${W}&h=${H}&fps=${FPS}&${process.env.FLAGS || ''}`);
await page.waitForFunction(() => window.READY === true || window.FAIL, null, { timeout: 600000 });
if (await page.evaluate(() => window.FAIL)) { console.log('FAILED', await page.evaluate(() => window.FAIL)); process.exit(1); }
console.log(await page.evaluate(() => window.INFO));

const grab = t => page.evaluate(t => window.renderAt(t), t);   // returns JPEG/PNG dataURL
const b64 = d => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

if (mode === 'shots') {
  mkdirSync(join(WORK, 'shots'), { recursive: true });
  for (const t of rest.map(Number)) {
    await page.evaluate(t => window.seek(t), t);
    const f = join(WORK, 'shots', `${song}_${t.toFixed(2)}.jpg`);
    writeFileSync(f, b64(await grab(t)));
    const fi = await page.evaluate(() => window.frameInfo());
    if (fi) writeFileSync(f.replace(/\.jpg$/, '.json'), JSON.stringify(fi));
    console.log(f);
  }
} else if (mode === 'game') {
  // in-game MV background: no audio, no title/logo; needs FLAGS with frame=landscape|portrait.
  // Writes tools/mv_work/dance/game/<song>_<frame>.mp4 (master) + .json (her position every 0.25 s)
  const tag = new URLSearchParams(process.env.FLAGS || '').get('frame') || 'raw';
  const dur = await page.evaluate(() => window.DURATION);
  mkdirSync(join(WORK, 'game'), { recursive: true });
  const out = join(WORK, 'game', `${song}_${tag}`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', out + '.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  await page.evaluate(() => window.seek(0));
  const n = Math.round(dur * FPS), t0 = Date.now(), info = [];
  for (let i = 0; i < n; i++) {
    const buf = b64(await grab(i / FPS));
    info.push(await page.evaluate(() => window.frameInfo()));
    if (!ff.stdin.write(buf)) await new Promise(ok => ff.stdin.once('drain', ok));
    if (i % 300 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000 / Math.max(1, i)).toFixed(3)} s/frame`);
  }
  ff.stdin.end();
  await new Promise(ok => ff.on('close', ok));
  writeFileSync(out + '.json', JSON.stringify({ fps: FPS, w: W, h: H, frames: info }));
  console.log(out + '.mp4');
} else if (mode === 'video') {
  const dur = await page.evaluate(() => window.DURATION);
  const from = +(rest[0] ?? 0), to = Math.min(+(rest[1] ?? dur), dur);
  const out = join(WORK, `${song}${rest.length ? `_${from}-${to}` : ''}.mp4`);
  // full renders get a title card at the start and the 孤夜 logo over the final pose
  const titled = !rest.length && process.env.TITLE !== '0';
  const meta = JSON.parse((await import('node:fs')).readFileSync(join(ROOT, 'songs', 'manifest.json'), 'utf8')).find(s => s.id === song) || { title: song };
  const font = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc';
  const fade = (a, b, c, d) => `if(lt(t\\,${a})\\,0\\,if(lt(t\\,${b})\\,(t-${a})/${b - a}\\,if(lt(t\\,${c})\\,1\\,if(lt(t\\,${d})\\,(${d}-t)/${d - c}\\,0))))`;
  const logoAt = Math.max(0, to - 5);
  const filter = [
    `[0:v]drawtext=fontfile=${font}:text='孤夜  GUYE':fontsize=${Math.round(H / 15)}:fontcolor=white:shadowcolor=0xff2f8a@0.8:shadowx=3:shadowy=3:x=${Math.round(W / 21)}:y=h-${Math.round(H / 4.6)}:alpha='${fade(0.8, 1.6, 6, 7)}',` +
    `drawtext=fontfile=${font}:text='${meta.title.replace(/'/g, '')}  ·  Dance Performance':fontsize=${Math.round(H / 32)}:fontcolor=0xcfe9ff:x=${Math.round(W / 21)}:y=h-${Math.round(H / 8.2)}:alpha='${fade(1.2, 2.0, 6, 7)}'[v1]`,
    `[2:v]crop=1000:600:0:600,colorkey=0x1b1b1b:0.18:0.12,scale=${Math.round(W / 6.5)}:-1,format=rgba,fade=t=in:st=${logoAt}:d=0.8:alpha=1[logo]`,
    `[v1][logo]overlay=x=W-w-${Math.round(W / 24)}:y=H-h-${Math.round(H / 14)}:shortest=1:enable='gte(t,${logoAt})'[v]`,
  ].join(';');
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-ss', String(from), '-t', String(to - from), '-i', join(ROOT, 'songs', `${song}.mp3`),
    ...(titled ? ['-loop', '1', '-framerate', String(FPS), '-i', join(LIB, '2D/LOGO/孤夜LOGO.png'), '-filter_complex', filter, '-map', '[v]'] : ['-map', '0:v']),
    '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  await page.evaluate(t => window.seek(t), from);
  const n = Math.round((to - from) * FPS), t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = b64(await grab(from + i / FPS));
    if (!ff.stdin.write(buf)) await new Promise(ok => ff.stdin.once('drain', ok));
    if (i % 150 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000 / Math.max(1, i)).toFixed(3)} s/frame`);
  }
  ff.stdin.end();
  await new Promise(ok => ff.on('close', ok));
  console.log(out);
}
await browser.close();
srv.close();
