// Plays a baked dance clip (tools/dance/mocap_prep.py) on the VRM: local bone rotations in the character frame
// (facing +z, her left = +x), root travel in x/z, and the lowest foot pinned to the floor.
import * as THREE from 'three';

const RPI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const RPIi = RPI.clone().invert();
const conj = q => RPI.clone().multiply(q).multiply(RPIi);
const FEET = ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'];

export class MocapPlayer {
  constructor(clip, rig) {
    this.clip = clip; this.rig = rig;
    this.names = Object.keys(clip.bones).filter(n => rig.node(n));
    // no upperChest on this model; any bone the clip lacks is held at rest
    this.rest = ['leftShoulder', 'rightShoulder', 'leftToes', 'rightToes', 'upperChest'].filter(n => !clip.bones[n] && rig.node(n));
    rig.root.updateMatrixWorld(true);
    this.footRest = Object.fromEntries(FEET.map(n => [n, rig.node(n)?.getWorldPosition(new THREE.Vector3()).y ?? 0]));
    this.q0 = new THREE.Quaternion(); this.q1 = new THREE.Quaternion();
  }

  sample(t) {
    const c = this.clip, f = THREE.MathUtils.clamp(t * c.fps, 0, c.n - 1.001);
    const i = Math.floor(f), a = f - i;
    const out = {};
    for (const n of this.names) {
      const B = c.bones[n];
      this.q0.fromArray(B, i * 4); this.q1.fromArray(B, i * 4 + 4);
      out[n] = this.q0.clone().slerp(this.q1, a);
    }
    const H = c.hips;
    out._hips = new THREE.Vector3(H[i * 3] * (1 - a) + H[i * 3 + 3] * a, 0, H[i * 3 + 2] * (1 - a) + H[i * 3 + 5] * a);
    return out;
  }

  // blend: optional { quats: {bone: Quaternion (normalized-node local)}, hips: Vector3, w } captured from a keyframed pose
  apply(t, blend = null) {
    const rig = this.rig, s = this.sample(t);
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.y = 0;
    for (const n of this.names) rig.node(n).quaternion.copy(conj(s[n]));
    for (const n of this.rest) rig.node(n).quaternion.identity();
    rig.fingers('left', 1, 0.3, 0); rig.fingers('right', -1, 0.3, 0);
    const hp = rig.rest.hips.clone().add(s._hips);
    rig.node('hips').position.set(-hp.x, hp.y, -hp.z);
    if (blend && blend.w > 0) {
      for (const [n, q] of Object.entries(blend.quats)) rig.node(n).quaternion.slerp(q, blend.w);
      rig.node('hips').position.lerp(blend.hips, blend.w);
    }
    // keep the lowest foot point on the floor
    rig.root.updateMatrixWorld(true);
    let lift = Infinity;
    for (const n of FEET) { const o = rig.node(n); if (o) lift = Math.min(lift, o.getWorldPosition(new THREE.Vector3()).y - this.footRest[n]); }
    if (Number.isFinite(lift)) rig.root.position.y = -lift;
    rig.root.updateMatrixWorld(true);
  }

  // snapshot of the bones a keyframed pose produced (to blend into)
  static capture(rig) {
    const quats = {};
    for (const n of Object.keys(rig.h.humanBones || {})) { const o = rig.node(n); if (o) quats[n] = o.quaternion.clone(); }
    return { quats, hips: rig.node('hips').position.clone() };
  }
}
