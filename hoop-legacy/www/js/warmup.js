// Pregame warmups: both teams shoot around at their own baskets with their own practice balls, and the
// story's cutscenes (first game, rivalry trash talk) play over it. Drives the players directly; the game sim
// is paused (phase 'pregame') until tip-off.
import { HOOP_X, RIM_Y } from './game.js';
import { VO } from './vo-lines.js';

const G = 30;
const rand = (a, b) => a + Math.random() * (b - a);
const len = (x, z) => Math.hypot(x, z);

export class Warmup {
  constructor(game, renderer, script = null) {
    this.g = game; this.R = renderer;
    this.t = 0;
    this.script = script; // [{ focus, with, cam, speaker, text, walkTo }] cutscene shots
    this.line = 0;
    this.saved = game.players.map(p => ({ pos: { ...p.pos }, facing: p.facing }));
    this.balls = renderer.warmupBalls(game.players.length);
    this.ps = game.players.map((p, i) => ({ p, i, st: 'walk', spot: this.spotFor(p), ball: this.balls[i], held: true, wait: rand(0, 1.2) }));
    // Start everyone near their own end, spread out
    for (const s of this.ps) {
      const d = this.side(s.p);
      s.p.pos = { x: d * rand(14, 30), z: rand(-18, 18) };
      this.reset(s.p);
    }
    if (script && script[0] && script[0].start) for (const [i, at] of Object.entries(script[0].start)) this.g.players[i].pos = { ...at };
    renderer.warmup = this;
  }
  side(p) { return this.g.dir(p.team); }
  spotFor(p) {
    const d = this.side(p), a = rand(-1.3, 1.3), r = rand(7, 22);
    return { x: d * (HOOP_X - Math.cos(a) * r), z: Math.sin(a) * r };
  }
  reset(p) {
    p.vel = { x: 0, z: 0 }; p.action = null; p.actionT = 0; p.y = 0; p.vy = 0; p.released = false;
    p.hasBall = true; p.holding = true; p.post = false; p.inbounding = false; p.benched = false;
  }
  // The scripted shot on screen now (null once the cutscene is over)
  get shot() { return this.script && this.line < this.script.length ? this.script[this.line] : null; }
  next() { this.line++; return !!this.shot; }

