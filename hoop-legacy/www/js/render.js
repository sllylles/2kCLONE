// Three.js scene: arena, court, hoops, procedurally animated players, ball, camera.
import * as THREE from 'three';
import { HOOP_X, RIM_Y, COURT_HALF_L, COURT_HALF_W } from './game.js';
import { PlayerModel } from './player.js';
export { PlayerModel };

const PX = 20; // canvas pixels per foot
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

// ---------------- Court texture ----------------
function courtTexture(homeTeam) {
  const W = 104, H = 58;
  const cv = document.createElement('canvas');
  cv.width = W * PX; cv.height = H * PX;
  const g = cv.getContext('2d');
  const X = x => (x + W / 2) * PX, Y = z => (z + H / 2) * PX;

  // Apron
  g.fillStyle = shade(homeTeam.c1, 0.55);
  g.fillRect(0, 0, cv.width, cv.height);
  // Wood planks
  const x0 = X(-47), y0 = Y(-25), cw = 94 * PX, ch = 50 * PX;
  g.fillStyle = '#c98f55';
  g.fillRect(x0, y0, cw, ch);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let z = -25; z < 25; z += 0.5) {
    let x = -47;
    while (x < 47) {
      const len = 6 + rnd() * 12;
      const l = 0.9 + rnd() * 0.18;
      g.fillStyle = `rgb(${Math.round(201 * l)},${Math.round(143 * l)},${Math.round(85 * l)})`;
      g.fillRect(X(x), Y(z), Math.min(len, 47 - x) * PX, 0.5 * PX - 1);
      x += len;
    }
  }
  // Varnish sheen
  const grad = g.createLinearGradient(0, y0, 0, y0 + ch);
  grad.addColorStop(0, 'rgba(255,255,255,0.08)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.08)');
  g.fillStyle = grad; g.fillRect(x0, y0, cw, ch);

  // Paint
  for (const s of [-1, 1]) {
    g.fillStyle = homeTeam.c1;
    g.globalAlpha = 0.85;
    const bx = s > 0 ? X(47 - 19) : X(-47);
    g.fillRect(bx, Y(-8), 19 * PX, 16 * PX);
    g.globalAlpha = 1;
  }
  // Center logo
  g.save();
  g.translate(X(0), Y(0));
  g.fillStyle = homeTeam.c1;
  g.beginPath(); g.arc(0, 0, 6 * PX, 0, Math.PI * 2); g.fill();
  g.fillStyle = homeTeam.c2;
  g.font = `900 ${3.2 * PX}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(homeTeam.abbr, 0, 0.2 * PX);
  g.restore();
  // Baseline text
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `800 ${2.6 * PX}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText(homeTeam.city.toUpperCase(), X(0), Y(27.4));
  g.fillText(homeTeam.nick.toUpperCase(), X(0), Y(-26.2));

  // Lines
  g.strokeStyle = '#ffffff';
  g.lineWidth = 0.18 * PX;
  g.strokeRect(x0, y0, cw, ch);
  g.beginPath(); g.moveTo(X(0), Y(-25)); g.lineTo(X(0), Y(25)); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), 6 * PX, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(X(0), Y(0), 2 * PX, 0, Math.PI * 2); g.stroke();
  for (const s of [-1, 1]) {
    const hx = s * HOOP_X;
    const base = s * 47;
    // Lane
    g.strokeRect(s > 0 ? X(47 - 19) : X(-47), Y(-8), 19 * PX, 16 * PX);
    // FT circle
    g.beginPath(); g.arc(X(base - s * 19), Y(0), 6 * PX, 0, Math.PI * 2); g.stroke();
    // Restricted area
    g.beginPath();
    if (s > 0) g.arc(X(hx), Y(0), 4 * PX, Math.PI / 2, Math.PI * 1.5);
    else g.arc(X(hx), Y(0), 4 * PX, -Math.PI / 2, Math.PI / 2);
    g.stroke();
    // 3pt line
    const r = 23.75;
    const cornerLen = 14;
    const ang = Math.asin(22 / r);
    g.beginPath();
    g.moveTo(X(base), Y(-22)); g.lineTo(X(base - s * cornerLen), Y(-22));
    g.moveTo(X(base), Y(22)); g.lineTo(X(base - s * cornerLen), Y(22));
    g.stroke();
    g.beginPath();
    if (s > 0) g.arc(X(hx), Y(0), r * PX, Math.PI - ang, Math.PI + ang);
    else g.arc(X(hx), Y(0), r * PX, -ang, ang);
    // Draw the outward bulging arc (toward half court)
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function crowdTexture() {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#15161c'; g.fillRect(0, 0, 512, 128);
  const cols = ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#8e44ad', '#27ae60', '#d35400', '#7f8c8d', '#2c3e50'];
  for (let y = 4; y < 128; y += 9) {
    for (let x = 2; x < 512; x += 6 + Math.random() * 3) {
      g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.fillRect(x, y + Math.random() * 2, 4, 6);
      g.fillStyle = '#d8a27a';
      g.fillRect(x + 0.5, y - 2, 3, 3);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- Hoop ----------------
function buildHoop(side) {
  const grp = new THREE.Group();
  const s = side;
  const metal = mat('#2b2f36');
  // Stanchion base and pole
  const base = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 5), mat('#1c1f26'));
  base.position.set(s * 52, 1.5, 0); grp.add(base);
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 11, 0.8), metal);
  pole.position.set(s * 51.5, 8, 0); grp.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.6, 0.6), metal);
  arm.position.set(s * 47.5, 12.8, 0); grp.add(arm);
  // Pad
  const pad = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3, 4.6), mat('#1e3a8a'));
  pad.position.set(s * 52, 3.2, 0);
  // Backboard
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.5, 6),
    new THREE.MeshPhongMaterial({ color: '#dfe8f0', transparent: true, opacity: 0.35, shininess: 90 }));
  board.position.set(s * 43, 10.75, 0); grp.add(board);
  const frameMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 6), frameMat);
  frameTop.position.set(s * 42.95, 12.5, 0); grp.add(frameTop);
  const frameBot = frameTop.clone(); frameBot.position.y = 9; grp.add(frameBot);
  const sq = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.1), frameMat);
  for (const z of [-1, 1]) { const m = sq.clone(); m.position.set(s * 42.92, 10.75, z); grp.add(m); }
  const sqTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 2), frameMat);
  sqTop.position.set(s * 42.92, 11.5, 0); grp.add(sqTop);
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 8, 24), mat('#ff5a1f'));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(s * HOOP_X, RIM_Y, 0); grp.add(rim);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.3), mat('#ff5a1f'));
  brace.position.set(s * 42.75, RIM_Y, 0); grp.add(brace);
  // Net
  const pts = [];
  const N = 12, L = 1.5;
  for (let i = 0; i < N; i++) {
    const a1 = (i / N) * Math.PI * 2, a2 = ((i + 1.5) / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a1) * 0.75, 0, Math.sin(a1) * 0.75));
    pts.push(new THREE.Vector3(Math.cos(a2) * 0.45, -L, Math.sin(a2) * 0.45));
    pts.push(new THREE.Vector3(Math.cos(a2) * 0.75, 0, Math.sin(a2) * 0.75));
    pts.push(new THREE.Vector3(Math.cos(a1) * 0.45, -L, Math.sin(a1) * 0.45));
  }
  const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#f4f4f4', transparent: true, opacity: 0.85 }));
  net.position.set(s * HOOP_X, RIM_Y - 0.05, 0);
  grp.add(net);
  return { grp, net, rim };
}

