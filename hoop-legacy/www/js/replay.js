// Records the last few seconds of the game so big plays can be replayed, and keeps the best ones for a highlight reel.

const RATE = 30; // snapshots per second
const BEFORE = 3.2, AFTER = 1.6;
const FIELDS = ['action', 'actionT', 'actionDur', 'hasBall', 'holding', 'inbounding', 'post', 'dribblePhase', 'dribbleHand', 'bumpAt',
  'intenseD', 'boxing', 'released', 'shotStyle', 'ft', 'turnaround', 'turnSide', 'dunkStyle', 'releaseAt', 'jumpAtF', 'isUser', 'moveDir',
  'blockStyle', 'blockHand', 'swatT', 'hitT', 'closeT', 'snatchT', 'y', 'facing', 'heightFt', 'team', 'slot', 'idx', 'benched', 'meterOn', 'meter', 'jumpAt', 'contactVar', 'fallVar', 'anim'];

const lerp = (a, b, t) => a + (b - a) * t;
function angLerp(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

export class Recorder {
  constructor(game) {
    this.game = game;
    this.frames = [];
    this.acc = 0;
    this.pending = [];
    this.clips = [];
  }

  capture(dt) {
    this.acc += dt;
    if (this.acc < 1 / RATE) return;
    this.acc = 0;
    const g = this.game, b = g.ball;
    const players = g.players.map(p => {
      const o = { pos: { x: p.pos.x, z: p.pos.z }, vel: { x: p.vel.x, z: p.vel.z } };
      for (const f of FIELDS) o[f] = p[f];
      return o;
    });
    this.frames.push({ t: g.time, players, offense: g.offense, ball: { state: b.state, pos: { ...b.pos }, holder: b.holder ? b.holder.idx : -1 } });
    if (this.frames.length > RATE * 8) this.frames.shift();
  }

  // Remember a big play. Plays within 2s of each other on the same player merge (alley-oop + dunk, etc.).
  mark(kind, focusIdx, score, label, instant) {
    const t = this.game.time;
    const near = this.pending.find(m => m.focusIdx === focusIdx && Math.abs(m.t - t) < 2);
    if (near) {
      if (score > near.score) { near.score = score; near.label = label; near.kind = kind; }
      near.instant = near.instant || instant;
      return;
    }
    this.pending.push({ t, kind, focusIdx, score, label, instant });
  }

  cut(m) {
    const frames = this.frames.filter(f => f.t >= m.t - BEFORE && f.t <= m.t + AFTER);
    if (frames.length < 10) return null;
    const clip = { ...m, frames, eventT: m.t };
    this.clips.push(clip);
    this.clips.sort((a, b) => b.score - a.score);
    if (this.clips.length > 12) this.clips.length = 12;
    return clip;
  }

  // Returns a clip ready for an instant replay, once enough time has passed after the play.
  update() {
    let ready = null;
    for (const m of this.pending.slice()) {
      if (this.game.time < m.t + AFTER) continue;
      this.pending.splice(this.pending.indexOf(m), 1);
      const clip = this.cut(m);
      if (clip && m.instant && (!ready || clip.score > ready.score)) ready = clip;
    }
    return ready;
  }

  flush() { for (const m of this.pending) this.cut(m); this.pending = []; }

  // Best plays of the game, in the order they happened.
  reel(n = 5) { return this.clips.slice(0, n).sort((a, b) => a.eventT - b.eventT); }
}

// Plays clips back through the normal renderer.
export class ReplayPlayer {
  constructor(clips, teams, onClip) {
    this.clips = clips;
    this.teams = teams;
    this.ci = 0;
    this.fi = 0;
    this.onClip = onClip;
    this.done = false;
    this.lastT = null;
    if (onClip) onClip(clips[0], 0);
  }

  get clip() { return this.clips[this.ci]; }

  skipClip() {
    this.ci++;
    this.fi = 0;
    this.lastT = null;
    if (this.ci >= this.clips.length) this.done = true;
    else if (this.onClip) this.onClip(this.clip, this.ci);
  }

  // Advance and return { game, crossedEvent, rate }
  step(dt) {
    const c = this.clip;
    const fr = c.frames;
    const cur = fr[Math.min(fr.length - 1, Math.floor(this.fi))];
    const nearEvent = Math.abs(cur.t - c.eventT) < 0.7;
    const rate = nearEvent ? 0.35 : 1;
    this.fi += dt * RATE * rate;
    if (this.fi >= fr.length - 1) { this.skipClip(); if (this.done) return null; return this.step(0); }
    const i = Math.floor(this.fi), a = fr[i], b = fr[Math.min(fr.length - 1, i + 1)], k = this.fi - i;
    const crossed = this.lastT !== null && this.lastT < c.eventT && a.t >= c.eventT;
    this.lastT = a.t;
    return { game: this.fake(a, b, k), crossedEvent: crossed, rate, focus: c.focusIdx };
  }

  fake(a, b, k) {
    const players = a.players.map((p, i) => {
      const q = b.players[i];
      return { ...p, pos: { x: lerp(p.pos.x, q.pos.x, k), z: lerp(p.pos.z, q.pos.z, k) }, y: lerp(p.y, q.y, k), facing: angLerp(p.facing, q.facing, k) };
    });
    const bp = { x: lerp(a.ball.pos.x, b.ball.pos.x, k), y: lerp(a.ball.pos.y, b.ball.pos.y, k), z: lerp(a.ball.pos.z, b.ball.pos.z, k) };
    const user = players.find(p => p.isUser);
    return {
      players, teams: this.teams, offense: a.offense, time: lerp(a.t, b.t, k), phase: 'replay',
      ball: { state: a.ball.state, pos: bp, holder: a.ball.holder >= 0 ? players[a.ball.holder] : null, vis: null },
      user, matchup: u => players.find(q => q.team !== u.team && q.slot === u.slot), dir: t => (t === 0 ? 1 : -1),
    };
  }
}
