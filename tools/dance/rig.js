// Pose -> VRM normalized bones. Arms by direction vectors (chest space), legs by 2-bone IK to foot targets,
// so feet stay planted. Character faces +z; her left is +x. Side-specific vectors are given for the LEFT side
// and mirrored (x -> -x) for the right, so one move definition stays symmetric.
import * as THREE from 'three';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const Q = () => new THREE.Quaternion();
const E = (a, order = 'XYZ') => Q().setFromEuler(new THREE.Euler(a[0] || 0, a[1] || 0, a[2] || 0, order));
const RPI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const conj = q => RPI.clone().multiply(q).multiply(RPI.clone().invert());
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];

export class Rig {
  constructor(vrm) {
    this.vrm = vrm;
    this.h = vrm.humanoid;
    this.node = n => this.h.getNormalizedBoneNode(n);
    // vrm.scene keeps rotateVRM0's 180deg turn; we drive this container instead and work in its frame
    this.root = new THREE.Group();
    this.root.add(vrm.scene);
    this.root.updateMatrixWorld(true);
    const wp = n => { const o = this.node(n); return o ? o.getWorldPosition(new THREE.Vector3()) : null; };
    const r = this.rest = {};
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head']) r[n] = wp(n);
    for (const s of ['left', 'right']) {
      const ua = wp(s + 'UpperArm'), la = wp(s + 'LowerArm'), ha = wp(s + 'Hand'), mid = wp(s + 'MiddleProximal');
      const ul = wp(s + 'UpperLeg'), ll = wp(s + 'LowerLeg'), ft = wp(s + 'Foot'), toe = wp(s + 'Toes');
      r[s] = {
        upperDir: la.clone().sub(ua).normalize(), lowerDir: ha.clone().sub(la).normalize(), handDir: mid.clone().sub(ha).normalize(),
        armLen: la.distanceTo(ua) + ha.distanceTo(la),
        hipOff: ul.clone().sub(r.hips), L1: ll.distanceTo(ul), L2: ft.distanceTo(ll),
        thighDir: ll.clone().sub(ul).normalize(), shinDir: ft.clone().sub(ll).normalize(),
        foot: ft.clone(), toeLen: toe ? toe.distanceTo(ft) : 0.12,
      };
    }
    this.footY = (r.left.foot.y + r.right.foot.y) / 2;
    this.legLen = r.left.L1 + r.left.L2;
    this.stanceX = r.left.foot.x;
  }

  // default standing pose (arms relaxed down)
  static base() {
    return {
      root: { x: 0, z: 0, yaw: 0 },
      hips: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
      spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
      l: { sh: [0, 0, 0], up: [0.18, -1, 0.05], lo: [0.1, -1, 0.25], tw: 0, ftw: 0, hand: [0, 0, 0], fist: 0.25, peace: 0 },
      r: { sh: [0, 0, 0], up: [0.18, -1, 0.05], lo: [0.1, -1, 0.25], tw: 0, ftw: 0, hand: [0, 0, 0], fist: 0.25, peace: 0 },
      lf: { x: 0.11, y: 0, z: 0, yaw: 0.12, pitch: 0 },
      rf: { x: 0.11, y: 0, z: 0, yaw: 0.12, pitch: 0 },
      expr: { happy: 0.25, relaxed: 0, aa: 0, oh: 0, ih: 0, blink: 0, blinkLeft: 0, blinkRight: 0, surprised: 0 },
    };
  }

