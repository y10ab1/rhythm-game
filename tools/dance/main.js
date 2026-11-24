import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { loadStage, makeLights } from './stage.js';
import { Rig } from './rig.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 1920, H = +q.get('h') || 1080, FPS = +q.get('fps') || 30;
const SONG = q.get('song') || 'starlight-stage';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05030c);
scene.fog = new THREE.FogExp2(0x080412, 0.018);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 200);

// MSAA render target: EffectComposer's default target has none, which left every edge (hair, sleeves) aliased
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: q.has('noaa') ? 0 : 4 }));
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
// Chrome 158 (ANGLE/Vulkan) leaves a few NaN/Inf pixels in the half-float scene buffer on some frames; the bloom
// blur spreads them into big black blocks. Zero them and cap HDR highlights before bloom.
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bvec4 bad = bvec4(c.r != c.r || abs(c.r) > 6e4, c.g != c.g || abs(c.g) > 6e4, c.b != c.b || abs(c.b) > 6e4, c.a != c.a || abs(c.a) > 6e4);
      if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), clamp(c.a, 0.0, 1.0));
    }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const manager = new THREE.LoadingManager();
manager.setURLModifier(u => {
  const m = u.match(/([^\\/]+)\.(tga|png|jpg)$/i);
  return m && !u.startsWith('/work/') && !u.startsWith('blob:') && !u.startsWith('data:') ? `/work/tex/${m[1]}.png` : u;
});

async function main() {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const info = { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };

  const [stage, gltf, beat] = await Promise.all([
    loadStage(manager),
    new GLTFLoader().register(p => new VRMLoaderPlugin(p)).loadAsync('/lib/3D/孤夜/Guye1_1.vrm'),
    fetch(`/work/${SONG}.json`).then(r => r.json()),
  ]);
  scene.add(stage.root);

  const vrm = gltf.userData.vrm;
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const rig = new Rig(vrm);
  scene.add(rig.root);
  info.rig = { legLen: +rig.legLen.toFixed(3), footY: +rig.footY.toFixed(3), stanceX: +rig.stanceX.toFixed(3), hipsY: +rig.rest.hips.y.toFixed(3) };
  info.expressions = vrm.expressionManager?.expressions.map(e => e.expressionName);

  const focus = new THREE.Object3D(); focus.position.set(0, 1.0, 0); scene.add(focus);
  const lights = makeLights(scene, focus);

  // her robots 黑白無常
  const robots = [];
  for (const f of ['Guye_Robot01', 'Guye_Robot02']) {
    try {
      const r = await new FBXLoader(manager).loadAsync(`/lib/3D/黑白無常/${f}.fbx`);
      const b = new THREE.Box3().setFromObject(r), s = b.getSize(new THREE.Vector3());
      const k = 0.42 / Math.max(s.x, s.y, s.z);
      r.scale.multiplyScalar(k);
      const wrap = new THREE.Group(); wrap.add(r);
      const c = new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3());
      r.position.sub(c);
      r.traverse(o => { if (o.isMesh) { o.castShadow = true; [].concat(o.material).forEach(m => { info[f] = (info[f] || '') + `${m.name}:${m.type}:${m.color?.getHexString()}:${!!m.map} `; }); } });
      scene.add(wrap); robots.push(wrap);
    } catch (e) { info[f] = 'ERR ' + e.message; }
  }

  if (q.has('nofog')) scene.fog = null;
  if (q.has('noemit')) { const re = new RegExp(q.get('noemit') || '.'); stage.glow.forEach(g => { if (re.test(g.mat.name)) g.mat.emissiveIntensity = 0; }); }
  const { Show } = await import('./show.js');
  const show = new Show({ THREE, scene, camera, renderer, composer, bloom, vrm, rig, stage, lights, focus, robots, beat, song: SONG, W, H, FPS });
  if (q.get('mocap')) {
    // real dance motion (AIST++ or a skeleton extracted from a dance video), see mocap_prep.py
    const { MocapPlayer } = await import('./mocap.js');
    show.mocap = new MocapPlayer(await fetch(`/work/mocap/${q.get('mocap')}.json`).then(r => r.json()), rig);
  }
  // game background versions: desktop has her right of the lanes, phones behind the upper (far) end of the lanes
  const FRAMES = {
    // centre: wide screens, she dances behind the middle of the lanes (the game thins the lanes over her)
    center: { x: 0.5, xTol: 0.04, top: 0.08, topMin: 0.04, full: 0.8, upMin: 0.3, upMax: 0.52 },
    landscape: { x: 0.78, xTol: 0.05, top: 0.08, topMin: 0.04, full: 0.8, upMin: 0.3, upMax: 0.55 },
    portrait: { x: 0.5, xTol: 0.1, top: 0.13, topMin: 0.09, full: 0.66, upMin: 0.26, upMax: 0.4 },
  };
  if (q.get('frame')) show.framing = FRAMES[q.get('frame')];
  if (q.has('front')) {   // debugging: fixed full-body front camera
    show.updateCamera = () => { camera.position.set(0, 1.0, 4.4); camera.fov = 32; camera.lookAt(0, 0.85, 0); camera.updateProjectionMatrix(); };
  }
  window.INFO = JSON.stringify(info);
  window.DURATION = beat.duration;
  window.seek = t => show.seek(t);
  window.frameInfo = () => show.frameInfo || null;
  window.renderAt = t => { show.frame(t); if (q.has('nobloom')) renderer.render(scene, camera); else composer.render(); return renderer.domElement.toDataURL('image/jpeg', q.has('noaa') ? 0.93 : 0.97); };
  window.READY = true;
  if (q.has('live')) startLive(show, beat.duration);
}