  update(dt) {
    this.t += dt;
    const shot = this.shot;
    for (const s of this.ps) {
      const p = s.p;
      // Cutscene: the players in the shot walk where the script says and face each other
      if (shot && shot.walkTo && shot.walkTo[s.i]) {
        if (p.action) { this.reset(p); s.st = 'walk'; }
        if (!s.ball.fly) { s.held = true; p.hasBall = true; p.holding = true; }
        this.walk(s, shot.walkTo[s.i], dt, 8, shot.face && shot.face[s.i]);
        this.flyBall(s, dt);
        continue;
      }
      if (s.wait > 0) { s.wait -= dt; p.vel = { x: 0, z: 0 }; continue; }
      if (s.st === 'walk') {
        if (this.walk(s, s.spot, dt, 7)) { s.st = 'shoot'; this.startShot(s); }
      } else if (s.st === 'shoot') {
        p.actionT += dt;
        p.meter = p.actionT / 0.62;
        const tj = p.actionT - p.jumpAt;
        p.y = tj > 0 ? Math.max(0, p.shotVy * tj - 0.5 * G * tj * tj) : 0;
        if (!p.released && p.actionT >= 0.62) { p.released = true; this.launch(s); }
        if (p.actionT >= p.actionDur) { this.reset(p); p.hasBall = false; p.holding = false; s.st = 'chase'; }
      } else if (s.st === 'chase') {
        // Get your rebound back, then head to a new spot
        if (!s.ball.fly) { s.held = true; p.hasBall = true; p.holding = true; s.spot = this.spotFor(p); s.st = 'walk'; s.wait = rand(0.1, 0.6); }
        else if (s.ball.fly.t > s.ball.fly.T) this.walk(s, { x: s.ball.pos.x, z: s.ball.pos.z }, dt, 9);
      }
      this.flyBall(s, dt);
    }
  }
  walk(s, to, dt, speed, faceAt) {
    const p = s.p, dx = to.x - p.pos.x, dz = to.z - p.pos.z, d = len(dx, dz);
    if (d < 0.4) {
      p.vel = { x: 0, z: 0 };
      if (faceAt) p.facing = Math.atan2(faceAt.x - p.pos.x, faceAt.z - p.pos.z);
      return true;
    }
    const sp = Math.min(speed, d * 3);
    p.vel = { x: dx / d * sp, z: dz / d * sp };
    p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt;
    p.facing = Math.atan2(dx, dz);
    return false;
  }
  startShot(s) {
    const p = s.p, d = this.side(p);
    p.facing = Math.atan2(d * HOOP_X - p.pos.x, -p.pos.z);
    p.action = 'shoot'; p.actionT = 0; p.actionDur = 1.15; p.jumpAt = 0.3; p.shotVy = 9 + p.r.vert * 0.03;
    p.released = false; p.shotStyle = null; p.ft = false; p.holding = false; p.meter = 0;
  }
  // Practice shot: arc from the hand to the rim; makes drop through the net, misses kick off the rim
  launch(s) {
    const p = s.p, d = this.side(p), m = this.R.models[p.idx];
    const from = m.ballWorld.clone(), make = Math.random() < 0.45 + p.r.three / 250;
    const T = 0.9 + len(d * HOOP_X - from.x, from.z) * 0.02;
    const off = make ? 0 : rand(0.7, 1.2) * (Math.random() < 0.5 ? 1 : -1);
    s.held = false;
    s.ball.fly = { from, to: { x: d * HOOP_X - d * off * 0.6, y: RIM_Y + 0.15, z: off * 0.8 }, T, t: 0, make, d };
  }
  flyBall(s, dt) {
    const f = s.ball.fly;
    if (!f) return;
    f.t += dt;
    const b = s.ball.pos;
    if (f.t <= f.T) {
      const k = f.t / f.T, vy = (f.to.y - f.from.y + 0.5 * G * f.T * f.T) / f.T;
      b.x = f.from.x + (f.to.x - f.from.x) * k; b.z = f.from.z + (f.to.z - f.from.z) * k;
      b.y = f.from.y + vy * f.t - 0.5 * G * f.t * f.t;
      if (f.t + dt > f.T) {
        // Off the rim / through the net: bounce out toward the free-throw line and roll
        f.v = f.make ? { x: -f.d * rand(1, 3), y: -4, z: rand(-2, 2) } : { x: -f.d * rand(4, 9), y: rand(4, 8), z: rand(-6, 6) };
      }
    } else {
      const v = f.v;
      v.y -= G * dt;
      b.x += v.x * dt; b.y += v.y * dt; b.z += v.z * dt;
      if (b.y < 0.4) { b.y = 0.4; v.y = Math.abs(v.y) * 0.55; v.x *= 0.85; v.z *= 0.85; if (v.y < 1.2) v.y = 0; }
      // Picked up by its shooter
      const p = s.p;
      if (f.t > f.T + 0.4 && len(p.pos.x - b.x, p.pos.z - b.z) < 1.8) s.ball.fly = null;
      else if (f.t > f.T + 4) s.ball.fly = null; // rolled away: a ball boy tosses another one back
    }
  }
  // Called by the renderer after the models are posed: balls in hands follow the palms
  place() {
    for (const s of this.ps) {
      const m = this.R.models[s.p.idx], mesh = s.ball.mesh;
      if (s.ball.fly) mesh.position.set(s.ball.pos.x, s.ball.pos.y, s.ball.pos.z);
      else if (s.p.action === 'shoot' && !s.p.released) mesh.position.copy(s.p.actionT < 0.2 ? m.ballWorld2 : m.ballWorld);
      else mesh.position.copy(m.ballWorld2);
      mesh.visible = true;
    }
  }
  // Camera for the cutscene shot (or a slow wide pan over the warmups)
  camera() {
    const shot = this.shot;
    if (shot && shot.focus != null) {
      const a = this.g.players[shot.focus].pos, b = shot.with != null ? this.g.players[shot.with].pos : a;
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const o = shot.cam || { dx: 0, dy: 5.5, dz: 11 };
      return { pos: { x: cx + o.dx, y: o.dy, z: cz + o.dz }, look: { x: cx, y: o.ly ?? 5, z: cz } };
    }
    const a = this.t * 0.12;
    return { pos: { x: Math.sin(a) * 30, y: 16, z: 44 + Math.cos(a) * 4 }, look: { x: Math.sin(a) * 14, y: 4, z: 0 } };
  }
  end() {
    this.R.clearWarmup();
    this.g.players.forEach((p, i) => { p.pos = { ...this.saved[i].pos }; p.facing = this.saved[i].facing; this.reset(p); p.hasBall = false; p.holding = false; p.meter = 0; });
  }
}