  apply(p) {
    const vrm = this.vrm, r = this.rest;
    this.root.position.set(p.root.x, p.root.y || 0, p.root.z);
    this.root.rotation.y = p.root.yaw;

    // torso
    const hips = this.node('hips');
    const hipsPos = r.hips.clone().add(V([p.hips.x, p.hips.y, p.hips.z]));
    hips.position.set(-hipsPos.x, hipsPos.y, -hipsPos.z);
    const qHips = E([p.hips.rx, p.hips.ry, p.hips.rz], 'YXZ');
    hips.quaternion.copy(conj(qHips));
    const qSpine = E(p.spine, 'YXZ'), qChest = E(p.chest, 'YXZ');
    this.node('spine').quaternion.copy(conj(qSpine));
    this.node('chest').quaternion.copy(conj(qChest));
    this.node('neck').quaternion.copy(conj(E(p.neck, 'YXZ')));
    this.node('head').quaternion.copy(conj(E(p.head, 'YXZ')));

    // arms (directions in chest space)
    for (const [s, key, m] of [['left', 'l', 1], ['right', 'r', -1]]) {
      const a = p[key], R = r[s];
      const mir = v => new THREE.Vector3(v[0] * m, v[1], v[2]).normalize();
      const qSh = E([a.sh[0], a.sh[1] * m, a.sh[2] * m], 'YXZ');
      this.node(s + 'Shoulder')?.quaternion.copy(conj(qSh));
      const upC = mir(a.up), loC = mir(a.lo);
      const upP = upC.clone().applyQuaternion(qSh.clone().invert());
      const qUp = Q().setFromUnitVectors(R.upperDir, upP);
      qUp.premultiply(Q().setFromAxisAngle(upP, a.tw * m));
      this.node(s + 'UpperArm').quaternion.copy(conj(qUp));
      const qAcc = qSh.clone().multiply(qUp);
      const loP = loC.clone().applyQuaternion(qAcc.clone().invert());
      const qLo = Q().setFromUnitVectors(R.lowerDir, loP);
      qLo.premultiply(Q().setFromAxisAngle(loP, a.ftw * m));
      this.node(s + 'LowerArm').quaternion.copy(conj(qLo));
      this.node(s + 'Hand').quaternion.copy(conj(E([a.hand[0], a.hand[1] * m, a.hand[2] * m])));
      this.fingers(s, m, a.fist, a.peace);
    }

    // legs: IK to foot targets (root space), knees toward the toes
    for (const [s, key, m] of [['left', 'lf', 1], ['right', 'rf', -1]]) {
      const f = p[key], R = r[s];
      const target = new THREE.Vector3(f.x * m, this.footY + f.y, f.z);
      const hipJoint = hipsPos.clone().add(R.hipOff.clone().applyQuaternion(qHips));
      const qHi = qHips.clone().invert();
      const d = target.clone().sub(hipJoint).applyQuaternion(qHi);
      const L1 = R.L1, L2 = R.L2;
      const len = THREE.MathUtils.clamp(d.length(), Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.9995);
      const dir = d.clone().normalize();
      const cosA = (L1 * L1 + len * len - L2 * L2) / (2 * L1 * len);
      const A = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
      const fwd = new THREE.Vector3(Math.sin(f.yaw * m), 0, Math.cos(f.yaw * m)).applyQuaternion(qHi);
      const perp = fwd.sub(dir.clone().multiplyScalar(fwd.dot(dir))).normalize();
      const thigh = dir.clone().multiplyScalar(Math.cos(A)).add(perp.clone().multiplyScalar(Math.sin(A)));
      const knee = thigh.clone().multiplyScalar(L1);
      const shin = dir.clone().multiplyScalar(len).sub(knee).normalize();
      const qTh = Q().setFromUnitVectors(R.thighDir, thigh);
      this.node(s + 'UpperLeg').quaternion.copy(conj(qTh));
      const shinL = shin.clone().applyQuaternion(qTh.clone().invert());
      const qSh = Q().setFromUnitVectors(R.shinDir, shinL);
      this.node(s + 'LowerLeg').quaternion.copy(conj(qSh));
      const want = E([f.pitch, f.yaw * m, 0], 'YXZ');
      const acc = qHips.clone().multiply(qTh).multiply(qSh);
      this.node(s + 'Foot').quaternion.copy(conj(acc.invert().multiply(want)));
    }

    this.applyExpr(p.expr);
  }

  applyExpr(expr) {
    const em = this.vrm.expressionManager;
    if (em) for (const [k, v] of Object.entries(expr)) if (em.getExpression(k)) em.setValue(k, THREE.MathUtils.clamp(v, 0, 1));
  }

  fingers(s, m, fist, peace) {
    for (const f of FINGERS) {
      const c = (peace > 0 && (f === 'Index' || f === 'Middle')) ? fist * (1 - peace) : (peace > 0 ? Math.max(fist, peace) : fist);
      const spread = (peace > 0 && f === 'Index') ? 0.32 * peace : (peace > 0 && f === 'Middle') ? -0.22 * peace : 0;
      [['Proximal', 1.25], ['Intermediate', 1.5], ['Distal', 1.0]].forEach(([j, k], i) => {
        const n = this.node(s + f + j); if (!n) return;
        n.quaternion.copy(conj(E([0, i === 0 ? spread * m : 0, -c * k * m])));
      });
    }
    const t1 = this.node(s + 'ThumbProximal'), t2 = this.node(s + 'ThumbDistal'), t0 = this.node(s + 'ThumbMetacarpal');
    const tc = peace > 0 ? Math.max(fist, peace) : fist;
    if (t0) t0.quaternion.copy(conj(E([0, -0.35 * tc * m, -0.15 * tc * m])));
    if (t1) t1.quaternion.copy(conj(E([0, -0.6 * tc * m, 0])));
    if (t2) t2.quaternion.copy(conj(E([0, -0.7 * tc * m, 0])));
  }
}

// ---- pose blending ----
export function lerpPose(a, b, t) {
  if (t <= 0) return a; if (t >= 1) return b;
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * t);
  const o = {};
  for (const k of Object.keys(a)) o[k] = k in b ? lerpPose(a[k], b[k], t) : a[k];
  for (const k of Object.keys(b)) if (!(k in a)) o[k] = b[k];
  return o;
}

export function clonePose(p) { return JSON.parse(JSON.stringify(p)); }