// ---------------- Renderer facade ----------------
export class Renderer {
  constructor(canvas, quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2.5 : quality === 'med' ? 1.75 : 1.25));
    this.r.shadowMap.enabled = quality === 'high';
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#07080c');
    this.scene.fog = new THREE.Fog('#07080c', 120, 220);
    this.camera = new THREE.PerspectiveCamera(36, 2, 1, 400);
    this.camPos = new THREE.Vector3(0, 30, 52);
    this.camLook = new THREE.Vector3(0, 3, 0);
    this.models = [];
    this.shake = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow screens need a wider FOV to fit the court.
    const end = this.camMode !== 'broadcast';
    this.camera.fov = w / h > 1.9 ? (end ? 42 : 34) : w / h > 1.5 ? (end ? 48 : 40) : (end ? 60 : 52);
    this.camera.updateProjectionMatrix();
  }

  buildArena(homeTeam) {
    const s = this.scene;
    while (s.children.length) s.remove(s.children[0]);
    this.models = [];
    s.add(new THREE.HemisphereLight('#fff8ee', '#4a3a2a', 1.55));
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.7);
    fill.position.set(-30, 40, -20); s.add(fill);
    const sun = new THREE.DirectionalLight('#ffffff', 1.9);
    sun.position.set(10, 60, 25);
    sun.castShadow = this.r.shadowMap.enabled;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 32; sc.bottom = -32; sc.near = 10; sc.far = 120;
    s.add(sun);

    const floorTex = courtTexture(homeTeam);
    floorTex.anisotropy = this.r.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(104, 58),
      new THREE.MeshPhongMaterial({ map: floorTex, shininess: 40, specular: '#3a3a3a' }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    s.add(floor);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 300), mat('#121318'));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; s.add(outer);

    // Stands
    const crowd = crowdTexture();
    const standMat = new THREE.MeshLambertMaterial({ map: crowd });
    const mkStand = (w, x, z, ry) => {
      for (let i = 0; i < 7; i++) {
        const t = crowd.clone(); t.needsUpdate = true; t.repeat.set(w / 30, 1); t.offset.x = Math.random();
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 2.2, 3), new THREE.MeshLambertMaterial({ map: t }));
        m.position.set(x, 1.1 + i * 2.6, z);
        m.rotation.y = ry;
        m.translateZ(-i * 3.2);
        s.add(m);
      }
    };
    mkStand(130, 0, -36, 0);
    mkStand(80, -62, 0, Math.PI / 2);
    mkStand(80, 62, 0, -Math.PI / 2);
    void standMat;
    // Courtside table + ad boards
    const board = new THREE.Mesh(new THREE.BoxGeometry(100, 2.2, 0.4), new THREE.MeshBasicMaterial({ color: homeTeam.c1 }));
    board.position.set(0, 1.1, -30.5); s.add(board);
    const table = new THREE.Mesh(new THREE.BoxGeometry(24, 2.6, 2.5), mat('#1a1c22'));
    table.position.set(0, 1.3, 31.5); s.add(table);
    // Arena light rig glow
    for (const x of [-30, 0, 30]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 4), new THREE.MeshBasicMaterial({ color: '#fffbe8' }));
      l.position.set(x, 70, -5); s.add(l);
    }
    this.hoops = [buildHoop(-1), buildHoop(1)];
    for (const h of this.hoops) s.add(h.grp);

    // Ball
    const bc = document.createElement('canvas'); bc.width = 128; bc.height = 64;
    const bg = bc.getContext('2d');
    bg.fillStyle = '#d4651f'; bg.fillRect(0, 0, 128, 64);
    bg.strokeStyle = '#2a1407'; bg.lineWidth = 3;
    for (const x of [0, 32, 64, 96]) { bg.beginPath(); bg.moveTo(x, 0); bg.lineTo(x, 64); bg.stroke(); }
    bg.beginPath(); bg.moveTo(0, 32); bg.lineTo(128, 32); bg.stroke();
    const btex = new THREE.CanvasTexture(bc); btex.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14), new THREE.MeshLambertMaterial({ map: btex }));
    this.ball.castShadow = true;
    s.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12),
      new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    s.add(this.ballShadow);
  }

  addPlayers(game) {
    for (const p of game.players) {
      const t = game.teams[p.team];
      // Home team wears its colors, away team wears white
      const kit = p.team === game.homeIdx ? t : { ...t, c1: '#f4f4f4', c2: t.c1 };
      const m = new PlayerModel(p, kit, p.isUser);
      this.scene.add(m.root);
      this.models.push(m);
    }
    // Ring under the user's matchup (who you guard / who guards you)
    const mr = new THREE.Mesh(new THREE.RingGeometry(1.45, 1.85, 32),
      new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.8, depthWrite: false }));
    mr.rotation.x = -Math.PI / 2;
    const mk = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true }));
    mk.rotation.x = Math.PI;
    this.matchRing = mr; this.matchMark = mk;
    this.scene.add(mr); this.scene.add(mk);
  }

  netSwish(side) {
    const h = this.hoops[side > 0 ? 1 : 0];
    h.swishT = 0.6;
  }

  render(game, dt, time) {
    const ball = game.ball;
    let ballVis = null;
    for (let i = 0; i < this.models.length; i++) {
      const p = game.players[i];
      const m = this.models[i];
      m.root.visible = !p.benched;
      const mode = m.update(p, game, dt, time);
      if (p.hasBall && mode) ballVis = { m, p, mode };
    }
    // Ball visual
    const bp = this.ball.position;
    if (ballVis && ball.state === 'held') {
      const { m, p, mode } = ballVis;
      const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
      const hand = (p.dribbleHand === 'R' ? m.handWorld : m.handWorldL);
      if (mode === 'dribble') {
        // Ball pounds between the dribble hand and the floor, pushed ahead when running
        const spd = Math.hypot(p.vel.x, p.vel.z);
        const push = 0.45 + spd * 0.04;
        const d = p.dribblePhase;
        const top = hand.y - 0.3;
        const f = Math.abs(Math.cos(d * Math.PI));
        const lead = (1 - f) * spd * 0.05;
        bp.set(hand.x + fx * (push + lead), 0.42 + (top - 0.42) * f, hand.z + fz * (push + lead));
      } else if (mode === 'vmove') {
        // Crossover / between the legs / behind the back: V-shaped bounce from one hand to the other
        const k = Math.min(1, p.actionT / p.actionDur);
        const from = p.dribbleHand === 'R' ? m.handWorldL : m.handWorld;
        const off = p.action === 'cross' ? 1.0 : p.action === 'btl' ? 0.1 : -0.85;
        const rx = p.pos.x + fx * off, rz = p.pos.z + fz * off;
        if (k < 0.5) {
          const t = k / 0.5;
          bp.set(lerp(from.x, rx, t), lerp(from.y - 0.3, 0.42, t * t), lerp(from.z, rz, t));
        } else {
          const t = (k - 0.5) / 0.5;
          bp.set(lerp(rx, hand.x + fx * 0.4, t), lerp(0.42, hand.y - 0.3, Math.sqrt(t)), lerp(rz, hand.z + fz * 0.4, t));
        }
      } else if (mode === 'hand') {
        bp.set(hand.x + fx * 0.2, hand.y + 0.05, hand.z + fz * 0.2);
      } else if (mode === 'both') {
        bp.set((m.handWorld.x + m.handWorldL.x) / 2 + fx * 0.25, (m.handWorld.y + m.handWorldL.y) / 2 + 0.1, (m.handWorld.z + m.handWorldL.z) / 2 + fz * 0.25);
      } else if (mode === 'over') {
        // Two hands on the ball overhead
        bp.set((m.ballWorld.x + m.ballWorldL.x) / 2, (m.ballWorld.y + m.ballWorldL.y) / 2 + 0.1, (m.ballWorld.z + m.ballWorldL.z) / 2);
      } else if (mode === 'R') {
        // Ball resting in the right palm
        bp.copy(m.ballWorld);
      }
      // Let the sim know where the ball visually is (used for release point).
      ball.vis = { x: bp.x, y: bp.y, z: bp.z };
    } else {
      bp.set(ball.pos.x, ball.pos.y, ball.pos.z);
      ball.vis = null;
    }
    this.ball.rotation.x += dt * (ball.state === 'held' ? 6 : 10);
    this.ball.rotation.z += dt * 3;
    this.ballShadow.position.set(bp.x, 0.04, bp.z);
    this.ballShadow.scale.setScalar(Math.max(0.4, 1.2 - bp.y * 0.05));

    // Matchup indicator
    if (this.matchRing) {
      const u = game.user, mu = u && game.matchup(u);
      const on = mu && !mu.benched && !u.benched && game.phase !== 'ft' && game.phase !== 'replay';
      this.matchRing.visible = this.matchMark.visible = !!on;
      if (on) {
        const def = game.offense !== u.team;
        this.matchRing.position.set(mu.pos.x, 0.06, mu.pos.z);
        this.matchRing.material.opacity = def ? 0.75 + Math.sin(time * 6) * 0.15 : 0.3;
        this.matchMark.visible = def;
        this.matchMark.position.set(mu.pos.x, mu.heightFt + 1.5 + mu.y + Math.sin(time * 4) * 0.15, mu.pos.z);
      }
    }

    // Nets
    for (const h of this.hoops) {
      if (h.swishT > 0) {
        h.swishT -= dt;
        const t = 1 - h.swishT / 0.6;
        h.net.scale.set(1 - Math.sin(t * Math.PI) * 0.25, 1 + Math.sin(t * Math.PI) * 0.35, 1 - Math.sin(t * Math.PI) * 0.25);
      } else h.net.scale.set(1, 1, 1);
    }

    // Camera
    const bx = ball.vis ? ball.vis.x : ball.pos.x, bz = ball.vis ? ball.vis.z : ball.pos.z;
    if (this.camMode === 'replay' && this.replayFocus) {
      // Replay: low, slowly orbiting camera on the play
      this.replayAng = (this.replayAng ?? Math.PI * 0.3) + dt * 0.3;
      const F = this.replayFocus;
      this.camLook.x = damp(this.camLook.x, F.x, 5, dt);
      this.camLook.y = damp(this.camLook.y, 5.5, 5, dt);
      this.camLook.z = damp(this.camLook.z, F.z, 5, dt);
      this.camPos.set(this.camLook.x + Math.cos(this.replayAng) * 21, 7.5, this.camLook.z + Math.sin(this.replayAng) * 21);
    } else if (this.camMode === 'broadcast') {
      const focusX = Math.max(-30, Math.min(30, bx * 0.85));
      const aspect = this.camera.aspect;
      const dist = aspect > 1.9 ? 1 : aspect > 1.5 ? 1.08 : 1.6;
      const tp = new THREE.Vector3(focusX * 0.92, 27 * dist, 48 * dist + bz * 0.15);
      const tl = new THREE.Vector3(focusX, 2, bz * 0.25 - 2);
      this.camPos.x = damp(this.camPos.x, tp.x, 3.2, dt);
      this.camPos.y = damp(this.camPos.y, tp.y, 2, dt);
      this.camPos.z = damp(this.camPos.z, tp.z, 2, dt);
      this.camLook.x = damp(this.camLook.x, tl.x, 3.6, dt);
      this.camLook.y = damp(this.camLook.y, tl.y, 2, dt);
      this.camLook.z = damp(this.camLook.z, tl.z, 2, dt);
    } else {
      // 2K cam: behind the play, looking down the court at the hoop the offense attacks
      const d = game.dir(game.offense);
      const u = d * bx;
      const lookU = Math.min(u + 18, u * 0.5 + 17);
      const tl = new THREE.Vector3(d * lookU, 5, bz * 0.4);
      if (this.camYaw === undefined) this.camYaw = d > 0 ? 0 : -Math.PI;
      const yawT = d > 0 ? 0 : -Math.PI;
      this.camYaw = damp(this.camYaw, yawT, 2.6, dt);
      this.camLook.x = damp(this.camLook.x, tl.x, 3.0, dt);
      this.camLook.y = damp(this.camLook.y, tl.y, 3.0, dt);
      this.camLook.z = damp(this.camLook.z, tl.z, 2.5, dt);
      const fx = Math.cos(this.camYaw), fz = Math.sin(this.camYaw);
      const aspect = this.camera.aspect;
      const back = aspect > 1.9 ? 40 : aspect > 1.5 ? 46 : 62;
      this.camPos.set(this.camLook.x - fx * back, back * 0.5, this.camLook.z - fz * back);
    }
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 1.2;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 1.2;
    }
    this.camera.lookAt(this.camLook);
    this.r.render(this.scene, this.camera);
  }

  // Map a screen-space stick direction (x right, z down) to court space for the current camera.
  worldMap(jx, jy) {
    let fx = this.camLook.x - this.camPos.x, fz = this.camLook.z - this.camPos.z;
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const rx = -fz, rz = fx;
    return { x: rx * jx - fx * jy, z: rz * jx - fz * jy };
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  dispose() {
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.models = [];
  }
}

export { COURT_HALF_L, COURT_HALF_W };
