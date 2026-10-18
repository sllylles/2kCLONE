// Procedural basketball player: rounded body built from capsules, posed every frame from sim state.
import * as THREE from 'three';

const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const ease = t => t * t * (3 - 2 * t);
const MOVE_SWITCH = { cross: 1, behind: 1, btl: 1 };

const matCache = new Map();
export function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}
function shade(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }

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

// Capsule hanging down from its pivot.
function limb(r1, length, material) {
  const g = new THREE.CapsuleGeometry(r1, Math.max(0.05, length - r1 * 2), 4, 10);
  g.translate(0, -length / 2, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

export class PlayerModel {
  constructor(p, team, isUser) {
    const H = p.heightFt;
    this.H = H;
    this.legLen = 0.47 * H;
    this.thigh = this.legLen * 0.5;
    this.shin = this.legLen * 0.5;
    this.torsoLen = 0.29 * H;
    this.ua = 0.165 * H;
    this.fa = 0.15 * H;
    const skin = mat(p.skin);
    const jersey = mat(team.c1);
    const trim = mat(team.c2);
    const shoeMat = mat(p.shoe || '#f2f2f2');
    const tl = this.torsoLen;

    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = this.legLen;
    this.body.add(this.pelvis);

    // Baggy shorts (waist) + trim
    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.7, 0.75, 16), jersey);
    waist.scale.z = 0.66; waist.position.y = -0.12; waist.castShadow = true;
    this.pelvis.add(waist);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.645, 0.645, 0.12, 16), trim);
    band.scale.z = 0.66; band.position.y = 0.22;
    this.pelvis.add(band);

    // Torso
    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);
    const chestG = new THREE.CapsuleGeometry(0.6, Math.max(0.2, tl - 1.2), 6, 16);
    const chest = new THREE.Mesh(chestG, jersey);
    chest.scale.set(1.08, 1, 0.64); chest.position.y = tl / 2; chest.castShadow = true;
    this.torso.add(chest);
    const shoulderW = 0.76;
    // Traps / neckline skin + deltoids (tank top)
    const traps = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), skin);
    traps.rotation.z = Math.PI / 2; traps.position.y = tl - 0.05; traps.scale.set(1, 1, 0.9);
    this.torso.add(traps);
    for (const sx of [-1, 1]) {
      const delt = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), skin);
      delt.position.set(sx * (shoulderW - 0.02), tl - 0.2, 0); delt.castShadow = true;
      this.torso.add(delt);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.74), trim);
      strap.position.set(sx * 0.42, tl + 0.02, 0); this.torso.add(strap);
    }
    // Numbers
    const ntex = numberTexture(p.num, team.c2, shade(team.c1, 0.5));
    const nm = new THREE.MeshBasicMaterial({ map: ntex, transparent: true });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), nm);
    back.position.set(0, tl * 0.52, -0.41); back.rotation.y = Math.PI; this.torso.add(back);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), nm);
    front.position.set(0, tl * 0.6, 0.41); this.torso.add(front);

    // Head
    this.neck = new THREE.Group();
    this.neck.position.y = tl;
    this.torso.add(this.neck);
    const neckM = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.25, 4, 8), skin);
    neckM.position.y = 0.2; this.neck.add(neckM);
    this.head = new THREE.Group();
    this.head.position.y = 0.66;
    this.neck.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14), skin);
    skull.scale.set(0.88, 1.08, 0.96); skull.castShadow = true;
    this.head.add(skull);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), skin);
    jaw.position.set(0, -0.2, 0.08); jaw.scale.set(1, 0.8, 1); this.head.add(jaw);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), skin);
      ear.position.set(sx * 0.36, -0.02, 0); ear.scale.set(0.6, 1, 1); this.head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), mat('#141414'));
      eye.position.set(sx * 0.13, 0.04, 0.36); this.head.add(eye);
    }
    this.addHair(p.hair, this.head);
    if (p.headband) {
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 16, 1, true), mat(team.c2 === '#f4f4f4' ? '#ffffff' : team.c2));
      hb.position.y = 0.16; hb.scale.set(0.9, 1, 0.98); this.head.add(hb);
    }

    // Arms
    const mkArm = (sx) => {
      const sh = new THREE.Group();
      sh.position.set(sx * shoulderW, tl - 0.22, 0);
      this.torso.add(sh);
      sh.add(limb(0.17, this.ua, skin));
      const el = new THREE.Group(); el.position.y = -this.ua + 0.08; sh.add(el);
      el.add(limb(0.135, this.fa, skin));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
      hand.scale.set(0.8, 1.25, 0.6);
      hand.position.y = -this.fa - 0.05; el.add(hand);
      return { sh, el, hand };
    };
    this.armL = mkArm(1); this.armR = mkArm(-1);
    if (p.sleeve) {
      const sl = limb(0.15, this.fa * 0.85, mat('#111111'));
      this.armR.el.add(sl);
    }

    // Legs
    const mkLeg = (sx) => {
      const hp = new THREE.Group(); hp.position.set(sx * 0.34, -0.05, 0); this.pelvis.add(hp);
      hp.add(limb(0.24, this.thigh, skin));
      // Shorts leg
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.36, this.thigh * 0.62, 12), jersey);
      sleeve.position.y = -this.thigh * 0.28; sleeve.castShadow = true; hp.add(sleeve);
      const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.08, 12), trim);
      hem.position.y = -this.thigh * 0.58; hp.add(hem);
      const kn = new THREE.Group(); kn.position.y = -this.thigh + 0.1; hp.add(kn);
      kn.add(limb(0.18, this.shin - 0.25, skin));
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.45, 10), mat('#ffffff'));
      sock.position.y = -this.shin + 0.42; kn.add(sock);
      const shoeG = new THREE.CapsuleGeometry(0.2, 0.55, 4, 10);
      shoeG.rotateX(Math.PI / 2);
      const shoe = new THREE.Mesh(shoeG, shoeMat);
      shoe.scale.set(1.05, 0.75, 1); shoe.position.set(0, -this.shin + 0.08, 0.17); shoe.castShadow = true;
      kn.add(shoe);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.07, 0.92), mat('#e8e8e8'));
      sole.position.set(0, -this.shin - 0.06, 0.17); kn.add(sole);
      return { hp, kn };
    };
    this.legL = mkLeg(1); this.legR = mkLeg(-1);

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

    const bw = p.build === 'slim' ? 0.92 : p.build === 'strong' ? 1.1 : 1;
    this.body.scale.set(bw, 1, bw);
    this.pose = this.defaultPose();
    this.runPhase = Math.random() * 6;
    this.handWorld = new THREE.Vector3();
    this.handWorldL = new THREE.Vector3();
    this.extraSpin = 0;
  }

  addHair(style, head) {
    const hairMat = mat('#16110d');
    if (style === 'Bald') return;
    if (style === 'Afro') {
      const a = new THREE.Mesh(new THREE.SphereGeometry(0.58, 14, 10), hairMat);
      a.position.y = 0.16; head.add(a);
      return;
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, style === 'Buzz' ? 1.25 : 1.5), hairMat);
    cap.position.y = 0.05; cap.scale.set(0.92, style === 'Fade' ? 1.15 : 1.05, 1.0); head.add(cap);
    if (style === 'Locs') {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        if (Math.cos(a) > 0.55) continue;
        const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.6, 3, 5), hairMat);
        l.position.set(Math.sin(a) * 0.37, -0.22, Math.cos(a) * 0.37);
        head.add(l);
      }
    }
  }

  defaultPose() {
    return { crouch: 0.2, lean: 0.1, tilt: 0, twist: 0, headX: 0,
      sLx: 0.1, sLz: 0.12, eL: -0.3, sRx: 0.1, sRz: -0.12, eR: -0.3,
      hLx: 0, hLz: 0.04, kL: 0.2, hRx: 0, hRz: -0.04, kR: 0.2, bob: 0, roll: 0 };
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
      const A = 0.25 + runAmt * 0.8;
      T.hLx = -Math.sin(ph) * A; T.hRx = Math.sin(ph) * A;
      T.kL = 0.25 + Math.max(0, Math.sin(ph + 1.4)) * A * 1.5;
      T.kR = 0.25 + Math.max(0, -Math.sin(ph + 1.4)) * A * 1.5;
      T.sLx = Math.sin(ph) * A * 0.9; T.sRx = -Math.sin(ph) * A * 0.9;
      T.eL = -0.9 - runAmt * 0.5; T.eR = -0.9 - runAmt * 0.5;
      T.lean = 0.12 + runAmt * 0.25;
      T.bob = Math.abs(Math.sin(ph)) * 0.24 * A;
      T.crouch = 0.25;
      T.twist = -Math.sin(ph) * 0.12 * A;
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
        const g = Math.min(1, k / 0.22);
        const rel = p.released;
        T.crouch = lerp(0.85, 0.1, clamp01((k - 0.12) / 0.25));
        T.kL = T.kR = lerp(1.05, 0.1, clamp01((k - 0.12) / 0.25));
        T.hLx = T.hRx = 0; T.hLz = 0.06; T.hRz = -0.06;
        if (p.shotStyle === 'hook') {
          T.sRz = lerp(-0.4, -2.95, ease(g)); T.sRx = -0.3; T.eR = -0.2;
          T.sLx = -0.7; T.sLz = 1.0; T.eL = -0.9;
          T.tilt = -0.25; T.hLx = -1.2; T.kL = 1.4; T.lean = 0;
          if (!rel) ball = 'R';
        } else {
          T.sLx = T.sRx = lerp(-1.0, -2.75, ease(g));
          T.eL = T.eR = rel ? -0.05 : lerp(-1.3, -1.65, g);
          T.sLz = 0.22; T.sRz = -0.12;
          T.lean = -0.06;
          if (p.shotStyle === 'fade') {
            // Kobe/MJ fadeaway: lean back, lead knee up, release high
            const up = clamp01((k - 0.18) / 0.25);
            T.lean = -0.5 * up; T.hLx = -1.15 * up; T.kL = 0.3 + 1.1 * up; T.hRx = 0.25 * up; T.kR = 0.15;
            T.sLx = T.sRx = lerp(-1.0, -2.95, ease(g)); T.headX = -0.15 * up;
            if (p.turnaround) spin = (p.turnSide || 1) * Math.PI * (1 - ease(clamp01(k / 0.28)));
          }
          if (rel) { T.sLx = -2.4; T.sLz = 0.4; }
          if (!rel) ball = 'over';
        }
        if (p.ft) { T.hLx = T.hRx = 0; }
        break;
      }
      case 'layup': {
        T.hLx = -1.45; T.kL = 1.7; T.hRx = 0.25; T.kR = 0.3;
        T.sRx = lerp(-1.2, -3.05, Math.min(1, k * 1.7)); T.eR = -0.12;
        T.sLx = -0.9; T.sLz = 0.5; T.eL = -0.9; T.lean = 0.05; T.headX = -0.3;
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
          T.crouch = lerp(0.4, 1.0, g); T.lean = 0.35; T.hLx = -0.8; T.hRx = 0.55; T.kL = 1.1; T.kR = 0.9;
          T.sLx = T.sRx = -1.0; T.eL = T.eR = -1.35; T.sLz = 0.25; T.sRz = -0.25;
          ball = 'both';
        } else if (k < rel) {
          const g = ease((k - jf) / (rel - jf));
          T.crouch = 0.1; T.lean = -0.08;
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
            // Into the defender: ball hand high, off forearm braced, knee up
            T.sRx = lerp(-1.6, -3.1, g); T.eR = -0.3; T.sLx = -1.25; T.sLz = 0.6; T.eL = -1.4;
            T.hLx = -1.5; T.kL = 1.8; T.hRx = 0.2; T.kR = 0.5; T.lean = 0.2; ball = 'R';
          } else {
            T.sLx = T.sRx = lerp(-1.5, -3.15, g); T.eL = T.eR = lerp(-1.3, -1.55, g); T.sLz = 0.2; T.sRz = -0.2;
            T.hLx = -0.9; T.kL = 1.5; T.hRx = -0.5; T.kR = 1.3; ball = 'over';
            if (st === 'reverse') spin = Math.PI * g;
          }
        } else {
          // Slam through the rim
          T.sLx = T.sRx = -2.45; T.eL = T.eR = -0.1; T.sLz = 0.25; T.sRz = -0.25; T.lean = 0.35;
          T.hLx = -0.6; T.kL = 1.2; T.hRx = -0.3; T.kR = 1.0;
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
        T.hLx = -0.25 + sw * 0.35; T.hRx = -0.25 - sw * 0.35; T.kL = 0.6; T.kR = 0.5; T.lean = 0.12; T.headX = 0.2;
        if (p.dunkStyle === 'reverse') spin = Math.PI;
        break;
      }
      case 'land': {
        T.crouch = 0.9 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5 + 0.6); T.kL = 1.0; T.kR = 1.0;
        if (p.isUser || Math.random() < 0) { T.sLz = 1.4; T.sRz = -1.4; T.eL = -2.2; T.eR = -2.2; T.sLx = -0.2; T.sRx = -0.2; }
        else { T.sLz = 0.5; T.sRz = -0.5; }
        T.lean = -0.1; T.headX = -0.2;
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
      case 'fall':
      case 'posterfall': {
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
    // Mid-air contact jolt (fouls)
    if (p.hitT > 0) {
      const hj = p.hitT / 0.45;
      T.lean -= 0.45 * hj; T.twist += 0.6 * hj; T.sLz += 1.2 * hj; T.sRz -= 0.6 * hj; T.hLz += 0.4 * hj;
    }

    // Blend; snappier while performing actions
    const kBlend = act ? (act === 'fall' || act === 'posterfall' ? 14 : 24) : 13;
    for (const key in T) this.pose[key] = damp(this.pose[key], T[key], kBlend, dt);
    this.extraSpin = act && spin !== 0 ? spin : damp(this.extraSpin, 0, 20, dt);
    const P = this.pose;

    this.root.position.set(p.pos.x, 0, p.pos.z);
    this.root.rotation.y = p.facing + this.extraSpin;
    const drop = P.crouch * 0.38;
    this.body.position.y = yJump + P.bob - drop;
    this.body.rotation.x = P.roll;
    this.pelvis.position.y = this.legLen;
    this.torso.rotation.set(P.lean, P.twist, P.tilt);
    this.neck.rotation.x = P.headX - P.lean * 0.5;
    this.armL.sh.rotation.set(P.sLx, 0, P.sLz);
    this.armR.sh.rotation.set(P.sRx, 0, P.sRz);
    this.armL.el.rotation.x = P.eL;
    this.armR.el.rotation.x = P.eR;
    // Crouch bends hips and knees so the feet stay planted
    const cb = P.crouch * 0.55;
    this.legL.hp.rotation.set(P.hLx - cb, 0, P.hLz);
    this.legL.kn.rotation.x = Math.max(P.kL, cb * 1.6);
    this.legR.hp.rotation.set(P.hRx - cb, 0, P.hRz);
    this.legR.kn.rotation.x = Math.max(P.kR, cb * 1.6);
    const ground = yJump + P.bob - drop;
    this.blob.position.y = 0.03 - ground;
    this.blob.scale.setScalar(Math.max(0.5, 1 - yJump * 0.08));
    if (this.ring) {
      this.ring.position.y = this.blob.position.y + 0.02;
      this.ring.material.opacity = 0.6 + Math.sin(time * 5) * 0.25;
      this.arrow.position.y = this.H + 1.4 + Math.sin(time * 4) * 0.2 - ground;
    }
    this.root.updateMatrixWorld(true);
    this.armR.hand.getWorldPosition(this.handWorld);
    this.armL.hand.getWorldPosition(this.handWorldL);
    return ball;
  }
}
