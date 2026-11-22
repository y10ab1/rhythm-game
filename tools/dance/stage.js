// 孤夜's club stage (Gu_Ye_Stage FBX, cm units, built in Unity) -> meters, her standing spot at the origin, audience toward +z.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// stage-space point (cm) that becomes the world origin: centre-front of the round main stage, on its top surface
const SPOT_CM = new THREE.Vector3(6, -529.57, 2730);

export async function loadStage(manager) {
  const texNames = new Set(await (await fetch('/work/tex/index.json')).json());
  const fbx = await new FBXLoader(manager).loadAsync('/lib/3D/舞台/Gu_Ye_Stage/Guye_Stage.fbx');

  // alternate camera-cut variants of the same props: keep "Normal" only
  fbx.traverse(o => { if (/^(Cut_01|Cut_02)$/.test(o.name)) o.visible = false; });
  // Unity lights and fake-fog cards don't translate; we light it ourselves
  const drop = [];
  fbx.traverse(o => {
    if (o.isLight) drop.push(o);
    else if (o.isMesh && /fog|Buto/i.test(o.name + ' ' + [].concat(o.material).map(m => m.name).join(' '))) drop.push(o);
  });
  drop.forEach(o => o.parent && o.parent.remove(o));

  const loader = new THREE.TextureLoader(manager);
  const texCache = new Map();
  const tex = (name, srgb) => {
    if (!texNames.has(name)) return null;
    if (!texCache.has(name)) {
      const t = loader.load(`/work/tex/${name}.png`);
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      texCache.set(name, t);
    }
    return texCache.get(name);
  };

  // FBX diffuse textures are still loading when loadAsync resolves; wait so we can read their file names
  const maps = new Set();
  fbx.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => m.map && maps.add(m.map)); });
  await Promise.all([...maps].map(t => new Promise(ok => {
    const check = () => (t.image && (t.image.complete || t.image.width)) ? ok() : setTimeout(check, 50);
    check();
  })));

  const converted = new Map();
  const glow = [];      // emissive materials we pulse on the beat: { mat, base, kind }
  fbx.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = true;
    const mats = [].concat(o.material).map(m => {
      if (converted.has(m)) return converted.get(m);
      const src = m.map?.image?.src || m.map?.image?.currentSrc || '';
      const base = (src.match(/([^/]+)\.png/) || [])[1];
      const n = new THREE.MeshStandardMaterial({
        name: m.name, color: m.color.clone(), map: m.map || null,
        roughness: 0.55, metalness: 0.25,
        transparent: m.transparent, opacity: m.opacity, side: m.side,
      });
      if (n.map) n.map.colorSpace = THREE.SRGBColorSpace;
      if (base) {
        const nm = tex(base + '_n'), em = tex(base + '_e', true);
        if (nm) { n.normalMap = nm; n.normalScale.set(1, -1); }
        if (em) { n.emissiveMap = em; n.emissive.set(0xffffff); n.emissiveIntensity = 1.2; glow.push({ mat: n, base: 1.2, kind: /screen/i.test(m.name) ? 'screen' : 'tex' }); }
      }
      const lightish = /neon|color_light|led|lamp|light|text/i.test(m.name) || /^New_Material_(1[0246]|20)$/.test(m.name);
      const fbxEm = m.emissive && ![0, 0x808080].includes(m.emissive.getHex()) ? m.emissive : null;
      if (!n.emissiveMap && !n.map && (lightish || fbxEm)) {
        // unlit glow: lit standard materials on these LED meshes produce NaNs that the bloom pass smears across the frame
        const b = new THREE.MeshBasicMaterial({ name: m.name, color: (fbxEm || m.color).clone(), transparent: m.transparent, opacity: m.opacity, side: m.side });
        b.userData.baseColor = b.color.clone();
        // the big red under-stage ring / stair strips flood the bloom: keep them low
        if (/^(New_Material_20|M_Gu_Ye_color_light_01)$/.test(m.name)) b.userData.baseColor.multiplyScalar(0.25);
        glow.push({ mat: b, base: 1.4, kind: 'neon' });
        b.color.copy(b.userData.baseColor).multiplyScalar(1.4);
        converted.set(m, b);
        return b;
      }
      converted.set(m, n);
      return n;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });

  const root = new THREE.Group();
  root.name = 'stageRoot';
  fbx.scale.setScalar(0.01);
  fbx.rotation.y = Math.PI;
  fbx.position.set(SPOT_CM.x * 0.01, -SPOT_CM.y * 0.01, SPOT_CM.z * 0.01);
  root.add(fbx);
  root.updateMatrixWorld(true);
  return { root, fbx, glow };
}

// Club lighting: dim ambience, coloured key spots that follow her, beat-pulsed.
export function makeLights(scene, target) {
  const hemi = new THREE.HemisphereLight(0x6a6aff, 0x200818, 0.35);
  scene.add(hemi);
  const mk = (color, pos, intensity, angle, shadow) => {
    const s = new THREE.SpotLight(color, intensity, 40, angle, 0.45, 1.2);
    s.position.set(...pos); s.target = target;
    if (shadow) { s.castShadow = true; s.shadow.mapSize.set(2048, 2048); s.shadow.bias = -0.0004; s.shadow.camera.near = 1; s.shadow.camera.far = 30; }
    scene.add(s);
    return s;
  };
  const key = mk(0xfff2ea, [0, 9, 7], 70, 0.28, true);
  const magenta = mk(0xff2f9a, [-6, 7, 3], 60, 0.35, false);
  const cyan = mk(0x2fd8ff, [6, 7, 3], 60, 0.35, false);
  const back = mk(0x9a6bff, [0, 6, -4], 50, 0.4, false);
  // soft fill from the camera side so she stays readable on side / profile angles
  const fill = new THREE.DirectionalLight(0xe8e0ff, 0.45);
  fill.target = target; scene.add(fill);
  return { hemi, key, magenta, cyan, back, fill };
}
