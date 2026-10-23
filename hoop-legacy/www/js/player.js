// Procedural basketball player: sculpted lathe-built body, posed every frame from sim state.
// Proportions are tied to reachOf() so the sim and the model agree on how high a hand gets.
import * as THREE from 'three';
import { HOOP_X, RIM_Y } from './game.js';
import { reachOf } from './data.js';

const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const ease = t => t * t * (3 - 2 * t);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const MOVE_SWITCH = { cross: 1, behind: 1, btl: 1 };
const TWO_HAND = { two: 1, cockback: 1, clutch: 1, '360': 1, reverse: 1, btl: 1 };
function wrapLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const matCache = new Map();
export function mat(color, rough = 0.75) {
  const key = color + '|' + rough;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 }));
  return matCache.get(key);
}
function shade(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }
function lum(hex) { const c = new THREE.Color(hex); return c.r * 0.3 + c.g * 0.59 + c.b * 0.11; }

function numberTexture(num, color, outline) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '900 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = outline;
  g.strokeText(String(num), 64, 68);
  g.fillStyle = color;
  g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const V2 = THREE.Vector2;
const lathe = (pts, segs = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new V2(Math.max(0.001, r), y)), segs);

// Muscled limb hanging down from its pivot: radius r1 at the top, r2 at the bottom,
// with a belly bulge centred `peak` of the way down.
function limbGeo(r1, r2, length, bulge = 0, peak = 0.4) {
  const pts = [];
  const y0 = -length + r2, y1 = -r1;
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + i / 4 * Math.PI / 2; pts.push([Math.cos(a) * r2, y0 + Math.sin(a) * r2]); }
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const bump = Math.exp(-((((1 - t) - peak) / 0.26) ** 2));
    pts.push([lerp(r2, r1, t) + bulge * bump, lerp(y0, y1, t)]);
  }
  for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; pts.push([Math.cos(a) * r1, y1 + Math.sin(a) * r1]); }
  return lathe(pts, 12);
}
// Bake each rig segment's static parts into one mesh per material: far fewer draw calls on phones.
function mergeStatic(group) {
  const byMat = new Map();
  for (const c of group.children) {
    if (!c.isMesh || c.material.map) continue;
    if (!byMat.has(c.material)) byMat.set(c.material, []);
    byMat.get(c.material).push(c);
  }
  for (const [material, list] of byMat) {
    if (list.length < 2) continue;
    const pos = [], nor = [];
    let shadow = false;
    for (const m of list) {
      m.updateMatrix();
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
      pos.push(g.attributes.position.array); nor.push(g.attributes.normal.array);
      shadow = shadow || m.castShadow;
      group.remove(m);
    }
    const cat = arrs => { const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(cat(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(cat(nor), 3));
    geo.computeBoundingSphere();
    group.add(mesh(geo, material, shadow));
  }
  for (const c of group.children.slice()) if (!c.isMesh) mergeStatic(c);
}
function mesh(geo, material, shadow = false) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = shadow;
  return m;
}

// ---- MakeHuman player pack (www/models), loaded once at startup; the procedural body is the fallback ----
let PACK = null;
const packCache = new Map();
function packTex(file) {
  if (!packCache.has(file)) {
    const t = new THREE.TextureLoader().load(PACK.base + file);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    packCache.set(file, t);
  }
  return packCache.get(file);
}
// Jersey/shorts: the cut (arm holes, V-neck, hems) is evaluated per pixel on the rest-pose position so the
// edges are smooth curves, with the trim colour in a band along them
const UNIFORM_GLSL = `
float uniCut(vec3 r) {
  if (uKind < 0.5) {
    float ax = abs(r.x);
    float top = r.z > 0.01 ? (ax < 0.06 ? 0.79 + 0.9 * ax : 0.844) : 0.836;
    vec2 e = vec2((ax - 0.13) / 0.066, (r.y - 0.80) / 0.125);
    return min(r.y - 0.50, min(top - r.y, (length(e) - 1.0) * 0.06));
  }
  return min(0.565 - r.y, r.y - 0.315);
}`;
function uniformMat(c1, c2, kind) {
  return packMat('uni|' + c1 + '|' + c2 + '|' + kind, () => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, side: THREE.DoubleSide });
    const u1 = { value: new THREE.Color(c1) }, u2 = { value: new THREE.Color(c2) }, uk = { value: kind };
    m.onBeforeCompile = sh => {
      sh.uniforms.uC1 = u1; sh.uniforms.uC2 = u2; sh.uniforms.uKind = uk;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uC1;\nuniform vec3 uC2;\nuniform float uKind;\nvarying vec3 vRest;' + UNIFORM_GLSL)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float cut = uniCut(vRest);
          if (cut < 0.0) discard;
          float band = uKind < 0.5 ? 0.0095 : 0.013;
          diffuseColor.rgb *= mix(uC2, uC1, smoothstep(band - 0.0012, band + 0.0012, cut));`);
    };
    m.customProgramCacheKey = () => 'uniform-cut';
    return m;
  });
}
function packMat(key, make) {
  if (!packCache.has(key)) packCache.set(key, make());
  return packCache.get(key);
}
export async function loadPlayerPack(base = 'models/') {
  try {
    const [man, bin] = await Promise.all([fetch(base + 'players.json').then(r => r.json()), fetch(base + 'players.bin').then(r => r.arrayBuffer())]);
    const geo = {};
    for (const [name, m] of Object.entries(man.meshes)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, m.pos, m.count * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, m.nor, m.count * 3), 3, true));
      g.setAttribute('uv', new THREE.Float16BufferAttribute(new Uint16Array(bin, m.uv, m.count * 2), 2));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(bin, m.si, m.count * 4), 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(bin, m.sw, m.count * 4), 4, true));
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin, m.idx, m.index), 1));
      if (m.rest != null) g.setAttribute('aRest', new THREE.BufferAttribute(new Float32Array(bin, m.rest, m.count * 3), 3));
      for (const gr of m.groups) g.addGroup(gr.start, gr.count, gr.mat);
      g.computeBoundingSphere();
      geo[name] = g;
    }
    PACK = { ...man, geo, base };
    return true;
  } catch (e) {
    console.warn('player pack unavailable, using procedural players', e);
    return false;
  }
}

export class PlayerModel {
  constructor(p, team, isUser) {
    const H = p.heightFt;
    this.H = H;
    if (PACK && !p.procedural) { this.buildFromPack(p, team); this.finish(H, isUser); return; }
    // Proportions (feet). Shoulder pivot height + arm + grip = reachOf(H).
    this.legLen = 0.5 * H;
    this.ankleH = 0.28;
    this.thigh = (this.legLen - 0.05 - this.ankleH) / 2;
    this.shin = this.thigh;
    this.torsoLen = 0.31 * H;
    this.shY = this.torsoLen - 0.2;
    this.ua = 0.19 * H;
    this.fa = 0.16 * H;
    this.grip = reachOf(H) - (this.legLen + this.shY + this.ua + this.fa);
    const rk = p.build === 'slim' ? 0.9 : p.build === 'strong' ? 1.12 : 1;
    const wk = p.build === 'slim' ? 0.93 : p.build === 'strong' ? 1.08 : 1;
    const skinC = p.skin || '#c68642';
    const skin = mat(skinC, 0.55);
    const skinDark = mat(shade(skinC, 0.72), 0.6);
    const jerseyC = team.c1, trimC = team.c2;
    const jersey = mat(jerseyC, 0.82);
    const jerseyIn = new THREE.MeshStandardMaterial({ color: shade(jerseyC, 0.6), roughness: 0.9, side: THREE.BackSide });
    const trim = mat(trimC, 0.7);
    const shoeC = p.shoe || '#f2f2f2';
    const shoeMat = mat(shoeC, 0.45);
    const soleMat = mat(lum(shoeC) > 0.5 ? '#2a2a2a' : '#f0f0f0', 0.8);
    const accent = mat(lum(shoeC) > 0.5 ? (lum(trimC) > 0.85 ? jerseyC : trimC) : '#ffffff', 0.5);
    const sockMat = mat('#f7f7f7', 0.9);
    const tl = this.torsoLen;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = this.legLen;
    this.body.add(this.pelvis);

    // Baggy shorts + waistband
    const shorts = mesh(lathe([[0, -0.42], [0.46, -0.41], [0.64, -0.3], [0.7, -0.1], [0.66, 0.2], [0.63, 0.3], [0, 0.31]], 18), jersey, true);
    shorts.scale.set(wk, 1, 0.7 * wk);
    this.pelvis.add(shorts);
    const band = mesh(new THREE.CylinderGeometry(0.645, 0.65, 0.13, 18), trim);
    band.scale.set(wk, 1, 0.7 * wk); band.position.y = 0.25;
    this.pelvis.add(band);

    // Torso: V-taper skin body with a tank-top jersey shell over it
    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);
    const prof = [[0.56, -0.15], [0.57, 0], [0.58, 0.25 * tl], [0.63, 0.5 * tl], [0.71, 0.72 * tl], [0.73, 0.85 * tl], [0.66, 0.95 * tl], [0.48, tl], [0.28, tl + 0.1], [0, tl + 0.14]];
    const chest = mesh(lathe(prof, 18), skin, true);
    chest.scale.set(wk, 1, 0.6 * wk);
    this.torso.add(chest);
    const shellTop = 0.97 * tl;
    const shellProf = prof.filter(([, y]) => y <= shellTop).map(([r, y]) => [r * 1.05, y]);
    shellProf.push([0.62 * 1.05, shellTop]);
    const shell = mesh(lathe(shellProf, 18), jersey, true);
    shell.scale.copy(chest.scale);
    this.torso.add(shell);
    const shellIn = mesh(shell.geometry, jerseyIn);
    shellIn.scale.copy(chest.scale);
    this.torso.add(shellIn);
    const collar = mesh(new THREE.TorusGeometry(0.64, 0.035, 6, 24), trim);
    collar.rotation.x = Math.PI / 2; collar.position.y = shellTop; collar.scale.set(wk, 0.6 * wk, 1);
    this.torso.add(collar);
    // V-neck trim and side panels
    for (const sx of [-1, 1]) {
      const v = mesh(new THREE.BoxGeometry(0.05, 0.42, 0.03), trim);
      v.position.set(sx * 0.13, shellTop - 0.17, 0.62 * 0.6 * wk * 1.05 + 0.005); v.rotation.z = sx * 0.55;
      this.torso.add(v);
      const side = mesh(new THREE.BoxGeometry(0.05, 0.62 * tl, 0.16), trim);
      side.position.set(sx * 0.6 * 1.06 * wk, 0.35 * tl, 0);
      this.torso.add(side);
      const delt = mesh(new THREE.SphereGeometry(0.25 * rk, 14, 10), skin, true);
      delt.scale.set(1, 1.05, 0.95);
      delt.position.set(sx * (0.72 * wk - 0.02), this.shY + 0.04, 0);
      this.torso.add(delt);
    }
    const traps = mesh(new THREE.CapsuleGeometry(0.2 * rk, 0.55, 4, 10), skin);
    traps.rotation.z = Math.PI / 2; traps.position.y = tl - 0.02; traps.scale.set(1, 1, 0.8);
    this.torso.add(traps);
    // Numbers
    const ntex = numberTexture(p.num, trimC, shade(jerseyC, 0.5));
    const nm = new THREE.MeshBasicMaterial({ map: ntex, transparent: true, depthWrite: false });
    const zf = 0.63 * 0.6 * wk * 1.05 + 0.012;
    const back = mesh(new THREE.PlaneGeometry(0.85, 0.85), nm);
    back.position.set(0, tl * 0.5, -zf - 0.01); back.rotation.y = Math.PI; this.torso.add(back);
    const front = mesh(new THREE.PlaneGeometry(0.52, 0.52), nm);
    front.position.set(0, tl * 0.56, zf + 0.01); this.torso.add(front);

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = tl;
    this.torso.add(this.neck);
    const neckM = mesh(new THREE.CapsuleGeometry(0.19 * rk, 0.3, 4, 10), skin);
    neckM.position.y = 0.2; this.neck.add(neckM);
    this.head = new THREE.Group();
    this.head.position.y = 0.7;
    this.neck.add(this.head);
    this.buildHead(p, skin, skinDark, skinC, team);

    // Arms: shoulder > elbow > wrist > hand
    const mkArm = (sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * 0.72 * wk, this.shY, 0);
      this.torso.add(sh);
      sh.add(mesh(limbGeo(0.19 * rk, 0.14 * rk, this.ua + 0.06, 0.035 * rk, 0.45), skin, true));
      const el = new THREE.Group(); el.position.y = -this.ua; sh.add(el);
      el.add(mesh(limbGeo(0.145 * rk, 0.1 * rk, this.fa + 0.04, 0.03 * rk, 0.28), skin, true));
      const wr = new THREE.Group(); wr.position.y = -this.fa; el.add(wr);
      const palm = mesh(new THREE.CapsuleGeometry(0.1, 0.14, 4, 8), skin);
      palm.scale.set(1.05, 1, 0.55); palm.position.y = -0.15; wr.add(palm);
      const fingers = mesh(new THREE.CapsuleGeometry(0.085, 0.14, 4, 8), skin);
      fingers.scale.set(1.1, 1, 0.5); fingers.position.set(0, -0.33, 0.025); fingers.rotation.x = -0.25; wr.add(fingers);
      const thumb = mesh(new THREE.CapsuleGeometry(0.042, 0.12, 3, 6), skin);
      thumb.position.set(-sx * 0.1, -0.14, 0.06); thumb.rotation.set(-0.4, 0, -sx * 0.5); wr.add(thumb);
      const hand = new THREE.Object3D(); hand.position.y = -0.2; wr.add(hand);
      const grip = new THREE.Object3D(); grip.position.y = -this.grip; wr.add(grip);
      // Where a ball held in this hand sits: against the palm
      const palmBall = new THREE.Object3D(); palmBall.position.set(0, -0.24, 0.44); wr.add(palmBall);
      return { sh, el, wr, hand, grip, palmBall, sx };
    };
    this.armL = mkArm(1); this.armR = mkArm(-1);
    if (p.sleeve) {
      const sl = mesh(limbGeo(0.165 * rk, 0.12 * rk, this.fa * 0.9, 0.03 * rk, 0.28), mat('#111111', 0.6));
      this.armR.el.add(sl);
      const up = mesh(limbGeo(0.205 * rk, 0.16 * rk, this.ua * 0.75, 0.035 * rk, 0.45), mat('#111111', 0.6));
      up.position.y = -this.ua * 0.25; this.armR.sh.add(up);
    }
    // Wristband on the off hand for some players
    if ((p.num || 0) % 3 === 0) {
      const wb = mesh(new THREE.CylinderGeometry(0.125 * rk, 0.125 * rk, 0.22, 10), mat(lum(jerseyC) > 0.85 ? trimC : jerseyC, 0.9));
      wb.position.y = -this.fa + 0.16; this.armL.el.add(wb);
    }

    // Legs: hip > knee > ankle > shoe
    const mkLeg = (sx) => {
      const hp = new THREE.Group(); hp.position.set(sx * 0.33 * wk, -0.05, 0); this.pelvis.add(hp);
      hp.add(mesh(limbGeo(0.27 * rk, 0.19 * rk, this.thigh + 0.08, 0.03 * rk, 0.35), skin, true));
      const sleeve = mesh(new THREE.CylinderGeometry(0.4 * wk, 0.42 * wk, this.thigh * 0.8, 14, 1, true), jersey, true);
      sleeve.position.y = -this.thigh * 0.36; hp.add(sleeve);
      const sleeveIn = mesh(sleeve.geometry, jerseyIn); sleeveIn.position.copy(sleeve.position); hp.add(sleeveIn);
      const hem = mesh(new THREE.CylinderGeometry(0.425 * wk, 0.425 * wk, 0.07, 14, 1, true), trim);
      hem.position.y = -this.thigh * 0.75; hp.add(hem);
      const stripe = mesh(new THREE.BoxGeometry(0.04, this.thigh * 0.72, 0.13), trim);
      stripe.position.set(sx * 0.405 * wk, -this.thigh * 0.37, 0); stripe.rotation.z = sx * 0.03; hp.add(stripe);
      const kn = new THREE.Group(); kn.position.y = -this.thigh; hp.add(kn);
      kn.add(mesh(limbGeo(0.19 * rk, 0.115 * rk, this.shin + 0.04, 0.05 * rk, 0.27), skin, true));
      const sock = mesh(new THREE.CylinderGeometry(0.158 * rk, 0.142 * rk, 0.5, 12), sockMat);
      sock.position.y = -this.shin + 0.22; kn.add(sock);
      const an = new THREE.Group(); an.position.y = -this.shin; kn.add(an);
      this.addShoe(an, sx, shoeMat, soleMat, accent, 1);
      return { hp, kn, an };
    };
    this.legL = mkLeg(1); this.legR = mkLeg(-1);
    this.finish(H, isUser);
  }

  // Shared by both body types: user ring/arrow, blob shadow, pose state
  finish(H, isUser) {
    if (isUser) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.9, 32),
        new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
      this.root.add(ring);
      this.ring = ring;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4), new THREE.MeshBasicMaterial({ color: '#ffd23f' }));
      arrow.rotation.x = Math.PI; arrow.position.y = H + 1.6;
      this.root.add(arrow);
      this.arrow = arrow;
    }
    const blob = new THREE.Mesh(new THREE.CircleGeometry(1.3, 16),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03;
    this.root.add(blob);
    this.blob = blob;

    mergeStatic(this.body);
    this.pose = this.defaultPose();
    this.pvel = {};
    this.runPhase = Math.random() * 6;
    this.handWorld = new THREE.Vector3();
    this.handWorldL = new THREE.Vector3();
    this.ballWorld = new THREE.Vector3();
    this.ballWorldL = new THREE.Vector3();
    this.ballWorld2 = new THREE.Vector3();
    this.extraSpin = 0;
    this.yOff = 0;
    this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._t = new THREE.Vector3();
  }

  // MakeHuman body (see tools/build_models.py): one skinned mesh bound to the same rig the poses drive,
  // so every animation, the rim IK and the ball attachment work unchanged.
  buildFromPack(p, team) {
    const H = this.H, P = PACK, J = P.joints;
    const wk = p.build === 'slim' ? 0.94 : p.build === 'strong' ? 1.07 : 1;
    const d = (a, b) => Math.hypot(J[a][0] - J[b][0], J[a][1] - J[b][1], J[a][2] - J[b][2]) * H;
    this.legLen = J.pelvis[1] * H;
    this.ankleH = J.ankle[1] * H;
    this.thigh = d('hip', 'knee');
    this.shin = d('knee', 'ankle');
    this.torsoLen = (J.neck[1] - J.pelvis[1]) * H;
    this.shY = (J.shoulder[1] - J.pelvis[1]) * H;
    this.ua = d('shoulder', 'elbow');
    this.fa = d('elbow', 'wrist');
    this.grip = reachOf(H) - (this.legLen + this.shY + this.ua + this.fa);
    const tl = this.torsoLen;
    const jerseyC = team.c1, trimC = team.c2;

    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.pelvis = new THREE.Group(); this.pelvis.position.y = this.legLen; this.body.add(this.pelvis);
    this.torso = new THREE.Group(); this.pelvis.add(this.torso);
    this.neck = new THREE.Group(); this.neck.position.y = tl; this.torso.add(this.neck);
    this.head = new THREE.Group(); this.head.position.set(0, (J.crown[1] - J.neck[1]) * H * 0.55, 0.04 * H); this.neck.add(this.head);
    const mkArm = (sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * J.shoulder[0] * H * wk, this.shY, 0); this.torso.add(sh);
      const el = new THREE.Group(); el.position.y = -this.ua; sh.add(el);
      const wr = new THREE.Group(); wr.position.y = -this.fa; el.add(wr);
      const hand = new THREE.Object3D(); hand.position.y = -0.045 * H; wr.add(hand);
      const grip = new THREE.Object3D(); grip.position.y = -this.grip; wr.add(grip);
      const palmBall = new THREE.Object3D(); palmBall.position.set(0, -0.05 * H, 0.07 * H); wr.add(palmBall);
      return { sh, el, wr, hand, grip, palmBall, sx };
    };
    this.armL = mkArm(1); this.armR = mkArm(-1);
    const mkLeg = (sx) => {
      const hp = new THREE.Group(); hp.position.set(sx * J.hip[0] * H * wk, (J.hip[1] - J.pelvis[1]) * H, 0); this.pelvis.add(hp);
      const kn = new THREE.Group(); kn.position.y = -this.thigh; hp.add(kn);
      const an = new THREE.Group(); an.position.y = -this.shin; kn.add(an);
      return { hp, kn, an };
    };
    this.legL = mkLeg(1); this.legR = mkLeg(-1);

    // Bind pose = the mesh's A-pose: aim each segment at its landmark, keep the feet flat
    const aimAt = (g, parentInvDir, from, to) => {
      const v = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).applyQuaternion(parentInvDir).normalize();
      return v;
    };
    const L = (k, sx) => [J[k][0] * sx * wk, J[k][1], J[k][2]];
    const q = new THREE.Quaternion();
    for (const [arm, sx] of [[this.armL, 1], [this.armR, -1]]) {
      const v = aimAt(arm.sh, q.identity(), L('shoulder', sx), L('elbow', sx));
      arm.sh.rotation.set(Math.atan2(-v.z, -v.y), 0, Math.asin(Math.max(-1, Math.min(1, v.x))));
      arm.sh.updateMatrixWorld(true);
      const inv = arm.sh.getWorldQuaternion(new THREE.Quaternion()).invert();
      const f = aimAt(arm.el, inv, L('elbow', sx), L('wrist', sx));
      arm.el.rotation.x = Math.atan2(-f.z, -f.y);
      arm.el.updateMatrixWorld(true);
      const inv2 = arm.el.getWorldQuaternion(new THREE.Quaternion()).invert();
      const h = aimAt(arm.wr, inv2, L('wrist', sx), L('tip', sx));
      arm.wr.rotation.x = Math.atan2(-h.z, -h.y);
      arm.wr.rotation.y = -sx * Math.PI / 2; // MakeHuman palms face the thighs; yaw 0 turns them forward
    }
    for (const [leg, sx] of [[this.legL, 1], [this.legR, -1]]) {
      const v = aimAt(leg.hp, q.identity(), L('hip', sx), L('knee', sx));
      leg.hp.rotation.set(Math.atan2(-v.z, -v.y), 0, Math.asin(Math.max(-1, Math.min(1, v.x))));
      leg.hp.updateMatrixWorld(true);
      const inv = leg.hp.getWorldQuaternion(new THREE.Quaternion()).invert();
      const s2 = aimAt(leg.kn, inv, L('knee', sx), L('ankle', sx));
      leg.kn.rotation.x = Math.atan2(-s2.z, -s2.y);
      leg.kn.updateMatrixWorld(true);
      leg.an.quaternion.copy(leg.kn.getWorldQuaternion(new THREE.Quaternion()).invert()); // foot level in the world
    }
    this.root.updateMatrixWorld(true);
    this.packed = true;
    const bones = [this.pelvis, this.torso, this.neck, this.armL.sh, this.armL.el, this.armL.wr, this.armR.sh, this.armR.el, this.armR.wr,
      this.legL.hp, this.legL.kn, this.legL.an, this.legR.hp, this.legR.kn, this.legR.an];
    const skeleton = new THREE.Skeleton(bones);
    const skinned = (geo, material) => {
      const m = new THREE.SkinnedMesh(geo, material);
      m.scale.set(H * wk, H, H * wk);
      m.castShadow = true; m.frustumCulled = false;
      this.root.add(m);
      m.updateMatrixWorld(true);
      m.bind(skeleton);
      return m;
    };
    // Skin: closest texture, tinted to the exact tone
    const tone = new THREE.Color(p.skin || '#c68642');
    const lumT = tone.r * 0.3 + tone.g * 0.59 + tone.b * 0.11;
    const lumOf = c => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const toneS = tone.clone().convertLinearToSRGB();
    const sk = Object.keys(P.skins).reduce((a, b) => Math.abs(lumOf(P.skins[a].mean) - (toneS.r * 0.3 + toneS.g * 0.59 + toneS.b * 0.11)) <= Math.abs(lumOf(P.skins[b].mean) - (toneS.r * 0.3 + toneS.g * 0.59 + toneS.b * 0.11)) ? a : b);
    const mean = new THREE.Color().setRGB(...P.skins[sk].mean, THREE.SRGBColorSpace);
    const tint = new THREE.Color(Math.min(2.2, tone.r / mean.r), Math.min(2.2, tone.g / mean.g), Math.min(2.2, tone.b / mean.b));
    void lumT;
    skinned(P.geo.body, packMat('skin_' + sk + '|' + tint.getHexString(), () => new THREE.MeshStandardMaterial({ map: packTex(P.skins[sk].tex), color: tint, roughness: 0.62 })));
    skinned(P.geo.jersey, uniformMat(jerseyC, trimC, 0));
    skinned(P.geo.shorts, uniformMat(jerseyC, trimC, 1));
    const hair = p.hair === 'Locs' ? 'Fade' : p.hair; // Locs retired; old saves get a Fade
    const style = P.hair[hair];
    if (P.geo.eyes) skinned(P.geo.eyes, packMat('eyes', () => new THREE.MeshStandardMaterial({ map: packTex('eyes_brown.jpg'), roughness: 0.3 })));
    if (style) skinned(P.geo[style.mesh], packMat('hair_' + hair, () => new THREE.MeshStandardMaterial({ map: packTex(style.tex), color: '#5a5450', alphaTest: 0.6, side: THREE.DoubleSide, roughness: 0.85 })));

    // Numbers on the chest and back, sneakers and socks, accessories
    const ntex = numberTexture(p.num, trimC, shade(jerseyC, 0.5));
    const nm = new THREE.MeshBasicMaterial({ map: ntex, transparent: true, depthWrite: false });
    const back = mesh(new THREE.PlaneGeometry(0.17 * H * wk, 0.17 * H), nm);
    back.position.set(0, 0.2 * H, -0.058 * H * wk); back.rotation.y = Math.PI; this.torso.add(back);
    const front = mesh(new THREE.PlaneGeometry(0.1 * H * wk, 0.1 * H), nm);
    front.position.set(0, 0.2 * H, 0.094 * H * wk); front.rotation.x = -0.12; this.torso.add(front);
    const shoeC = p.shoe || '#f2f2f2';
    const shoeMat = mat(shoeC, 0.45), soleMat = mat(lum(shoeC) > 0.5 ? '#2a2a2a' : '#f0f0f0', 0.8);
    const accent = mat(lum(shoeC) > 0.5 ? (lum(trimC) > 0.85 ? jerseyC : trimC) : '#ffffff', 0.5);
    for (const [leg, sx] of [[this.legL, 1], [this.legR, -1]]) {
      const sock = mesh(new THREE.CylinderGeometry(0.024 * H, 0.021 * H, 0.06 * H, 12), mat('#f7f7f7', 0.9));
      sock.position.y = 0.03 * H; leg.an.add(sock);
      this.addShoe(leg.an, sx, shoeMat, soleMat, accent, 0.155 * H);
    }
    if (p.headband) {
      const hb = mesh(new THREE.CylinderGeometry(0.05 * H, 0.05 * H, 0.014 * H, 24, 1, true), mat(team.c2 === '#f4f4f4' ? '#ffffff' : team.c2, 0.9));
      hb.scale.set(0.98, 1, 1.18); hb.position.set(0, 0.034 * H, 0.004 * H); hb.rotation.x = -0.18; this.head.add(hb);
    }
    if (p.sleeve) {
      const sl = mesh(limbGeo(0.022 * H, 0.017 * H, this.fa * 0.92, 0.003 * H, 0.28), mat('#111111', 0.6));
      this.armR.el.add(sl);
    }
    if ((p.num || 0) % 3 === 0) {
      const wb = mesh(new THREE.CylinderGeometry(0.02 * H, 0.02 * H, 0.03 * H, 10), mat(lum(jerseyC) > 0.85 ? trimC : jerseyC, 0.9));
      wb.position.y = -this.fa + 0.02 * H; this.armL.el.add(wb);
    }
  }

  // Sneaker on an ankle group: rubber sole, upper, collar, accent stripes (s scales it to the foot)
  addShoe(an, sx, shoeMat, soleMat, accent, s) {
    const g = new THREE.Group(); g.scale.setScalar(s); g.position.y = -this.ankleH + 0.28 * s; an.add(g);
    const soleG = new THREE.CapsuleGeometry(0.205, 0.62, 4, 10); soleG.rotateX(Math.PI / 2);
    const sole = mesh(soleG, soleMat); sole.scale.set(1.05, 0.32, 1); sole.position.set(0, -0.22, 0.17); g.add(sole);
    const upG = new THREE.CapsuleGeometry(0.185, 0.52, 4, 10); upG.rotateX(Math.PI / 2);
    const upper = mesh(upG, shoeMat, true); upper.scale.set(1, 0.72, 1); upper.position.set(0, -0.11, 0.16); g.add(upper);
    const collarS = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 10), shoeMat); collarS.position.set(0, -0.06, -0.02); g.add(collarS);
    const sw = mesh(new THREE.BoxGeometry(0.02, 0.07, 0.42), accent);
    sw.position.set(sx * 0.19, -0.12, 0.14); sw.rotation.x = -0.18; g.add(sw);
    const sw2 = sw.clone(); sw2.position.x = -sx * 0.19; g.add(sw2);
  }

  buildHead(p, skin, skinDark, skinC, team) {
    const head = this.head;
    const skull = mesh(new THREE.SphereGeometry(0.4, 20, 16), skin, true);
    skull.scale.set(0.86, 1.06, 0.96);
    head.add(skull);
    const jaw = mesh(new THREE.SphereGeometry(0.28, 14, 10), skin);
    jaw.position.set(0, -0.2, 0.07); jaw.scale.set(0.95, 0.8, 1); head.add(jaw);
    const chin = mesh(new THREE.SphereGeometry(0.12, 10, 8), skin);
    chin.position.set(0, -0.33, 0.2); chin.scale.set(1.1, 0.8, 0.9); head.add(chin);
    const nose = mesh(new THREE.SphereGeometry(0.075, 10, 8), skinDark);
    nose.position.set(0, -0.06, 0.38); nose.scale.set(0.85, 1.1, 0.9); head.add(nose);
    const brow = mesh(new THREE.CapsuleGeometry(0.045, 0.3, 3, 8), skin);
    brow.rotation.z = Math.PI / 2; brow.position.set(0, 0.1, 0.33); head.add(brow);
    const mouth = mesh(new THREE.BoxGeometry(0.15, 0.025, 0.02), mat(shade(skinC, 0.45), 0.6));
    mouth.position.set(0, -0.2, 0.345); head.add(mouth);
    const white = mat('#f4f1ea', 0.4), iris = mat('#1a120c', 0.3), hairC = mat('#16110d', 0.9);
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.085, 8, 6), skin);
      ear.position.set(sx * 0.345, -0.03, 0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
      const eye = mesh(new THREE.SphereGeometry(0.052, 8, 6), white);
      eye.position.set(sx * 0.13, 0.02, 0.32); eye.scale.set(1.1, 0.7, 0.6); head.add(eye);
      const pupil = mesh(new THREE.SphereGeometry(0.028, 6, 6), iris);
      pupil.position.set(sx * 0.13, 0.02, 0.352); head.add(pupil);
      const eb = mesh(new THREE.BoxGeometry(0.13, 0.028, 0.03), hairC);
      eb.position.set(sx * 0.13, 0.1, 0.36); eb.rotation.z = -sx * 0.12; head.add(eb);
    }
    this.addHair(p.hair === 'Locs' ? 'Fade' : p.hair, head);
    // Facial hair on some players (stable per player)
    const seed = ((p.num || 0) * 7 + (p.name || '').length * 13) % 10;
    if (seed < 3 && p.hair !== 'Bald') {
      const beard = mesh(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.4), hairC);
      beard.position.set(0, -0.13, 0.05); beard.scale.set(0.93, 1.05, 1.02); head.add(beard);
    }
    if (p.headband) {
      const hb = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 18, 1, true), mat(team.c2 === '#f4f4f4' ? '#ffffff' : team.c2, 0.9));
      hb.position.y = 0.17; hb.scale.set(0.9, 1, 0.99); head.add(hb);
    }
  }

  addHair(style, head) {
    const hairMat = mat('#16110d', 0.95);
    if (style === 'Bald') return;
    if (style === 'Afro') {
      const g = new THREE.IcosahedronGeometry(0.6, 3);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const n = 1 + 0.05 * Math.sin(x * 23 + y * 7) * Math.cos(z * 19 - y * 11);
        pos.setXYZ(i, x * n, y * n, z * n);
      }
      g.computeVertexNormals();
      const a = mesh(g, hairMat); a.position.set(0, 0.17, -0.04); a.scale.set(0.95, 0.9, 0.95); head.add(a);
      return;
    }
    const cap = mesh(new THREE.SphereGeometry(0.418, 18, 12, 0, Math.PI * 2, 0, style === 'Buzz' ? 1.3 : 1.55), hairMat);
    cap.position.set(0, 0.04, -0.01); cap.rotation.x = -0.25; cap.scale.set(0.9, style === 'Fade' ? 1.12 : 1.04, 1.0); head.add(cap);
    if (style === 'Fade') {
      const top = mesh(new THREE.SphereGeometry(0.36, 16, 10, 0, Math.PI * 2, 0, 1.1), hairMat);
      top.position.set(0, 0.16, 0); top.scale.set(0.95, 0.9, 1.05); head.add(top);
    }
  }

  defaultPose() {
    return { crouch: 0.2, lean: 0.1, tilt: 0, twist: 0, headX: 0, headY: 0,
      sLx: 0.1, sLz: 0.12, eL: -0.3, sRx: 0.1, sRz: -0.12, eR: -0.3, wL: 0, wR: 0,
      hLx: 0, hLz: 0.04, kL: 0.2, hRx: 0, hRz: -0.04, kR: 0.2, fL: 0, fR: 0, bob: 0, roll: 0, side: 0, twL: 1.2, twR: 1.2 };
  }

  // Build a target pose from the sim state, blend toward it, and apply. Returns how the ball is carried.
  update(p, game, dt, time) {
    const T = this.defaultPose();
    const spd = Math.hypot(p.vel.x, p.vel.z);
    const runAmt = Math.min(1, spd / 18);
    const act = p.action;
    const k = act ? clamp01(p.actionT / p.actionDur) : 0;
    const onD = game.offense !== p.team;
    // Lateral vs forward motion relative to facing (for defensive slides)
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
    const fwd = spd > 0.5 ? (p.vel.x * fx + p.vel.z * fz) / spd : 1;

    // Idle breathing
    T.bob = Math.sin(time * 2.2 + this.runPhase) * 0.02;

    this.runPhase += dt * (3 + spd * 0.55);
    const ph = this.runPhase;
    if (spd > 1.5) {
      // Run cycle: thigh drives forward, swing knee folds high, toes push off behind,
      // arms pump bent at the elbow against the legs, shoulders counter-rotate the hips
      const A = 0.28 + runAmt * 0.78;
      const s = Math.sin(ph);
      T.hLx = -s * A; T.hRx = s * A;
      T.kL = 0.22 + Math.max(0, Math.sin(ph + 1.25)) * A * 1.75;
      T.kR = 0.22 + Math.max(0, -Math.sin(ph + 1.25)) * A * 1.75;
      T.fL = Math.max(0, -s) * 0.7 * A; T.fR = Math.max(0, s) * 0.7 * A;
      T.sLx = s * A * 0.95; T.sRx = -s * A * 0.95;
      T.sLz = 0.1; T.sRz = -0.1;
      T.eL = -1.2 - runAmt * 0.35 + s * 0.25; T.eR = -1.2 - runAmt * 0.35 - s * 0.25;
      T.wL = T.wR = -0.15;
      T.lean = 0.1 + runAmt * 0.28;
      T.bob = Math.abs(Math.cos(ph)) * 0.2 * A;
      T.crouch = 0.22;
      T.twist = -s * 0.16 * A;
      T.tilt = Math.cos(ph) * 0.04 * A;
    }
    // Off the ball and not busy: keep an eye on the ball
    if (!p.hasBall && !act && game.ball && game.ball.pos) {
      let rel = Math.atan2(game.ball.pos.x - p.pos.x, game.ball.pos.z - p.pos.z) - p.facing;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      T.headY = Math.max(-0.85, Math.min(0.85, rel)) * 0.8;
    }
    if (onD && !p.hasBall && !act && spd < 15) {
      // Defensive stance with slides
      T.crouch = 0.8; T.lean = 0.32; T.headX = -0.25;
      T.sLz = 0.95; T.sRz = -0.95; T.sLx = -0.6; T.sRx = -0.4; T.eL = -0.55; T.eR = -0.5;
      T.hLz = 0.3; T.hRz = -0.3; T.kL = 0.9; T.kR = 0.9; T.hLx = -0.25; T.hRx = -0.25;
      if (spd > 1.5 && Math.abs(fwd) < 0.6) {
        const sl = Math.sin(ph * 1.4);
        T.hLz = 0.3 + sl * 0.22; T.hRz = -0.3 + sl * 0.22;
        T.bob = Math.abs(sl) * 0.08;
      } else if (spd > 1.5) {
        T.hLx = -0.25 - Math.sin(ph) * 0.4; T.hRx = -0.25 + Math.sin(ph) * 0.4;
      }
      // Active hands
      T.sLx += Math.sin(time * 6 + p.idx) * 0.15;
      if (p.intenseD) { T.crouch = 1.0; T.sLz = 1.25; T.sRz = -1.25; T.hLz = 0.4; T.hRz = -0.4; }
      // Closing out on a shooter: hand straight up in his face
      if (p.closeT > game.time) { T.sRx = -2.95; T.sRz = -0.1; T.eR = -0.05; T.crouch = 0.5; T.lean = 0.15; T.sLx = -0.9; T.sLz = 0.7; }
      if (p.boxing) {
        // Box out: low, wide, arms back to feel the opponent
        T.crouch = 0.95; T.lean = 0.45; T.hLz = 0.45; T.hRz = -0.45; T.kL = 1.0; T.kR = 1.0;
        T.sLz = 1.3; T.sRz = -1.3; T.sLx = 0.45; T.sRx = 0.45; T.eL = -0.5; T.eR = -0.5;
      }
    }

    let ball = null; // 'dribble' | 'vmove' | 'hand' | 'both' | 'over' | 'R'
    const domR = p.dribbleHand === 'R';
    const setArm = (dom, x, z, e) => { if (dom) { T.sRx = x; T.sRz = -z; T.eR = e; } else { T.sLx = x; T.sLz = z; T.eL = e; } };

    if (p.hasBall && !act) {
      if (p.holding || p.inbounding) {
        // Triple threat / inbound hold
        T.sLx = -0.9; T.sRx = -0.9; T.eL = -1.35; T.eR = -1.35; T.sLz = 0.25; T.sRz = -0.25;
        T.crouch = p.inbounding ? 0.3 : 0.6; T.kL = 0.65; T.kR = 0.65; T.lean = 0.2;
        if (p.inbounding) { T.sLx = T.sRx = -2.6; T.eL = T.eR = -0.9; }
        ball = p.inbounding ? 'over' : 'both';
      } else if (p.post) {
        // Back to the basket: low base, arm bar into the defender, pound dribble on the outside
        const d = p.dribblePhase;
        T.crouch = 0.85; T.lean = 0.35; T.hLz = 0.38; T.hRz = -0.38; T.kL = 1.0; T.kR = 1.0; T.hLx = -0.3; T.hRx = -0.3;
        setArm(domR, -0.35 + Math.cos(d * Math.PI * 2) * 0.28, 0.35, -0.5);
        setArm(!domR, 0.75, 0.75, -1.1);
        const bump = game.time - (p.bumpAt || -9);
        if (bump < 0.36) { const f = Math.sin(bump / 0.36 * Math.PI); T.lean = 0.35 - f * 0.65; T.crouch = 1.0; T.twist = f * 0.45 * (domR ? 1 : -1); setArm(!domR, 0.75 + f * 0.5, 0.9, -1.3); T.hLx = -0.3 + f * 0.35; }
        ball = 'dribble';
      } else {
        // Dribbling: off-arm protects, knees bent, ball pounded
        const d = p.dribblePhase;
        const pump = Math.cos(d * Math.PI * 2) * 0.32;
        setArm(domR, -0.5 + pump - runAmt * 0.3, 0.28, -0.65 - pump * 0.4);
        if (spd < 6) { setArm(!domR, -0.75, 0.65, -0.7); T.twist = domR ? 0.18 : -0.18; }
        T.crouch = Math.max(T.crouch, 0.55); T.kL = Math.max(T.kL, 0.6); T.kR = Math.max(T.kR, 0.6);
        T.lean = Math.max(T.lean, 0.28);
        ball = 'dribble';
      }
    }

    let yJump = p.y;
    let spin = 0;
    switch (act) {
      case 'shoot': {
        // Dip with the ball low, drive it up as the legs extend; the release (meter full) is at the top of the jump
        const t = p.actionT || 0, ja = p.jumpAt || 0.2;
        const tLoad = Math.min(0.2, ja * 0.6);
        const g = ease(clamp01(t / tLoad));
        const dip = ease(clamp01((t - tLoad * 0.4) / Math.max(0.05, ja - tLoad * 0.4)));
        const up = clamp01((t - ja) / 0.12);
        const rel = p.released;
        T.crouch = t < ja ? lerp(0.3, 0.95, dip) : lerp(0.95, 0.02, up);
        T.kL = T.kR = t < ja ? lerp(0.35, 1.15, dip) : lerp(1.15, 0.08, up);
        T.lean = t < ja ? 0.12 * dip : 0;
        T.hLx = T.hRx = 0; T.hLz = 0.06; T.hRz = -0.06;
        if (p.shotStyle === 'hook') {
          T.sRz = lerp(-0.4, -2.95, g); T.sRx = -0.3; T.eR = -0.2;
          T.sLx = -0.7; T.sLz = 1.0; T.eL = -0.9;
          T.tilt = -0.25; T.hLx = -1.2; T.kL = 1.4; T.lean = 0;
          T.wR = rel ? 0.9 : -0.3;
          if (!rel) ball = 'R';
        } else {
          // One-hand jumper in six beats: setup (ball at the waist), dip (ball and knees drop), drive
          // (legs extend, ball comes up to the forehead), lift (set point above the forehead, palm under
          // the ball, wrist cocked), release at the top of the jump (arm extends as the meter fills) and
          // the follow-through (gooseneck held, guide hand off).
          const drive = ease(clamp01((t - ja + 0.04) / 0.14));
          const lift = ease(clamp01((t - ja - 0.08) / 0.14));
          const ext = rel ? 1 : ease(clamp01(((p.meter || 0) - 0.72) / 0.28));
          const hi = p.shotStyle === 'fade' ? -0.2 : 0;
          const low = lerp(-0.55, -0.3, dip), lowE = lerp(-1.3, -1.05, dip);
          T.sRx = lerp(lerp(lerp(low, -1.95, drive), -2.3, lift), -2.75 + hi, ext); T.sRz = lerp(-0.3, -0.05, drive);
          T.eR = lerp(lerp(lerp(lowE, -1.45, drive), -1.4, lift), -0.05, ext);
          T.wR = rel ? 1.2 : lerp(0, lerp(-0.6, -0.85, lift), drive);
          if (!rel) {
            T.sLx = lerp(lerp(low, -1.85, drive), -2.15 + hi * 0.5, lift); T.sLz = lerp(0.3, 0.38, drive);
            T.eL = lerp(lerp(lowE, -1.1, drive), -1.15, lift); T.wL = -0.2;
          } else {
            // Guide hand comes off the ball, shooting hand holds the gooseneck
            T.sLx = -1.9; T.sLz = 0.7; T.eL = -0.75; T.wL = 0.4;
          }
          T.headX = lerp(0.15, -0.2, drive);
          T.lean = t < ja ? 0.1 * dip : -0.06; T.headX = -0.2;
          if (p.shotStyle === 'fade') {
            // Kobe/MJ fadeaway: lean back, lead knee up, release high
            const up = clamp01((k - 0.18) / 0.25);
            T.lean = -0.5 * up; T.hLx = -1.15 * up; T.kL = 0.3 + 1.1 * up; T.hRx = 0.25 * up; T.kR = 0.15; T.headX = -0.15 * up;
            if (p.turnaround) spin = (p.turnSide || 1) * Math.PI * (1 - ease(clamp01(k / 0.28)));
          }
          if (!rel) ball = drive < 0.35 ? 'both' : 'R';
        }
        if (p.ft) { T.hLx = T.hRx = 0; }
        break;
      }
      case 'layup': {
        T.hLx = -1.45; T.kL = 1.7; T.hRx = 0.25; T.kR = 0.3;
        T.sRx = lerp(-1.2, -3.05, Math.min(1, k * 1.7)); T.eR = -0.12;
        T.sLx = -0.9; T.sLz = 0.5; T.eL = -0.9; T.lean = 0.05; T.headX = -0.3;
        T.wR = p.released ? 0.9 : -0.4; T.fR = 0.3;
        if (!p.released) ball = k < 0.25 ? 'both' : 'R';
        break;
      }
      case 'dunk': {
        const st = p.dunkStyle || 'two';
        const rel = p.releaseAt ? p.releaseAt / p.actionDur : 0.58;
        const jf = p.jumpAtF ? p.jumpAtF / p.actionDur : 0.25;
        if (k < jf) {
          // Gather: big last step, ball to chest
          const g = k / jf;
          const load = Math.sin(g * Math.PI * 0.5);
          T.crouch = lerp(0.4, 1.15, load); T.lean = lerp(0.3, 0.55, load); T.hLx = -0.85; T.hRx = 0.6; T.kL = 1.2; T.kR = 1.0;
          T.sLx = T.sRx = lerp(-1.0, -0.35, load); T.eL = T.eR = -1.35; T.sLz = 0.3; T.sRz = -0.3;
          T.fR = 0.35 * load; T.headX = -0.25;
          ball = 'both';
        } else if (k < rel) {
          const g = ease((k - jf) / (rel - jf));
          T.crouch = 0.05; T.lean = -0.08; T.headX = -0.35;
          T.fL = T.fR = 0.35; T.wL = T.wR = -0.4;
          if (st === 'one') {
            T.sRx = lerp(-1.4, -3.25, g); T.eR = lerp(-1.2, -1.3, g); T.sLx = -1.3; T.sLz = 0.9; T.eL = -0.5;
            T.hLx = -1.4; T.kL = 1.7; T.hRx = 0.25; T.kR = 0.6; ball = 'R';
          } else if (st === 'tomahawk') {
            T.sRx = lerp(-1.6, -3.7, g); T.eR = -1.7; T.sLx = -1.1; T.sLz = 0.7; T.eL = -0.6;
            T.hLx = -0.9; T.hRx = -0.7; T.kL = 1.9; T.kR = 1.9; T.lean = -0.3; ball = 'R';
          } else if (st === 'cockback') {
            // Two hands cocked way behind the head, knees tucked
            T.sLx = T.sRx = lerp(-1.6, -3.65, g); T.eL = T.eR = -1.75; T.sLz = 0.25; T.sRz = -0.25;
            T.hLx = T.hRx = -0.9; T.kL = T.kR = 1.8; T.lean = -0.35; ball = 'over';
          } else if (st === 'clutch') {
            // Ball tucked at the chest on the way up, then thrown down late
            const late = clamp01((g - 0.6) / 0.4);
            T.sLx = T.sRx = lerp(-1.0, -3.1, late); T.eL = T.eR = lerp(-1.35, -0.4, late); T.sLz = 0.3; T.sRz = -0.3;
            T.hLx = T.hRx = -1.0; T.kL = T.kR = 1.9; T.crouch = 0.3; ball = late > 0.2 ? 'over' : 'both';
          } else if (st === 'windmill') {
            // Arm swings down, back and all the way over the top
            T.sRx = lerp(-1.2, Math.PI + 0.1, g); T.eR = -0.1; T.sRz = -0.15;
            T.sLx = -1.0; T.sLz = 0.9; T.eL = -0.5;
            T.hLx = -1.3; T.kL = 1.7; T.hRx = 0.3; T.kR = 0.7; T.twist = -0.25 * Math.sin(g * Math.PI); ball = 'R';
          } else if (st === '360') {
            spin = Math.PI * 2 * g;
            T.sLx = T.sRx = lerp(-1.4, -3.1, g); T.eL = T.eR = -1.3; T.sLz = 0.2; T.sRz = -0.2;
            T.hLx = T.hRx = -0.8; T.kL = T.kR = 1.6; ball = 'over';
          } else if (st === 'btl') {
            // Ball under the leg on the way up, then hammered home
            const under = g < 0.55;
            T.hLx = under ? -1.5 : -0.6; T.kL = under ? 1.5 : 1.0; T.hRx = under ? 0.5 : -0.3; T.kR = 1.2;
            if (under) { T.sRx = 0.25; T.eR = -0.25; T.sRz = -0.1; T.sLx = -0.8; T.sLz = 0.9; T.lean = 0.25; ball = 'R'; }
            else { T.sLx = T.sRx = -3.1; T.eL = T.eR = -1.2; T.sLz = 0.2; T.sRz = -0.2; T.lean = -0.1; ball = 'over'; }
          } else if (st === 'contact') {
            const cv = p.contactVar || 0;
            if (cv === 1) {
              // Shoulder first: lead shoulder dropped into the chest, ball cocked high on the far side
              T.twist = 0.5 * g; T.tilt = -0.18 * g; T.lean = 0.35;
              T.sRx = lerp(-1.8, -3.2, g); T.eR = -0.7; T.sLx = -0.6; T.sLz = 0.3; T.eL = -1.9;
              T.hLx = -1.2; T.kL = 1.6; T.hRx = -0.9; T.kR = 1.4; ball = 'R';
            } else if (cv === 2) {
              // Over the top: two hands cocked way back, legs split around the defender
              T.sLx = T.sRx = lerp(-1.8, -3.6, g); T.eL = T.eR = -1.5; T.sLz = 0.3; T.sRz = -0.3;
              T.hLx = -1.3; T.hRx = -1.1; T.hLz = 0.55; T.hRz = -0.55; T.kL = T.kR = 1.4; T.lean = 0.45; ball = 'over';
            } else {
              // Knee into the defender: ball hand high, off forearm braced
              T.sRx = lerp(-1.6, -3.1, g); T.eR = -0.3; T.sLx = -1.25; T.sLz = 0.6; T.eL = -1.4;
              T.hLx = -1.5; T.kL = 1.8; T.hRx = 0.2; T.kR = 0.5; T.lean = 0.2; ball = 'R';
            }
          } else {
            T.sLx = T.sRx = lerp(-1.5, -3.15, g); T.eL = T.eR = lerp(-1.3, -1.55, g); T.sLz = 0.2; T.sRz = -0.2;
            T.hLx = -0.9; T.kL = 1.5; T.hRx = -0.5; T.kR = 1.3; ball = 'over';
            if (st === 'reverse') spin = Math.PI * g;
          }
        } else {
          // Slam through the rim
          T.sLx = T.sRx = -2.45; T.eL = T.eR = -0.1; T.sLz = 0.25; T.sRz = -0.25; T.lean = 0.35;
          T.hLx = -0.6; T.kL = 1.2; T.hRx = -0.3; T.kR = 1.0; T.wL = T.wR = 1.0;
          if (st === 'windmill') { T.sRx = Math.PI + 0.75; T.sLx = -1.2; }
          if (st === 'one' || st === 'tomahawk' || st === 'contact') { T.sLx = -1.2; T.sLz = 0.7; }
          if (st === 'reverse') spin = Math.PI;
        }
        break;
      }
      case 'hang': {
        const sw = Math.sin(time * 7);
        T.sLx = T.sRx = -3.05; T.eL = T.eR = -0.05; T.sLz = 0.25; T.sRz = -0.25;
        if (p.dunkStyle === 'windmill') T.sRx = Math.PI * 2 - 3.05;
        if (['one', 'tomahawk', 'contact'].includes(p.dunkStyle)) { T.sLx = -0.6; T.sLz = 0.6; T.eL = -0.4; }
        const settle = Math.exp(-(p.actionT || 0) * 5);
        T.hLx = -0.35 + sw * 0.4 * (0.4 + settle); T.hRx = -0.2 - sw * 0.4 * (0.4 + settle); T.kL = 0.75; T.kR = 0.55; T.lean = 0.1 - settle * 0.25; T.headX = 0.15;
        T.fL = T.fR = 0.4; T.wL = T.wR = 0.4;
        if (p.dunkStyle === 'reverse') spin = Math.PI;
        break;
      }
      case 'land': {
        const absorb = Math.sin(Math.min(1, k * 1.6) * Math.PI);
        T.crouch = 0.35 + 0.85 * absorb; T.kL = 1.0; T.kR = 1.0; T.lean = 0.2 * absorb;
        if (p.isUser) { T.sLz = 1.4; T.sRz = -1.4; T.eL = -2.2; T.eR = -2.2; T.sLx = -0.2; T.sRx = -0.2; }
        else { T.sLz = 0.5; T.sRz = -0.5; }
        T.headX = -0.2;
        break;
      }
      case 'pass': {
        const f = Math.sin(Math.min(1, k) * Math.PI);
        T.sLx = T.sRx = lerp(-0.9, -1.55, f); T.eL = T.eR = lerp(-1.35, -0.05, f);
        T.lean = 0.25; T.hLx = -0.4 * f; T.kL = 0.6;
        if (k < 0.35) ball = 'both';
        break;
      }
      case 'steal': {
        const f = Math.sin(Math.min(1, k) * Math.PI);
        T.sRx = lerp(-0.6, -1.45, f); T.eR = -0.05; T.sRz = -0.05;
        T.lean = 0.25 + f * 0.45; T.crouch = 0.95; T.hRx = -0.8 * f; T.kR = 1.0; T.kL = 1.0;
        break;
      }
      case 'block': {
        const rise = ease(clamp01(k / 0.35));
        const swat = game.time - (p.swatT || -9) < 0.3 ? Math.sin((game.time - p.swatT) / 0.3 * Math.PI) : 0;
        const snatch = game.time - (p.snatchT || -9) < 0.6;
        if (snatch) {
          // Snatched it: both hands high on the ball, then pull it down
          const pull = clamp01((game.time - p.snatchT) / 0.6);
          T.sLx = T.sRx = lerp(-3.0, -1.6, pull); T.eL = T.eR = lerp(-0.4, -1.3, pull); T.sLz = 0.25; T.sRz = -0.25;
          T.hLx = -0.3; T.kL = 0.6; T.kR = 0.5; T.lean = 0.1 + pull * 0.2;
        } else if (p.blockStyle === 'chase') {
          // Chase-down: flying in from behind, one long arm reaching over the top
          T.lean = 0.55 * rise; T.sRx = lerp(-1.4, -2.65, rise) + swat * 0.9; T.eR = -0.05; T.sRz = -0.15;
          T.sLx = 0.6; T.sLz = 0.5; T.eL = -0.6;
          T.hLx = -1.1 * rise; T.kL = 1.3; T.hRx = 0.7; T.kR = 1.1;
        } else if (p.blockStyle === 'one') {
          // One-hand rejection: reach with one arm, other arm down for balance, knee drive
          const R = p.blockHand !== 'L';
          const reach = lerp(-1.6, -3.05, rise) + swat * 0.9;
          if (R) { T.sRx = reach; T.sRz = -0.1; T.eR = -0.05; T.sLx = -0.5; T.sLz = 0.7; T.eL = -0.6; }
          else { T.sLx = reach; T.sLz = 0.1; T.eL = -0.05; T.sRx = -0.5; T.sRz = -0.7; T.eR = -0.6; }
          T.twist = (R ? -1 : 1) * 0.3 * rise; T.tilt = (R ? 1 : -1) * 0.12 * rise;
          T.hLx = R ? -0.9 * rise : 0.1; T.kL = R ? 1.2 : 0.3; T.hRx = R ? 0.1 : -0.9 * rise; T.kR = R ? 0.3 : 1.2;
        } else {
          // Two-hand wall: both arms straight up, wrists forward
          T.sLx = T.sRx = lerp(-1.8, -2.9, rise) + swat * 0.7; T.eL = T.eR = -0.15; T.sLz = 0.12; T.sRz = -0.12;
          T.hLx = -0.35; T.hRx = -0.2; T.kL = 0.9 * rise; T.kR = 0.7 * rise; T.lean = 0.05;
        }
        if (p.hasBall) ball = 'over';
        break;
      }
      case 'rebound': {
        T.sLx = T.sRx = -3.0; T.eL = T.eR = -0.05; T.sLz = 0.18; T.sRz = -0.18;
        T.hLx = -0.25; T.hRx = 0.15; T.kL = 0.55; T.kR = 0.35;
        if (p.hasBall) ball = 'over';
        break;
      }
      case 'cross': case 'behind': case 'btl': case 'hesi': case 'stepback': case 'spin': case 'postspin': {
        const f = Math.sin(k * Math.PI);
        T.crouch = 0.85; T.kL = T.kR = 1.0; T.lean = 0.4;
        const from = MOVE_SWITCH[act] ? !domR : domR; // hand the ball started in
        if (act === 'cross') {
          T.hLz = 0.45; T.hRz = -0.45; T.twist = (p.moveDir || 1) * 0.45 * f;
          setArm(from, lerp(-0.6, -0.2, k), lerp(0.4, -0.2, k), -0.5);
          setArm(!from, lerp(-0.2, -0.6, k), lerp(-0.1, 0.45, k), -0.5);
          ball = 'vmove';
        } else if (act === 'btl') {
          T.hLx = -0.85; T.hRx = 0.55; T.kL = 1.1; T.kR = 0.6; T.crouch = 0.95;
          setArm(from, lerp(-0.5, 0.0, k), 0.2, -0.4);
          setArm(!from, lerp(0.0, -0.5, k), 0.2, -0.4);
          ball = 'vmove';
        } else if (act === 'behind') {
          setArm(from, lerp(-0.3, 0.9, f), lerp(0.3, -0.35, k), -0.7);
          setArm(!from, lerp(0.5, -0.5, k), 0.4, -0.7);
          T.twist = (from ? 1 : -1) * 0.35 * f;
          ball = 'vmove';
        } else if (act === 'hesi') {
          T.lean = lerp(0.4, -0.05, f); T.crouch = lerp(0.85, 0.3, f); T.headX = -0.2 * f;
          setArm(domR, -0.6, 0.35, -0.8);
          ball = 'dribble';
        } else if (act === 'stepback') {
          T.lean = 0.05; T.hLx = 0.45 * f; T.hRx = -0.25 * f; T.kL = 0.6;
          ball = 'dribble';
        } else {
          spin = k * Math.PI * 2 * (p.moveDir || 1);
          setArm(domR, -0.8, 0.9, -0.3);
          T.lean = 0.45;
          ball = 'hand';
        }
        break;
      }
      case 'dropstep': {
        const f = Math.sin(k * Math.PI);
        T.crouch = 0.95; T.lean = 0.4; T.hLx = -1.0 * f; T.kL = 1.0; T.hRx = 0.3; T.kR = 1.1;
        T.hLz = 0.4; T.twist = (p.moveDir || 1) * 0.8 * f;
        T.sLx = T.sRx = -0.6; T.eL = T.eR = -1.4; T.sLz = 0.4; T.sRz = -0.4;
        spin = (p.moveDir || 1) * Math.PI * ease(k);
        ball = 'both';
        break;
      }
      case 'shimmy': {
        const w = Math.sin(k * Math.PI * 3);
        T.crouch = 0.8; T.lean = 0.3; T.twist = w * 0.55; T.headX = -0.15;
        T.sLx = T.sRx = -0.8; T.eL = T.eR = -1.3; T.sLz = 0.35; T.sRz = -0.35;
        T.hLz = 0.35; T.hRz = -0.35;
        ball = 'both';
        break;
      }
      case 'screen': {
        // Set screen: wide base, arms crossed in front
        T.crouch = 0.55; T.lean = 0.12; T.hLz = 0.38; T.hRz = -0.38; T.kL = 0.6; T.kR = 0.6;
        T.sLx = -0.55; T.sLz = -0.55; T.eL = -1.7; T.sRx = -0.6; T.sRz = 0.55; T.eR = -1.7;
        break;
      }
      case 'stumble': {
        const f = Math.sin(k * Math.PI);
        T.lean = -0.55 * f; T.sLz = 1.3 * f; T.sRz = -1.5 * f; T.sLx = -1.1 * f; T.eL = -1.0; T.eR = -1.0;
        T.hLx = 0.55 * f; T.kL = 0.8; T.kR = 0.5; T.twist = 0.65 * f;
        break;
      }
      case 'bump': {
        const f = Math.sin(k * Math.PI);
        T.lean = -0.3 * f; T.twist = 0.45 * f; T.crouch = 0.65;
        T.sLz = 0.8 * f + 0.2; T.sRz = -0.8 * f - 0.2; T.sLx = -0.6; T.sRx = -0.4; T.eL = T.eR = -0.8;
        T.hLx = 0.3 * f; T.kL = 0.7; T.kR = 0.7;
        if (p.hasBall) ball = p.holding ? 'both' : 'dribble';
        break;
      }
      case 'posterfall': {
        const fv = p.fallVar || 0;
        if (fv === 1) {
          // Spun around and dropped on his side
          const down = k < 0.7 ? ease(Math.min(1, k / 0.2)) : Math.max(0, 1 - (k - 0.7) / 0.3);
          spin = (p.idx % 2 ? 1 : -1) * 1.4 * ease(Math.min(1, k / 0.25));
          T.side = (p.idx % 2 ? 1 : -1) * 1.35 * down; T.roll = -0.35 * down;
          T.crouch = 0.9 * down; T.kL = 1.4 * down + 0.2; T.kR = 0.6 * down + 0.2; T.hLx = -0.8 * down;
          T.sLz = 1.2; T.sRz = -0.4; T.sLx = -0.5 * down; T.sRx = -1.2 * down; T.eL = -0.6; T.eR = -1.0;
          break;
        }
        if (fv === 2) {
          // Stagger back three steps, then flat on his back
          const stag = clamp01(k / 0.3), down = k < 0.3 ? 0 : k < 0.72 ? ease(Math.min(1, (k - 0.3) / 0.12)) : Math.max(0, 1 - (k - 0.72) / 0.28);
          const step = Math.sin(stag * Math.PI * 3) * (1 - down);
          T.hLx = 0.5 * step - 0.6 * down; T.hRx = -0.5 * step - 0.3 * down; T.kL = 0.5 + 0.9 * down; T.kR = 0.5 + 0.6 * down;
          T.lean = -0.35 * (1 - down); T.roll = -1.55 * down; T.crouch = 0.4 + 0.8 * down;
          T.sLz = 1.0 + 0.4 * down; T.sRz = -1.0 - 0.4 * down; T.sLx = -0.8; T.sRx = -0.8; T.eL = T.eR = -0.5; T.headX = 0.3 * down;
          break;
        }
      }
      // falls through
      case 'fall': {
        const big = act === 'posterfall';
        const downEnd = big ? 0.12 : 0.25;
        const upStart = big ? 0.72 : 0.6;
        const down = k < upStart ? Math.min(1, k / downEnd) : Math.max(0, 1 - (k - upStart) / (1 - upStart));
        T.roll = -(big ? 1.45 : 1.25) * down;
        T.crouch = 1.2 * down; T.kL = T.kR = 1.3 * down + 0.2;
        T.hLx = big ? -0.9 * down : 0; T.hRx = big ? -0.5 * down : 0;
        T.sLz = 0.7 + (big ? 0.6 : 0); T.sRz = -0.7 - (big ? 0.6 : 0); T.sLx = -0.6 * down; T.sRx = 0.4 * down;
        break;
      }
      case 'celebrate': {
        const f = Math.sin(k * Math.PI * 4);
        T.sRx = -2.85; T.eR = -1.4 + f * 0.6; T.sLx = -0.3; T.sLz = 0.4; T.lean = -0.08;
        break;
      }
      case 'shotfollow': {
        T.sRx = -2.65; T.eR = -0.15; T.sLx = -2.2; T.eL = -0.6;
        break;
      }
    }
    // Palms: facing the ball when it's in the hands or going up for it, relaxed toward the body otherwise
    const handsOn = (ball && ball !== 'dribble' && ball !== 'vmove') || ['shoot', 'layup', 'dunk', 'hang', 'block', 'rebound', 'pass', 'steal', 'celebrate', 'shotfollow'].includes(act);
    if (handsOn) { T.twL = 0; T.twR = 0; }
    // One-hand dunks: once the arm is up, the hand turns over to palm the ball from behind and on
    // top (palm toward the rim), then the wrist snaps it down through the rim.
    const sh1 = game && game.ball && game.ball.state === 'shot' && game.ball.shot;
    if ((act === 'dunk' && ball === 'R') || (act === 'hang' && sh1 && sh1.kind === 'dunk' && sh1.shooter === p && !TWO_HAND[p.dunkStyle || 'two'])) {
      T.twR = Math.PI * ease(clamp01((Math.abs(T.sRx) - 1.5) / 0.9));
    }
    // Mid-air contact jolt (fouls)
    if (p.hitT > 0) {
      const hj = p.hitT / 0.45;
      T.lean -= 0.45 * hj; T.twist += 0.6 * hj; T.sLz += 1.2 * hj; T.sRz -= 0.6 * hj; T.hLz += 0.4 * hj;
    }

    // Blend; snappier while performing actions
    const kBlend = act ? (act === 'fall' || act === 'posterfall' ? 14 : act === 'shoot' || act === 'layup' ? 34 : 24) : 13;
    // Critically damped spring per joint: eases into and out of every pose change (no velocity pops)
    const w = kBlend * 1.35, e = Math.exp(-w * dt);
    for (const key in T) {
      const x0 = this.pose[key] - T[key], v0 = this.pvel[key] || 0, tmp = (v0 + w * x0) * dt;
      this.pose[key] = T[key] + (x0 + tmp) * e;
      this.pvel[key] = (v0 - w * tmp) * e;
    }
    this.extraSpin = act && spin !== 0 ? spin : damp(this.extraSpin, 0, 20, dt);
    const P = this.pose;

    this.root.position.set(p.pos.x, 0, p.pos.z);
    this.root.rotation.y = p.facing + this.extraSpin;
    // Crouch bends hips and knees; the body drops just enough to keep the lower foot on the floor
    const cb = P.crouch * 0.55;
    const hL = P.hLx - cb, hR = P.hRx - cb;
    const kL = Math.max(P.kL, cb * 1.6), kR = Math.max(P.kR, cb * 1.6);
    const depth = (h, kk, z) => (this.thigh * Math.cos(h) + this.shin * Math.cos(h + kk)) * Math.cos(z);
    const air = clamp01(yJump / 0.8);
    const plant = (this.thigh + this.shin - Math.max(depth(hL, kL, P.hLz), depth(hR, kR, P.hRz))) * lerp(1, 0.45, runAmt) * (1 - air);
    this.body.position.y = yJump + P.bob - plant + this.yOff;
    this.body.rotation.set(P.roll, 0, P.side);
    this.pelvis.position.y = this.legLen;
    this.torso.rotation.set(P.lean, P.twist, P.tilt);
    this.neck.rotation.set(P.headX - P.lean * 0.5, P.headY, 0);
    this.armL.sh.rotation.set(P.sLx, 0, P.sLz);
    this.armR.sh.rotation.set(P.sRx, 0, P.sRz);
    this.armL.el.rotation.x = P.eL;
    this.armR.el.rotation.x = P.eR;
    this.armL.wr.rotation.x = P.wL;
    this.armR.wr.rotation.x = P.wR;
    if (this.packed) { this.armL.wr.rotation.y = -P.twL; this.armR.wr.rotation.y = P.twR; }
    this.legL.hp.rotation.set(hL, 0, P.hLz);
    this.legL.kn.rotation.x = kL;
    this.legR.hp.rotation.set(hR, 0, P.hRz);
    this.legR.kn.rotation.x = kR;
    // Soles flat on the floor while grounded, toes pointed in the air
    this.legL.an.rotation.x = lerp(-(hL + kL), 0.5, air) + P.fL;
    this.legR.an.rotation.x = lerp(-(hR + kR), 0.5, air) + P.fR;
    this.root.updateMatrixWorld(true);
    this.rimReach(p, act, k, dt);
    this.blockReach(p, game, act);
    const sh = game && game.ball && game.ball.state === 'shot' && game.ball.shot;
    if (ball === 'over' || ball === 'both' || (act === 'hang' && sh && sh.kind === 'dunk' && sh.shooter === p && TWO_HAND[p.dunkStyle || 'two'])) this.squeezeBall();

    this.blob.scale.setScalar(Math.max(0.5, 1 - yJump * 0.08));
    this.blob.material.opacity = 0.28 * Math.max(0.35, 1 - yJump * 0.12);
    if (this.ring) {
      this.ring.material.opacity = 0.6 + Math.sin(time * 5) * 0.25;
      this.arrow.position.y = this.H + 1.4 + Math.sin(time * 4) * 0.2 + yJump + this.yOff;
    }
    this.armR.hand.getWorldPosition(this.handWorld);
    this.armL.hand.getWorldPosition(this.handWorldL);
    this.armR.palmBall.getWorldPosition(this.ballWorld);
    this.armL.palmBall.getWorldPosition(this.ballWorldL);
    // Two-hand hold: the ball sits between the grips, pushed out along the palms just far enough
    // that its surface touches both hands.
    const gR = this.armR.grip.getWorldPosition(_v1), gL = this.armL.grip.getWorldPosition(_v2);
    const half = gR.distanceTo(gL) / 2;
    _v3.subVectors(this.ballWorld, gR).add(_v4.subVectors(this.ballWorldL, gL));
    if (_v3.lengthSq() < 1e-6) _v3.set(0, 1, 0);
    _v3.normalize().multiplyScalar(Math.sqrt(Math.max(0, 0.44 * 0.44 - half * half)));
    this.ballWorld2.addVectors(gR, gL).multiplyScalar(0.5).add(_v3);
    return ball;
  }

  // Dunks: reach up over the rim on the way up, then grab it and hang. The arms are aimed at the
  // rim and the body is nudged so the hands really meet it (the sim's jump is sized from reachOf(),
  // so the nudge stays small).
  rimReach(p, act, k, dt) {
    let w = 0, hangY = 0, lift = 0;
    const st = p.dunkStyle || 'two';
    const two = !!TWO_HAND[st];
    if (act === 'dunk') {
      const rel = p.releaseAt ? p.releaseAt / p.actionDur : 0.58;
      const jf = p.jumpAtF ? p.jumpAtF / p.actionDur : 0.25;
      const from = lerp(jf, rel, st === 'windmill' || st === 'btl' || st === '360' ? 0.72 : 0.4);
      if (k < rel) { w = ease(clamp01((k - from) / Math.max(0.01, rel - from))); hangY = 0.75; lift = 0.35; }
      else { w = 1 - clamp01((k - rel) / 0.3); hangY = 0.12; }
    } else if (act === 'hang') { w = 1; hangY = 0.06; }
    // First instant of the hang: the hand(s) finish pushing the ball down through the middle of the rim
    const slam = act === 'hang' ? 1 - clamp01(((p.actionT || 0) - 0.08) / 0.1) : 0;
    const prevOff = this.yOff;
    if (w <= 0.001) {
      this.yOff = damp(this.yOff, 0, 14, dt);
      this.body.position.y += this.yOff - prevOff;
      if (this.yOff !== prevOff) this.root.updateMatrixWorld(true);
      return;
    }
    const side = p.team === 0 ? 1 : -1;
    const cx = side * HOOP_X;
    let dx = p.pos.x - cx, dz = p.pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // Points on the near side of the rim (or above its centre on the way up)
    const R = act === 'hang' || lift === 0 ? lerp(0.72, 0.15, slam) : lift;
    if (slam > 0) hangY = lerp(hangY, 0.45, slam);
    const spread = two ? 0.42 : 0;
    const tgt = (a) => new THREE.Vector3(cx + R * (dx * Math.cos(a) - dz * Math.sin(a)), RIM_Y + hangY, R * (dz * Math.cos(a) + dx * Math.sin(a)));
    const arms = two ? [[this.armR, tgt(-spread)], [this.armL, tgt(spread)]] : [[this.armR, tgt(0)]];
    // Give each hand the rim point on its own side
    if (two) {
      const sR = this.armR.sh.getWorldPosition(this._s).clone(), sL = this.armL.sh.getWorldPosition(this._s).clone();
      const a0 = arms[0][1], a1 = arms[1][1];
      if (sR.distanceToSquared(a0) + sL.distanceToSquared(a1) > sR.distanceToSquared(a1) + sL.distanceToSquared(a0)) { arms[0][1] = a1; arms[1][1] = a0; }
    }
    // Nudge the body so straight arms reach the targets
    const L = this.ua + this.fa + this.grip;
    let off = 0;
    for (const [arm, T] of arms) {
      const S = arm.sh.getWorldPosition(this._s);
      const hz = Math.hypot(T.x - S.x, T.z - S.z);
      const need = Math.sqrt(Math.max(0, L * L - hz * hz)) * 0.985;
      off += T.y - S.y - need;
    }
    off /= arms.length;
    // Hanging: hands on the rim both ways. Rising: only ever lift (a high jump bends the elbows instead).
    const lo = act === 'hang' ? -0.3 : 0;
    const goal = Math.max(lo, Math.min(act === 'hang' ? 2.2 : 1.1, this.yOff + off)) * w;
    this.yOff = damp(this.yOff, goal, act === 'hang' ? 30 : 20, dt);
    this.body.position.y += this.yOff - prevOff;
    this.root.updateMatrixWorld(true);
    for (const [arm, T] of arms) this.aimArm(arm, T, w);
  }

  // Shot blocks: the blocking hand goes to the ball and meets it at the swat
  blockReach(p, game, act) {
    if (act !== 'block' || !game.ball || p.hasBall) return;
    const b = game.ball;
    const bp = b.vis || b.pos;
    if (!bp) return;
    const since = game.time - (p.swatT || -9);
    const arm = p.blockStyle === 'one' && p.blockHand === 'L' ? this.armL : this.armR;
    const S = arm.sh.getWorldPosition(this._s);
    const L = this.ua + this.fa + this.grip;
    const T = new THREE.Vector3(bp.x, bp.y, bp.z);
    const d = S.distanceTo(T);
    let w;
    if (since >= 0 && since < 0.22) w = 1; // contact
    else if (since >= 0.22 && since < 0.45) w = 1 - (since - 0.22) / 0.23; // follow through
    else w = clamp01((L + 1.6 - d) / 1.6) * 0.85; // reaching for it
    if (w <= 0.01) return;
    // Out of reach: point at it with a straight arm (the target is pulled in to arm's length)
    if (d > L) T.sub(S).multiplyScalar(L / d).add(S);
    this.aimArm(arm, T, w);
    if (p.blockStyle !== 'one' && p.blockStyle !== 'chase') {
      const other = arm === this.armR ? this.armL : this.armR;
      const S2 = other.sh.getWorldPosition(this._s).clone();
      const T2 = new THREE.Vector3(bp.x, bp.y, bp.z);
      const d2 = S2.distanceTo(T2);
      if (d2 > L) T2.sub(S2).multiplyScalar(L / d2).add(S2);
      this.aimArm(other, T2, w * 0.9);
    }
  }

  // Point an arm at a world-space target: straight when it can't quite reach, elbow bent when close.
  // Two-hand holds: swing each arm in at the shoulder so both hands sit on the ball's sides
  // (the poses are authored for a narrow rig, so on wide shoulders the hands drift apart).
  squeezeBall() {
    const gR = this.armR.grip.getWorldPosition(_v1), gL = this.armL.grip.getWorldPosition(_v2);
    const sep = gR.distanceTo(gL), want = 0.7;
    if (sep <= want) return;
    const mid = _v3.addVectors(gR, gL).multiplyScalar(0.5), dir = _v4.subVectors(gR, gL).normalize();
    for (const [arm, sgn] of [[this.armR, 1], [this.armL, -1]]) {
      const S = arm.sh.getWorldPosition(this._s), G = arm.grip.getWorldPosition(this._t);
      const T = this._v.copy(mid).addScaledVector(dir, sgn * want / 2);
      _q1.setFromUnitVectors(G.sub(S).normalize(), T.sub(S).normalize());
      arm.sh.getWorldQuaternion(_q2).premultiply(_q1);
      arm.sh.parent.getWorldQuaternion(_q3).invert();
      arm.sh.quaternion.copy(_q3.multiply(_q2));
      arm.sh.updateMatrixWorld(true);
    }
  }

  aimArm(arm, T, w) {
    const px = arm.sh.rotation.x, pz = arm.sh.rotation.z, pe = arm.el.rotation.x, pw = arm.wr.rotation.x;
    const a = this.ua, b = this.fa + this.grip;
    const S = arm.sh.getWorldPosition(this._s);
    const dist = S.distanceTo(T);
    const c = (dist * dist - a * a - b * b) / (2 * a * b);
    const bend = dist >= a + b ? 0 : Math.acos(Math.max(-1, Math.min(1, c)));
    const aim = this._t.copy(T);
    let xA = px, zA = pz;
    for (let it = 0; it < 3; it++) {
      const d = this.torso.worldToLocal(this._v.copy(aim)).sub(arm.sh.position).normalize();
      xA = Math.atan2(-d.z, -d.y); zA = Math.asin(Math.max(-1, Math.min(1, d.x)));
      arm.sh.rotation.set(xA, 0, zA); arm.el.rotation.x = -bend;
      arm.sh.updateMatrixWorld(true);
      const G = arm.grip.getWorldPosition(this._v);
      aim.add(this._s.copy(T).sub(G));
    }
    arm.sh.rotation.set(wrapLerp(px, xA, w), 0, lerp(pz, zA, w));
    arm.el.rotation.x = lerp(pe, -bend, w);
    arm.wr.rotation.x = lerp(pw, 0.35, w);
    arm.sh.updateMatrixWorld(true);
  }
}
