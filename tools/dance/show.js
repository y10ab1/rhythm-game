// The performance: beat clock, choreography -> rig, cameras cut on bar lines, beat-synced lights, beams, sparkles, robots.
import * as THREE from 'three';
import { poseAt, useTimeline } from './choreo.js';
import { timeline } from './timelines.js';
import { MocapPlayer } from './mocap.js';

const smooth = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// joints exported per frame in game mode (js/character.js BODY_* must match this order)
const BODY_JOINTS = ['headTop', 'headMid', 'neck', 'chest', 'hips',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];

// colour moods per section (a song's timeline can override them)
const MOOD = {
  intro: { a: 0x3d5bff, b: 0x9a4bff, key: 0.6, neon: 0.5, beams: 0.25, spark: 0.1 },
  verse: { a: 0xff3d9a, b: 0x2fd8ff, key: 1.0, neon: 1.0, beams: 0.5, spark: 0.25 },
  build: { a: 0x7a5cff, b: 0x2fd8ff, key: 0.9, neon: 0.8, beams: 0.6, spark: 0.3 },
  pre: { a: 0xff5cc8, b: 0xffb03d, key: 1.0, neon: 1.1, beams: 0.75, spark: 0.4 },
  chorus: { a: 0xff2f8a, b: 0x2fe0ff, key: 1.15, neon: 1.6, beams: 1.0, spark: 1.0 },
  break: { a: 0x2b4bff, b: 0x8a5cff, key: 0.7, neon: 0.45, beams: 0.35, spark: 0.5 },
  final: { a: 0xff2f8a, b: 0xffd23d, key: 1.15, neon: 1.5, beams: 1.0, spark: 0.9 },
  end: { a: 0xff6fb8, b: 0x6fd8ff, key: 1.0, neon: 1.0, beams: 0.6, spark: 0.7 },
};

function beamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(1, 1, 1) }, strength: { value: 1 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float strength; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float along = pow(vY, 1.4);
        gl_FragColor = vec4(color * strength * edge * along * 0.32, 1.0); }`,
  });
}

function sparkTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Show {
  constructor(ctx) {
    Object.assign(this, ctx);
    const { beat, scene, vrm, robots } = this;
    this.P = 60 / beat.bpm;
    // the song's timeline (timelines.js); bars count from its first downbeat
    const tl = timeline(this.song);
    useTimeline(tl);
    this.shots = tl.shots;
    this.mood = { ...MOOD, ...(tl.mood || {}) };
    this.endB = tl.end * 4;                // beat (from the downbeat) where the ending move starts
    this.db = beat.downbeat || 0;
    this.lastT = null;

    // eyes follow the camera
    this.lookTarget = new THREE.Object3D(); scene.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    // light beams from the ceiling rig
    this.beams = [];
    const fixtures = [[-5, 13.3, -4.6], [-2, 13.3, -4.6], [2, 13.3, -4.6], [5, 13.3, -4.6], [-8.7, 10.4, 4.3], [8.7, 10.4, 4.3]];
    fixtures.forEach((f, i) => {
      const geo = new THREE.CylinderGeometry(0.06, 1.5, 18, 32, 1, true);
      geo.translate(0, -9, 0);                // apex at the fixture, cone hangs down
      geo.rotateX(-Math.PI / 2);              // point along -z of the group so lookAt aims it
      const m = new THREE.Mesh(geo, beamMaterial());
      const g = new THREE.Group(); g.position.set(...f); g.add(m);
      // uv.y on the cylinder runs bottom(0)->top(1); after the flip the bright end is at the fixture
      scene.add(g);
      this.beams.push({ g, m, i, base: V3(...f) });
    });

    // sparkles drifting up around the stage
    const N = 700, pos = new Float32Array(N * 3); this.sparkSeed = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 7;
      this.sparkSeed.push([Math.cos(a) * r, Math.random() * 9, Math.sin(a) * r - 1.5, 0.2 + Math.random() * 0.5, Math.random() * 6.28]);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkMat = new THREE.PointsMaterial({ size: 0.09, map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd6f4 });
    this.sparks = new THREE.Points(sg, this.sparkMat); this.sparks.frustumCulled = false; scene.add(this.sparks);

    // robots: black + white shells with a coloured glow
    robots.forEach((r, i) => {
      r.traverse(o => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshStandardMaterial({
          color: i === 0 ? 0x30303a : 0xf2f0f6, roughness: i === 0 ? 0.45 : 0.3, metalness: i === 0 ? 0.25 : 0.15,
          emissive: i === 0 ? 0xb04dff : 0x4fe0ff, emissiveIntensity: 0.05,
        });
      });
    });

    // seeded blink times
    this.blinks = [];
    for (let i = 0, t = 1.7; t < beat.duration + 5; i++) { this.blinks.push(t); t += 2.4 + 1.8 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1); }
  }

  beatAt(t) {
    const B = this.beat.beats, P = this.P;
    if (t <= B[0]) return (t - B[0]) / P;
    if (t >= B[B.length - 1]) return B.length - 1 + (t - B[B.length - 1]) / P;
    let lo = 0, hi = B.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo]) / (B[hi] - B[lo]);
  }
  energyAt(b) {
    const E = this.beat.energy, i = Math.max(0, Math.min(E.length - 1, Math.floor(b)));
    let s = 0, n = 0; for (let k = i - 2; k <= i + 2; k++) if (E[k] != null) { s += E[k]; n++; }
    return n ? s / n : 0.5;
  }

  seek(t) {
    // spring bones (hair, sleeves, ribbons) need history: simulate the 2 seconds before t
    const dt = 1 / this.FPS;
    for (let x = Math.max(-1, t - 2); x < t - 1e-6; x += dt) this.step(x, dt, false);
    this.lastT = t - dt;
  }

  frame(t) {
    const dt = this.lastT == null ? 1 / this.FPS : Math.min(0.1, Math.max(1e-3, t - this.lastT));
    this.lastT = t;
    this.step(t, dt, true);
  }

  step(t, dt, full) {
    const { rig, vrm, camera } = this;
    const b = this.beatAt(t) - this.db;     // beats from the first downbeat
    const e = this.energyAt(b + this.db);
    const { pose, section } = poseAt(b, e);

    // blinks layered on the choreography's expression
    let blink = 0;
    for (const bt of this.blinks) { const d = t - bt; if (d > -0.08 && d < 0.12) blink = Math.max(blink, 1 - Math.abs(d - 0.02) / 0.1); }
    pose.expr.blink = Math.max(pose.expr.blink || 0, clamp01(blink));
    if (pose.expr.blinkRight > 0.5 || pose.expr.blinkLeft > 0.5) pose.expr.blink = 0;
    if (this.mocap) {
      // real dance motion; the last bars settle into the keyframed peace-sign ending
      let blend = null;
      const b0 = this.endB + 1.5;
      if (b > b0) { rig.apply(pose); blend = { ...MocapPlayer.capture(rig), w: smooth(clamp01((b - b0) / 1.5)) }; }
      this.mocap.apply(t, blend);
      rig.applyExpr(pose.expr);
    } else rig.apply(pose);

    // where she is (for camera + lights)
    const hips = rig.node('hips').getWorldPosition(new THREE.Vector3());
    if (this.mocap) pose.root.x = hips.x;
    this.focus.position.set(hips.x, 1.0, hips.z);

    this.updateRobots(t, b, section, hips);
    this.updateCamera(t, b, section, pose);
    this.lookTarget.position.copy(camera.position);
    this.lights.fill.position.copy(camera.position).add(V3(0, 1.5, 0));
    vrm.update(dt);
    if (this.framing) this.reframe(dt, b);
    if (full) this.updateLights(t, b, e, section);
  }

  updateRobots(t, b, section, hips) {
    const fast = section === 'chorus' || section === 'final';
    const calm = section === 'break' || section === 'intro';
    this.robots.forEach((r, i) => {
      const speed = fast ? Math.PI / 4 : calm ? Math.PI / 16 : Math.PI / 8;   // radians per beat
      const a = b * speed + i * Math.PI + 0.6;
      const rad = calm ? 1.05 : 1.3;
      const y = 1.85 + 0.12 * Math.sin(b * Math.PI / 2 + i * 1.7) + (fast ? 0.18 * Math.max(0, Math.cos(b * Math.PI * 2)) ** 4 : 0);
      const orbit = V3(hips.x + Math.cos(a) * rad, y, Math.sin(a) * rad * 0.8 - 0.1);
      const park = V3(hips.x + (i ? 0.85 : -0.85), 1.75 + 0.06 * Math.sin(b * Math.PI / 2 + i * 2), -0.35);
      const k = smooth(clamp01((b - this.endB) / 4));                 // last bars: settle at her shoulders
      r.position.copy(orbit.lerp(park, k));
      r.rotation.set(0.15 * Math.sin(b * Math.PI) * (1 - k), lerp(-a + Math.PI / 2, 0, k), 0.2 * Math.sin(b * Math.PI / 2 + i) * (1 - k));
    });
  }

  updateCamera(t, b, section, pose) {
    const bar = b / 4;
    const s = this.shots.find(x => bar < x[1]) || this.shots[this.shots.length - 1];
    const [b0, b1, kind, o] = s;
    const span = o.dur ? o.dur : (b1 - b0);
    let u = clamp01((bar - b0) / span);
    u = o.ease === 'in' ? u * u : smooth(u) * 0.7 + u * 0.3;
    const cam = this.camera;
    const look = V3(...o.look);
    if (kind === 'dolly' || kind === 'crane') {
      cam.position.set(lerp(o.from[0], o.to[0], u), lerp(o.from[1], o.to[1], u), lerp(o.from[2], o.to[2], u));
    } else if (kind === 'orbit') {
      const a = lerp(o.a0, o.a1, u);
      cam.position.set(Math.sin(a) * o.r, o.y, Math.cos(a) * o.r);
    } else if (kind === 'track') {
      const x = pose.root.x;
      cam.position.set(x * 0.7 + o.off[0], o.off[1], o.off[2]);
      look.x += x * 0.9;
    }
    // follow her if she travels
    if (kind !== 'track') { look.x += pose.root.x * 0.6; cam.position.x += pose.root.x * 0.3; }
    // handheld drift
    cam.position.x += 0.025 * Math.sin(t * 0.7) + 0.012 * Math.sin(t * 1.9);
    cam.position.y += 0.018 * Math.sin(t * 0.9 + 1);
    let fov = o.fov;
    if (o.kick) { const ph = b - Math.floor(b); const onBar = Math.floor(b) % 4 === 0; fov -= (onBar ? 2.2 : 0.9) * Math.exp(-ph * 7); }
    cam.fov = fov;
    cam.lookAt(look);
    cam.updateProjectionMatrix();
  }

  // Game background framing (?frame=landscape|portrait): keeps the shot's camera angle but pans and zooms
  // the frustum (camera.setViewOffset, a real zoom, not a crop) so she sits where the game can show her:
  // her head always in frame, at least her upper body visible, her body centred at x = fr.x of the frame.
  // Smoothed over time, snapped on a camera cut. this.frameInfo = where she ended up (0..1 of the frame).
  reframe(dt, b) {
    const fr = this.framing, cam = this.camera, W = this.W, H = this.H;
    cam.clearViewOffset();
    cam.updateMatrixWorld();
    const px = p => { const v = p.clone().project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
    // raw bones = the visible mesh (the normalized rig is turned 180deg relative to it, see rig.js)
    const wp = n => (this.vrm.humanoid.getRawBoneNode(n) || this.rig.node(n)).getWorldPosition(new THREE.Vector3());
    const head = wp('head'), hips = wp('hips'), neck = wp('neck');
    const top = px(head.clone().add(V3(0, 0.24, 0)));            // hair + headphone horns
    const hip = px(hips);
    const feet = [wp('leftFoot'), wp('rightFoot')].map(px);
    const footY = Math.max(feet[0][1], feet[1][1]) + 0.03 * H;
    const cx = (px(neck)[0] + hip[0]) / 2;
    // her skeleton in unzoomed pixels (projected before setViewOffset below); order = BODY_JOINTS
    const bodyPx = BODY_JOINTS.map(n => px(n === 'headTop' ? head.clone().add(V3(0, 0.2, 0))
      : n === 'headMid' ? head.clone().add(V3(0, 0.08, 0)) : wp(n)));
    const upper = Math.max(1, hip[1] - top[1]), full = Math.max(1, footY - top[1]);
    // zoom: whole body at fr.full of the frame height, but the upper body never smaller/larger than allowed
    let z = Math.min(Math.max(fr.full * H / full, fr.upMin * H / upper), fr.upMax * H / upper);
    z = Math.min(2.6, Math.max(0.55, z));
    // where the frame's origin must be (in unzoomed pixels) for the body centre and head top to land on target
    const want = { z: Math.log(z), cx, top: top[1] };
    const shot = this.shots.findIndex(x => b / 4 < x[1]);
    const f = this.frameF;
    if (!f || shot !== this.frameShot) { this.frameF = { ...want }; this.frameShot = shot; }
    else {
      const k = 1 - Math.exp(-dt / 0.3), kz = 1 - Math.exp(-dt / 0.6);
      f.cx += (want.cx - f.cx) * k; f.top += (want.top - f.top) * k; f.z += (want.z - f.z) * kz;
    }
    const F = this.frameF, Z = Math.exp(F.z);
    // output pixel = (p - o) * Z
    let ox = F.cx - fr.x * W / Z;
    let oy = F.top - fr.top * H / Z;
    // hard limits on the real (unsmoothed) pose: head never above the safe top, body never off its band
    oy = Math.min(oy, top[1] - fr.topMin * H / Z);
    ox = Math.min(Math.max(ox, cx - (fr.x + fr.xTol) * W / Z), cx - (fr.x - fr.xTol) * W / Z);
    cam.setViewOffset(W, H, ox, oy, W / Z, H / Z);
    cam.updateProjectionMatrix();
    this.frameInfo = { x: (cx - ox) * Z / W, top: (top[1] - oy) * Z / H, hip: (hip[1] - oy) * Z / H, z: Z };
    // her skeleton on screen (0..1 of the frame) for the game's see-through-lanes mask; order = BODY_JOINTS
    this.frameInfo.body = bodyPx.map(q => [+((q[0] - ox) * Z / W).toFixed(4), +((q[1] - oy) * Z / H).toFixed(4)]);
  }

  updateLights(t, b, e, section) {
    const m = this.mood[section] || this.mood.verse;
    const ph = b - Math.floor(b);
    const hit = Math.exp(-ph * 6);                            // decays after every beat
    const barHit = Math.floor(b) % 4 === 0 ? hit : 0;
    const hot = section === 'chorus' || section === 'final';
    const L = this.lights;
    let ca = new THREE.Color(m.a), cb = new THREE.Color(m.b);
    if (hot) { const k = Math.floor(b) % 2; if (k) [ca, cb] = [cb, ca]; }

    L.key.intensity = 20 * m.key * (hot ? 0.9 + 0.25 * barHit : 1);
    L.magenta.color.copy(ca); L.cyan.color.copy(cb);
    L.magenta.intensity = 18 * (0.55 + 0.6 * hit * m.neon);
    L.cyan.intensity = 18 * (0.55 + 0.6 * (Math.floor(b) % 2 ? hit : 0.3) * m.neon);
    L.back.color.copy(ca).lerp(cb, 0.5);
    L.back.intensity = 22 * (0.5 + 0.8 * barHit) * m.neon;
    L.hemi.intensity = 0.45 + 0.2 * m.neon;

    // stage LEDs and emissive props breathe on the beat
    const pulse = m.neon * (0.75 + 0.6 * hit * (0.4 + e));
    for (const g of this.stage.glow) {
      if (g.mat.isMeshBasicMaterial) g.mat.color.copy(g.mat.userData.baseColor).multiplyScalar(1.1 * pulse);
      else g.mat.emissiveIntensity = g.base * (g.kind === 'screen' ? 0.7 + 0.9 * hit * m.neon : 0.55 + 0.45 * pulse);
    }

    // beams sweep; cross on bar lines in the chorus
    this.beams.forEach(({ g, m: mesh, i, base }) => {
      const side = base.x < 0 ? -1 : 1;
      const sw = hot ? Math.sin(b * Math.PI / 2 + i) * 2.4 : Math.sin(b * Math.PI / 8 + i * 0.9) * 1.6;
      const target = V3(side * -0.8 * (hot ? Math.cos(b * Math.PI / 4) : 0.4) + sw, 0, (i >= 4 ? -0.5 : 0.8) + Math.cos(b * Math.PI / 6 + i) * 1.2);
      g.lookAt(target);
      const col = i % 2 ? ca : cb;
      mesh.material.uniforms.color.value.copy(col);
      const on = section === 'intro' && b < 8 ? (i === 1 || i === 2 ? 0.6 : 0) : 1;
      mesh.material.uniforms.strength.value = on * m.beams * (0.55 + 0.7 * (hot ? hit : 0.4));
    });

    // sparkles
    const pos = this.sparks.geometry.attributes.position.array;
    this.sparkSeed.forEach(([x, y, z, sp, ph0], i) => {
      pos[i * 3] = x + 0.15 * Math.sin(t * 0.6 + ph0);
      pos[i * 3 + 1] = (y + t * sp) % 9;
      pos[i * 3 + 2] = z + 0.15 * Math.cos(t * 0.5 + ph0);
    });
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparkMat.opacity = m.spark * (0.6 + 0.4 * hit);

    // robots glow with the beat
    this.robots.forEach((r, i) => r.traverse(o => { if (o.isMesh) o.material.emissiveIntensity = 0.03 + (hot ? 0.5 : 0.2) * (i ? (Math.floor(b) % 2 ? hit : 0) : (Math.floor(b) % 2 ? 0 : hit)); }));

    this.bloom.strength = 0.3 + (hot ? 0.18 * barHit : 0);
  }
}