// Story cutscenes over the warmup. `u` = your player's index, `o` = the other team's star.
export function cutscene(kind, game, names) {
  const u = game.user.idx;
  const opp = game.players.filter(p => p.team !== game.user.team).sort((a, b) => (b.ovr || 0) - (a.ovr || 0))[0];
  const d = game.dir(game.user.team);
  // Voiced lines: the text shown is exactly what's spoken (see vo-lines.js)
  const L = id => ({ vo: id, text: VO[id].text });
  if (kind === 'debut') {
    const tunnel = { x: -d * 10, z: 27 }, spot = { x: d * 26, z: 4 };
    return [
      { focus: u, cam: { dx: -6, dy: 5, dz: 9 }, walkTo: { [u]: { x: 0, z: 22 } }, speaker: 'Narrator', ...L('debut_1'), start: { [u]: tunnel } },
      { focus: u, cam: { dx: 5, dy: 5.5, dz: 10 }, walkTo: { [u]: spot }, speaker: 'Coach Reyes', ...L('debut_2') },
      { focus: u, cam: { dx: -4, dy: 6, dz: 12 }, speaker: names.first, ...L('debut_3') },
    ];
  }
  // Trash talk: they walk up face to face, three exchanges, then the coach (or teammate) pulls you away
  const LINES = { trash: 'Coach Reyes', rival: 'Teammate', heated: 'Teammate' }[kind] && [1, 2, 3, 4].map(i => L(`${kind}_${i}`)).concat([{ trash: 'Coach Reyes', rival: 'Teammate', heated: 'Teammate' }[kind]]);
  if (LINES) {
    const t = names.talker != null ? game.players[names.talker] : opp;
    const mid = { x: 0, z: 2 }, close = { [t.idx]: { x: d * 2.5, z: 2 }, [u]: { x: -d * 2.3, z: 2 } }, faceEach = { [t.idx]: { x: -d * 2, z: 2 }, [u]: { x: d * 2, z: 2 } };
    const who = `#${t.num} ${t.name}`;
    return [
      { focus: t.idx, start: { [t.idx]: { x: d * 9, z: 6 }, [u]: { x: -d * 6, z: -2 } }, cam: { dx: 6, dy: 5.5, dz: 10 }, walkTo: { [t.idx]: { x: d * 3.2, z: 2 }, [u]: { x: -d * 2.3, z: 2 } }, face: { [t.idx]: mid, [u]: mid }, speaker: who, ...LINES[0] },
      { focus: u, with: t.idx, cam: { dx: 0, dy: 5.8, dz: 9 }, walkTo: close, face: faceEach, speaker: names.first, ...LINES[1] },
      { focus: t.idx, with: u, cam: { dx: -5, dy: 5.5, dz: 8 }, walkTo: close, face: faceEach, speaker: who, ...LINES[2] },
      { focus: u, cam: { dx: 6, dy: 5, dz: 8 }, walkTo: { [t.idx]: { x: -d * 14, z: -6 }, [u]: { x: d * 10, z: 4 } }, speaker: LINES[4], ...LINES[3] },
    ];
  }
  return null;
}