// live viewer: plays the song and drives the show from the audio clock
function startLive(show, duration) {
  const fit = () => {
    const w = innerWidth, h = innerHeight, s = Math.min(w / W, h / H);
    Object.assign(renderer.domElement.style, { width: `${W * s}px`, height: `${H * s}px`, margin: `${(h - H * s) / 2}px auto 0` });
  };
  addEventListener('resize', fit); fit();
  const audio = new Audio(`/songs/${SONG}.mp3`);
  const ui = document.createElement('div');
  ui.innerHTML = `<button id="pp">▶</button><input id="sk" type="range" min="0" max="${duration}" step="0.01" value="0"><span id="tm">0:00</span>`;
  ui.id = 'ui'; document.body.appendChild(ui);
  const css = document.createElement('style');
  css.textContent = `#ui{position:fixed;left:0;right:0;bottom:0;display:flex;gap:12px;align-items:center;padding:10px 16px;background:linear-gradient(transparent,#000c);color:#fff;font:14px sans-serif;opacity:.25;transition:opacity .2s}#ui:hover{opacity:1}#pp{background:#e0397a;border:0;color:#fff;border-radius:50%;width:36px;height:36px;font-size:16px;cursor:pointer}#sk{flex:1;accent-color:#e0397a}#hint{position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:24px sans-serif;cursor:pointer;background:#0008}`;
  document.head.appendChild(css);
  const hint = document.createElement('div'); hint.id = 'hint'; hint.textContent = `▶ 點擊播放 孤夜 × ${SONG}`; document.body.appendChild(hint);
  const pp = ui.querySelector('#pp'), sk = ui.querySelector('#sk'), tm = ui.querySelector('#tm');
  const toggle = () => { hint.remove(); audio.paused ? audio.play() : audio.pause(); };
  hint.onclick = toggle; pp.onclick = toggle;
  addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); toggle(); } });
  audio.onplay = () => pp.textContent = '❚❚'; audio.onpause = () => pp.textContent = '▶';
  let dragging = false;
  sk.oninput = () => { dragging = true; };
  sk.onchange = () => { dragging = false; audio.currentTime = +sk.value; show.seek(+sk.value); };
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  show.seek(0);
  const loop = () => {
    const t = audio.currentTime;
    if (!dragging) sk.value = t;
    tm.textContent = `${fmt(t)} / ${fmt(duration)}`;
    if (!audio.paused || show.lastT == null || Math.abs(show.lastT - t) > 1e-3) {
      show.frame(t);
    }
    if (q.has('nobloom')) renderer.render(scene, camera); else composer.render();
    requestAnimationFrame(loop);
  };
  loop();
}
main().catch(e => { console.error(e.stack); window.FAIL = String(e.stack || e); });
