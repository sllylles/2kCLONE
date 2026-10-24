// Basketball match simulation: 5v5 full court, user controls one player (MyCareer style).
import { DRIBBLE_STYLES, JUMPSHOTS, FLASHY_DUNKS, TAKEOVERS, GOAT_SKILLS, animProfile, takeoverType, clamp, reachOf } from './data.js';

export const HOOP_X = 41.75;
export const RIM_Y = 10;
export const COURT_HALF_L = 47;
export const COURT_HALF_W = 25;
const G_BALL = 32;
const G_PLAYER = 38;

const rand = (a, b) => a + Math.random() * (b - a);
const chance = p => Math.random() < p;
const len = (x, z) => Math.hypot(x, z);
const lerp = (a, b, t) => a + (b - a) * t;
const angTo = (dx, dz) => Math.atan2(dx, dz);
function angLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 0.75; }

// Offensive spots in (u = feet from baseline, v = lateral) coordinates.
// The lane is u < 19, |v| < 8: only the dunker spots and cuts live near it, everything else is spaced out.
const BASE_SPOTS = [[30, 0], [22, 19], [4, -22.5], [17, -13], [5, 11]];
const SPOT_POOL = [[30, 0], [27, 12], [27, -12], [22, 19], [22, -19], [4, 22.5], [4, -22.5], [21, 0], [5, 11], [5, -11], [17, 13], [17, -13], [11, 15], [11, -15]];
const inLane = (u, v) => u < 19.5 && Math.abs(v) < 8.5;
const TIP_SPOTS = [[3, 0], [9, 10], [9, -10], [14, 5], [14, -5]];

export class Game {
  constructor(opts) {
    this.opts = opts;
    this.teams = opts.teams;
    this.userTeam = opts.userTeam;
    this.qLen = opts.qLen * 60;
    this.diff = opts.difficulty ?? 1;
    this.style = DRIBBLE_STYLES[opts.dribbleStyle || 'quick'];
    this.js = JUMPSHOTS[opts.jumpshot || 'standard'];
    this.defAssist = opts.defAssist !== false;
    this.passBias = opts.passBias ?? 0.3;
    this.emit = opts.onEvent || (() => {});
    this.players = [];
    opts.rosters.forEach((roster, t) => roster.forEach((def, slot) => {
      const isUser = t === this.userTeam && slot === opts.userSlot;
      const r = { ...def.ratings };
      if (isUser && opts.boost) for (const k in r) r[k] = Math.min(99, r[k] + opts.boost);
      this.players.push({
        ...def, r, team: t, slot, idx: this.players.length, isUser,
        anim: animProfile({ ...def, r }, isUser ? { dribble: opts.dribbleStyle, jumpshot: opts.jumpshot, dunk: opts.dunkPkg, defense: opts.defStance } : {}),
        toType: takeoverType(r, isUser ? opts.playstyle : null), toMeter: 0, toOn: false,
        pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, y: 0, vy: 0, facing: 0,
        action: null, actionT: 0, actionDur: 0, stun: 0, hasBall: false, holding: false,
        dribblePhase: 0, dribbleHand: 'R', energy: 100, aiT: 0, aiTarget: null, spotT: 0, spot: null,
        push: { x: 0, z: 0 }, hitT: 0, post: false, oobUntil: 0,
        stats: { pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, pf: 0, dnk: 0 },
      });
    }));
    this.user = this.players.find(p => p.isUser);
    this.intensity = opts.intensity || 0; this.lastScuffle = -99;
    // Team chemistry (from interviews): teammates start with a head start on their takeovers
    if (opts.chemTakeover && this.user) for (const p of this.players) if (p.team === this.user.team && !p.isUser) p.toMeter = opts.chemTakeover;
    // Your rival comes out heated: takeover on from the tip, held through the whole first quarter
    for (const p of this.players) if (p.isRival) { p.toOn = true; p.toMeter = 1; p.toQ1 = true; }
    for (const t of [0, 1]) {
      const best = Math.max(...this.players.filter(p => p.team === t).map(p => p.ovr || 0));
      for (const p of this.players) if (p.team === t) p.toStar = (p.ovr || 0) >= best - 1;
    }
    this.ball = { state: 'dead', holder: null, pos: { x: 0, y: 4, z: 0 }, vel: { x: 0, y: 0, z: 0 }, lastTouch: 0 };
    this.score = [0, 0];
    this.quarter = 1;
    this.clock = this.qLen;
    this.shotClock = 24;
    this.offense = 0;
    this.phase = 'pregame';
    this.time = 0;
    this.grade = 62;
    this.gradeLog = [];
    this.moveCombo = 0;
    this.lastMoveT = -9;
    this.possStart = Math.random() < 0.5 ? 0 : 1;
    this.pending = null;
    this.buzzer = false;
    this.ftQueue = null;
    this.teamFouls = [0, 0];
    this.shotSeq = 0;
    this.badgeTiers = opts.badges || {};
    this.badgeCounts = {};
    this.greenStreak = 0;
    this.inb = null;
    // How hard the other team plays you: ramps up from 65 OVR to 90 OVR
    this.heat = this.user ? clamp(((this.user.ovr || 60) - 65) / 25, 0, 1) : 0;
  }
  // AI player on the team the user is playing against
  isFoe(p) { return p && !p.isUser && this.user && p.team !== this.user.team; }

  // ---------- helpers ----------
  dir(team) { return team === 0 ? 1 : -1; }
  hoopOf(team) { return { x: this.dir(team) * HOOP_X, z: 0 }; }
  teamPlayers(t) { return this.players.filter(p => p.team === t && !p.benched); }
  opp(p) { return this.players.find(q => q.team !== p.team && q.slot === p.slot); }
  spotToWorld(team, u, v) { return { x: this.dir(team) * (COURT_HALF_L - u), z: v }; }
  distHoop(p, team = p.team) { const h = this.hoopOf(team); return len(p.pos.x - h.x, p.pos.z - h.z); }
  is3(x, z, team) {
    const u = COURT_HALF_L - this.dir(team) * x;
    if (Math.abs(z) >= 22 && u <= 14) return true;
    const h = this.hoopOf(team);
    return len(x - h.x, z - h.z) >= 23.75;
  }
  nearestDefender(p) {
    let best = null, bd = 1e9;
    for (const q of this.players) {
      if (q.team === p.team || q.benched) continue;
      const d = len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
      if (d < bd) { bd = d; best = q; }
    }
    return { q: best, d: bd };
  }
  maxSpeed(p) {
    let s = 17.2 + p.r.speed * 0.048; // 36 speed ~18.9, 90 ~21.5
    if (p.hasBall) s *= 0.88 + p.r.handle * 0.0012;
    if (p.isUser && p.energy < 25) s *= 0.85;
    if (p.intenseD) s *= 0.88;
    return s;
  }
  // Badge tier (0-4) for a player; only the user has badges
  bt(p, key) { return p && p.isUser ? (this.badgeTiers[key] || 0) : 0; }
  bc(p, key, n = 1) { if (p && p.isUser) this.badgeCounts[key] = (this.badgeCounts[key] || 0) + n; }
  // ---------- takeovers ----------
  // Good plays fill the meter, bad ones drain it. Full: you take over for a stretch (it drains over ~20s, and
  // good plays keep it going). Everyone has one, but only stars fill theirs at a real rate.
  toIs(p, type) { return !!(p && p.toOn && p.toType === type); }
  // `cat` = what kind of play it was: your takeover becomes whatever you've been doing the most
  // (2K-style: slash a lot and you get a Finishing takeover, lock people up and you get Lockdown)
  toGain(p, amt, cat = null) {
    if (!p || p.benched || this.phase === 'over') return;
    if (cat && amt > 0) {
      p.toAct = p.toAct || {};
      p.toAct[cat] = (p.toAct[cat] || 0) + amt;
      if (p.isUser && !p.toOn) p.toType = Object.keys(p.toAct).reduce((a, b) => (p.toAct[b] > p.toAct[a] ? b : a));
    }
    if (amt > 0) {
      // AI: the team's best players heat up, role players rarely; tougher when you're a star yourself
      const rate = p.isUser ? 1 : clamp(((p.ovr || 70) - 62) / 20, 0.15, 1) * (p.toStar ? 1 : 0.55) * (0.8 + this.heat * 0.4);
      amt *= p.toOn ? 0.55 : rate;
    }
    if (amt > 0) p.toLast = this.time;
    p.toMeter = clamp(p.toMeter + amt, 0, 1);
    if (!p.toOn && p.toMeter >= 1) {
      p.toOn = true;
      this.emit('takeover', { p, type: p.toType, info: TAKEOVERS[p.toType] });
    }
  }
  // GOAT skill progress for the user (cat = finishing / shooting / playmaking / defense / rebounding)
  goatHit(p, cat) {
    if (!p || !p.isUser || !this.opts.goat || this.opts.goat !== cat || p.goatOn) return;
    const G = GOAT_SKILLS[cat];
    p.goatN = (p.goatN || 0) + 1;
    if (p.goatN >= G.need) {
      p.goatN = 0; p.goatOn = true; p.goatUntil = this.time + this.qLen * 5 / 12;
      p.goatSaved = {};
      for (const k of G.attrs) { p.goatSaved[k] = p.r[k]; p.r[k] = 99; }
      this.emit('goat', { p, info: G });
    } else this.emit('goatProgress', { p, n: p.goatN, need: G.need });
  }
  updateTakeovers(dt) {
    if (this.pending2) { this.p2t = (this.p2t || 0) + dt; if (this.p2t > 1.6) { const f = this.pending2; this.pending2 = null; this.p2t = 0; f(); } }
    const u = this.user;
    if (u && u.goatOn && this.time >= u.goatUntil) {
      for (const k in u.goatSaved) u.r[k] = u.goatSaved[k];
      u.goatOn = false; u.goatSaved = null;
      this.emit('goatEnd', { p: u });
    }
    for (const p of this.players) {
      if (p.toQ1) { if (this.quarter === 1) { p.toMeter = 1; continue; } p.toQ1 = false; }
      if (p.toOn) {
        p.toMeter -= dt / 20;
        if (p.toMeter <= 0) { p.toMeter = 0; p.toOn = false; p.toAct = {}; this.emit('takeoverEnd', { p }); }
      } else if (p.toMeter > 0 && this.time - (p.toLast || 0) > 25) p.toMeter = Math.max(0, p.toMeter - dt * 0.002); // cools off when quiet
    }
  }
  isDown(p) { return p.action === 'fall' || p.action === 'posterfall'; }
  matchup(p) { return this.opp(p); }
  knock(p, from, power, anim, dur, force = false) {
    let dx = p.pos.x - from.x, dz = p.pos.z - from.z; const l = len(dx, dz) || 1;
    p.push.x += dx / l * power; p.push.z += dz / l * power;
    p.hitDir = { x: dx / l, z: dz / l };
    // Posterized defenders go down even if they were in the air
    if (force && anim) { this.setAction(p, anim, dur); p.stun = Math.max(p.stun, dur * 0.8); }
    else if (p.y > 0.3 || ['layup', 'dunk', 'hang', 'shoot'].includes(p.action)) p.hitT = 0.45;
    else if (anim) { this.setAction(p, anim, dur); p.stun = Math.max(p.stun, dur * 0.8); }
    this.emit('contact', { p, power });
  }
  startBlock(p, rebound = false) {
    this.setAction(p, rebound ? 'rebound' : 'block', 0.75);
    p.vy = 11 + p.r.vert * 0.06;
    p.blockStyle = chance(0.8) ? 'one' : 'two';
    const s = this.ball.holder && this.ball.holder.team !== p.team ? this.ball.holder : null;
    // Block with the hand on the ball's side
    const bp = this.ball.vis || this.ball.pos;
    if (bp) { const fx = Math.sin(p.facing), fz = Math.cos(p.facing), lx = bp.x - p.pos.x, lz = bp.z - p.pos.z; p.blockHand = (lx * fz - lz * fx) > 0 ? 'L' : 'R'; }
    else p.blockHand = chance(0.6) ? 'R' : 'L';
    if (s && this.isBehind(p, s)) p.blockStyle = 'chase';
  }

  // Is defender q trailing shooter s (behind him on the way to the rim)?
  isBehind(q, s) {
    const h = this.hoopOf(s.team);
    const hx = h.x - s.pos.x, hz = h.z - s.pos.z, hl = len(hx, hz) || 1;
    const rx = q.pos.x - s.pos.x, rz = q.pos.z - s.pos.z, rl = len(rx, rz) || 1;
    return (rx * hx + rz * hz) / (hl * rl) < -0.25 && rl < 9;
  }
  setAction(p, a, dur) { p.action = a; p.actionT = 0; p.actionDur = dur; p.released = false; p.jumped = false; }
  addGrade(delta, label) {
    this.grade = clamp(this.grade + delta, 0, 100);
    this.gradeLog.push({ delta, label });
    this.emit('grade', { delta, label, grade: this.grade });
  }

  // ---------- flow ----------
  start() {
    this.formation(this.possStart);
    if (this.opts.benchStart) {
      this.user.benched = true;
      // Sim first half of the 1st quarter with the user on the bench.
      const simSecs = this.qLen * 0.5;
      this.simChunk(simSecs);
      this.clock = this.qLen - simSecs;
      this.user.benched = false;
      this.phase = 'bench';
      this.emit('benchIntro', { clock: this.clock, score: [...this.score] });
      return;
    }
    this.setupTip();
  }
  // ---------- jump ball ----------
  // Centers face off in the center circle, everyone else lines up around it; the ref tosses it up, the centers
  // jump and the winner taps it to their point guard. Height, vertical and timing win it (tap SHOOT to jump if
  // you're the one jumping).
  setupTip() {
    this.inb = null; this.pending = null;
    const ring = [[-5.5, 6.5], [-5.5, -6.5], [-11, 2], [-11, -9]];
    for (const t of [0, 1]) {
      const d = this.dir(t), mates = this.teamPlayers(t);
      const c = mates.find(p => p.slot === 4) || mates[mates.length - 1];
      mates.filter(p => p !== c).forEach((p, i) => { const [u, v] = ring[i]; p.pos = { x: d * u, z: v * (t ? -1 : 1) }; p.facing = angTo(-p.pos.x, -p.pos.z); });
      c.pos = { x: -d * 1.3, z: 0 }; c.facing = angTo(d, 0);
      this.tipC = this.tipC || {}; this.tipC[t] = c;
    }
    for (const p of this.players) {
      p.vel = { x: 0, z: 0 }; p.y = 0; p.vy = 0; p.action = null; p.stun = 0; p.hasBall = false; p.holding = false; p.post = false;
      p.push.x = p.push.z = 0; p.aiTarget = null;
    }
    const b = this.ball;
    b.holder = null; b.state = 'tip'; b.pos = { x: 0, y: 5.5, z: -0.9 }; b.vel = { x: 0, y: 0, z: 0 };
    this.tip = { t: 0, jumped: {}, userJumpAt: null };
    this.phase = 'tip';
    this.emit('tipoff', {});
    for (const p of this.players) if (p.isRival) this.emit('takeover', { p, type: p.toType, info: TAKEOVERS[p.toType] });
  }
  updateTip(dt, input) {
    const T = this.tip, b = this.ball;
    T.t += dt;
    const toss = 0.8; // ref holds it, then tosses
    if (T.t > toss && !T.won) {
      const k = T.t - toss;
      b.pos = { x: 0, y: 5.5 + 21 * k - 0.5 * G_BALL * k * k, z: -0.9 + Math.min(0.9, k * 1.5) };
    }
    for (const t of [0, 1]) {
      const c = this.tipC[t];
      const auto = toss + 0.42 + (c.isUser ? 0 : (Math.random() - 0.5) * 0.002 + (99 - c.r.vert) * 0.002);
      const press = c.isUser && input && input.shootPressed && T.t > toss;
      if (!T.jumped[t] && ((c.isUser && (press || T.t > toss + 0.75)) || (!c.isUser && T.t > auto))) {
        T.jumped[t] = T.t; this.setAction(c, 'rebound', 0.9); c.vy = 11 + c.r.vert * 0.06;
      }
      if (T.jumped[t]) { c.vy -= G_PLAYER * dt; c.y = Math.max(0, c.y + c.vy * dt); }
    }
    // The ball comes back down into the jumpers' reach: whoever is higher (with a timing / athleticism roll) taps it
    const apexT = toss + 21 / G_BALL;
    if (!T.won && T.t > apexT + 0.08) {
      const reach = t => { const c = this.tipC[t]; return reachOf(c.heightFt) + c.y + c.r.vert * 0.01 + Math.random() * 0.9; };
      const r0 = reach(0), r1 = reach(1);
      if (Math.max(r0, r1) >= b.pos.y - 0.6 || T.t > apexT + 0.45) {
        const w = r0 >= r1 ? 0 : 1;
        T.won = true;
        const pg = this.handlerFor(w);
        this.offense = w;
        this.startPass(null, pg, { from: { ...b.pos }, team: w, noIntercept: true });
        this.emit('tipWon', { team: w, by: this.tipC[w] });
      }
    }
    if (T.won && b.state !== 'pass') { this.tip = null; this.phase = 'live'; this.shotClock = 24; }
  }
  resumeFromBench() {
    this.formation(this.offense);
    this.phase = 'dead';
    this.pending = { t: 0.8, fn: () => { this.phase = 'live'; } };
  }

  simChunk(secs) {
    const rate = t => {
      const avg = this.teamPlayers(t).reduce((s, p) => s + (p.r.mid + p.r.three + p.r.layup) / 3, 0) / 5;
      return avg;
    };
    let t = 0, team = this.possStart;
    while (t < secs) {
      const o = rate(team), d = rate(1 - team);
      const p = clamp(0.47 + (o - d) / 200, 0.3, 0.65);
      if (chance(p)) {
        const pts = chance(0.35) ? 3 : 2;
        this.score[team] += pts;
        const tp = this.teamPlayers(team);
        const scorer = tp[Math.floor(Math.random() * tp.length)];
        if (scorer && !scorer.isUser) { scorer.stats.pts += pts; scorer.stats.fgm++; scorer.stats.fga++; }
      }
      team = 1 - team;
      t += rand(10, 16);
    }
    this.offense = team;
  }

  formation(team) {
    this.inb = null;
    this.offense = team;
    for (const p of this.players) {
      const side = p.team === team ? -1 : 1; // offense starts in its backcourt
      const d = this.dir(team);
      const [u, v] = TIP_SPOTS[p.slot];
      const sx = p.team === team ? -d * u : d * (u + 2);
      p.pos.x = sx; p.pos.z = v * (p.team === team ? 1 : -1);
      p.vel.x = p.vel.z = 0; p.y = 0; p.vy = 0; p.action = null; p.stun = 0;
      p.oobUntil = 0; p.inbounding = false; p.post = false; p.push.x = p.push.z = 0;
      p.hasBall = false; p.facing = angTo(d, 0) * (p.team === team ? 1 : 1);
      p.facing = p.team === team ? angTo(d, 0) : angTo(-d, 0);
      void side;
    }
    const pg = this.handlerFor(team);
    this.giveBall(pg, true);
    this.shotClock = 24;
  }

  handlerFor(team) {
    // User gets the ball to bring it up if they're the PG
    return this.teamPlayers(team).find(p => p.slot === 0) || this.teamPlayers(team)[0];
  }

  giveBall(p, holding = false) {
    for (const q of this.players) q.hasBall = false;
    p.hasBall = true;
    p.holding = holding;
    p.ballSince = this.time;
    p.aiT = rand(0.3, 0.7);
    const b = this.ball;
    b.state = 'held'; b.holder = p; b.lastTouch = p.team;
    b.pos.x = p.pos.x; b.pos.z = p.pos.z; b.pos.y = 3.5;
    if (this.offense !== p.team) this.changePossession(p.team);
  }

  changePossession(team) {
    this.offense = team;
    this.shotClock = 24;
    for (const p of this.players) { p.spot = null; p.spotT = 0; p.callT = 0; p.lobCall = 0; }
  }

  sidelineSpot(pos) { return { x: clamp(pos.x, -43, 43), z: (pos.z >= 0 ? 1 : -1) * 26.3, side: true }; }

  // Dead ball: one player grabs it out of bounds, another comes to receive it.
  inbound(team, delay = 1.1, spot = null) {
    this.phase = 'dead';
    this.pending = null;
    for (const p of this.players) { p.hasBall = false; p.post = false; }
    this.ball.state = 'dead';
    this.ball.holder = null;
    this.changePossession(team);
    // After a score your player heads to the other end on their own (until you touch the stick):
    // getting into the offense, or getting back and picking up their man
    if (this.user) { this.user.autoRun = true; this.user.autoRunT = 0; }
    const d = this.dir(team);
    if (!spot) spot = { x: -d * 48.6, z: (chance(0.5) ? 1 : -1) * 3.5 };
    const recv = this.handlerFor(team);
    const cands = this.teamPlayers(team).filter(p => p !== recv && !p.isUser);
    let inb = cands[0], bd = 1e9;
    for (const p of cands) { const dd = len(p.pos.x - spot.x, p.pos.z - spot.z); if (dd < bd) { bd = dd; inb = p; } }
    const sz = Math.sign(spot.z) || 1;
    const recvSpot = spot.side
      ? { x: clamp(spot.x + d * 4, -42, 42), z: sz * 16 }
      : { x: spot.x - Math.sign(spot.x) * 13, z: sz * 9 };
    inb.oobUntil = this.time + 99;
    this.inb = { team, spot, recvSpot, inbounder: inb, receiver: recv, t: 0, stage: 'go', delay };
  }

  updateInbound(dt) {
    const I = this.inb;
    I.t += dt;
    const ip = I.inbounder, r = I.receiver;
    if (I.stage === 'go') {
      const d = len(ip.pos.x - I.spot.x, ip.pos.z - I.spot.z);
      if ((d < 1.4 && I.t > I.delay * 0.6) || I.t > 3.2) {
        if (d > 1.4) { ip.pos.x = I.spot.x; ip.pos.z = I.spot.z; }
        ip.vel.x = ip.vel.z = 0;
        this.giveBall(ip, true);
        ip.inbounding = true;
        I.stage = 'ready'; I.readyT = 0;
      }
    } else {
      I.readyT += dt;
      const dr = len(r.pos.x - I.recvSpot.x, r.pos.z - I.recvSpot.z);
      if (I.readyT > 0.55 && (dr < 4 || I.readyT > 2.0)) {
        ip.inbounding = false;
        ip.oobUntil = this.time + 1.0;
        this.inb = null;
        this.startPass(ip, r, { noIntercept: true });
        this.phase = 'live';
      }
    }
  }

  // ---------- main loop ----------
  update(dt, input) {
    if (this.phase === 'over' || this.phase === 'break' || this.phase === 'bench' || this.phase === 'pregame') return;
    this.time += dt;
    if (this.phase === 'ending') {
      this.endT -= dt;
      const still = { move: { x: 0, z: 0 } };
      for (const p of this.players) p.aiTarget = null;
      this.updatePlayers(dt, still);
      this.updateBall(dt);
      if (this.endT <= 0) this.finishQuarter();
      return;
    }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const f = this.pending.fn; this.pending = null; f(); }
    }
    if (this.phase === 'tip') {
      this.updateTip(dt, input);
      if (this.tip && this.tip.won) { this.updatePlayers(dt, { move: { x: 0, z: 0 } }); this.updateBall(dt); }
      return;
    }
    if (this.inb) this.updateInbound(dt);
    if (this.phase === 'ft') this.updateFT(dt, input);
    else this.handleInput(dt, input);
    this.updateAI(dt);
    this.updatePlayers(dt, input);
    this.updateBall(dt);
    this.updateClock(dt);
    if (this.phase === 'live' || this.phase === 'dead') this.updateTakeovers(dt);
  }

  updateClock(dt) {
    if (this.phase === 'ft') return;
    if (this.clock <= 0 && !this.buzzer && (this.phase === 'live' || this.phase === 'dead')) this.buzzer = true; // watchdog
    if (this.phase === 'live' || this.phase === 'dead') {
      if (this.clock > 0) {
        this.clock -= dt;
        if (this.clock <= 0) {
          this.clock = 0;
          this.emit('buzzer', {});
          this.buzzer = true;
        }
      }
      // End the period once any shot in the air at the buzzer has resolved
      if (this.buzzer && this.clock <= 0 && this.ball.state !== 'shot' && this.ball.state !== 'net' && this.phase !== 'break') {
        this.endQuarter();
        return;
      }
    }
    if (this.phase === 'live' && this.ball.state !== 'shot' && this.ball.state !== 'loose' && this.clock > 0) {
      this.shotClock -= dt;
      if (this.shotClock <= 0) {
        this.emit('whistle', { text: 'SHOT CLOCK VIOLATION' });
        const h = this.ball.holder;
        if (h) { h.stats.tov++; if (h.isUser) this.addGrade(-2, 'Shot clock violation'); }
        this.inbound(1 - this.offense, 1.4, this.sidelineSpot(this.ball.pos));
      }
    }
  }

  // Buzzer: whistle, the ball handler drops the ball, everyone pulls up. Then the real break.
  endQuarter() {
    if (this.phase === 'ending' || this.phase === 'break' || this.phase === 'over') return;
    this.buzzer = false;
    this.inb = null;
    this.pending = null;
    this.phase = 'ending';
    this.endT = 2.2;
    const b = this.ball;
    if (b.holder) {
      const h = b.holder;
      const from = b.vis || { x: h.pos.x, y: 3.5, z: h.pos.z };
      b.pos = { ...from };
      b.vel = { x: h.vel.x * 0.3 + rand(-2, 2), y: 3, z: h.vel.z * 0.3 + rand(-2, 2) };
    }
    for (const p of this.players) {
      p.hasBall = false; p.post = false; p.screen = null; p.inbounding = false; p.aiTarget = null; p.driveT = 0;
      p.released = true; p.blockQueued = undefined; // the buzzer cancels any shot still being gathered
    }
    b.holder = null;
    b.state = 'dead';
    this.emit('whistle', { text: this.quarter >= 4 && this.score[0] !== this.score[1] ? 'FINAL' : 'END OF QUARTER' });
  }

  finishQuarter() {
    this.inb = null;
    this.phase = 'break';
    this.pending = null;
    for (const p of this.players) { p.action = null; p.y = 0; p.vy = 0; }
    const over = this.quarter >= 4 && this.score[0] !== this.score[1];
    if (over) { this.phase = 'over'; this.emit('gameOver', {}); }
    else this.emit('quarterEnd', { quarter: this.quarter });
  }

  nextQuarter() {
    this.quarter++;
    this.clock = this.quarter > 4 ? Math.max(60, this.qLen * 0.5) : this.qLen;
    const team = this.quarter % 2 === 0 ? 1 - this.possStart : this.possStart;
    this.formation(team);
    this.phase = 'dead';
    this.pending = { t: 1.0, fn: () => { this.phase = 'live'; } };
  }

  // ---------- user input ----------
  handleInput(dt, input) {
    const u = this.user;
    if (!u || u.benched) return;
    u.callT = Math.max(0, (u.callT || 0) - dt);
    u.lobCall = Math.max(0, (u.lobCall || 0) - dt);
    u.boxing = false; u.intenseD = false; u.defAssistHeld = false;
    if (this.phase !== 'live') return;
    const busy = u.action && !['stumble', 'shotfollow', 'celebrate'].includes(u.action);
    const onO = this.offense === u.team;

    if (u.hasBall && this.ball.state === 'held') {
      if (input.postPressed && !busy) {
        if (u.post) u.post = false;
        else if (this.distHoop(u) < 17) { u.post = true; u.holding = false; this.emit('call', { text: 'POSTING UP' }); }
        else this.emit('call', { text: 'TOO FAR TO POST UP' });
      }
      // Dribble combos: a swipe during a move is buffered and chains out of it near the end of the move
      if (input.gesture && u.y === 0) {
        if (!busy) this.dribbleMove(u, input.gesture);
        else if (this.isMove(u.action)) u.queuedMove = { g: input.gesture, t: this.time };
      }
      if (u.queuedMove) {
        const q = u.queuedMove;
        if (this.time - q.t > 0.55 || !u.hasBall) u.queuedMove = null;
        else if (!u.action || (this.isMove(u.action) && u.actionT >= u.actionDur * 0.6)) { u.queuedMove = null; this.dribbleMove(u, q.g, true); }
      }
      // Remember a SHOOT press for a moment so it isn't lost while a move or bump finishes
      if (input.shootPressed) u.shootBuf = this.time + 0.4;
      if (u.shootBuf > this.time && (input.shootHeld || input.shootPressed) && (!busy || this.isMove(u.action)) && u.y === 0) { u.shootBuf = 0; this.userShoot(u, input); }
      if (input.passPressed && (!busy || this.isMove(u.action)) && u.hasBall) {
        const t = this.pickPassTarget(u, input.move);
        if (t) this.startPass(u, t);
      }
      if (input.lobPressed && (!busy || this.isMove(u.action)) && u.hasBall) {
        const t = this.pickPassTarget(u, input.move, true);
        if (t) this.startPass(u, t, this.distHoop(t) < 20 ? { lob: true } : { float: true });
      }
      if (input.pickPressed && !busy) this.callScreen(u);
    } else if (onO) {
      if (input.passPressed) { u.callT = 1.6; this.emit('call', { text: 'CALLING FOR THE BALL' }); }
      if (input.shootPressed) {
        if (this.distHoop(u) < 24) { u.lobCall = 1.6; this.emit('call', { text: 'ALLEY-OOP CALLED' }); }
        else { u.callT = 1.6; this.emit('call', { text: 'CALLING FOR THE BALL' }); }
      }
      if (input.callScreenPressed) this.callScreen(u);
      if (input.setScreenPressed) {
        const h = this.ball.holder;
        if (h && h !== u && h.team === u.team) this.startScreen(u, h);
        else this.emit('call', { text: 'NO BALL HANDLER TO SCREEN FOR' });
      }
    } else {
      // Defense
      if (input.passPressed && !busy && u.y === 0) this.userSteal(u);
      if (input.shootPressed && !busy && u.y === 0) {
        this.startBlock(u, this.ball.state === 'loose' || this.ball.state === 'shot');
      }
      u.boxing = !!input.boxOut;
      if (!u.boxing) u.boxTarget = null;
      u.defAssistHeld = !!(input.defAssist || input.boxOut);
      u.intenseD = !!input.intense;
    }
  }

  // ---------- screens ----------
  callScreen(forP) {
    const cands = this.teamPlayers(forP.team).filter(q => q !== forP && !q.isUser && !q.screen && !q.hasBall);
    if (!cands.length) return;
    const score = q => len(q.pos.x - forP.pos.x, q.pos.z - forP.pos.z) - (q.slot >= 3 ? 10 : 0);
    cands.sort((a, b) => score(a) - score(b));
    this.startScreen(cands[0], forP);
    if (forP.isUser) this.emit('call', { text: 'SCREEN CALLED' });
  }

  startScreen(p, forP) {
    p.screen = { for: forP, state: 'go', t: 0 };
    if (p.isUser) this.emit('call', { text: 'SETTING A SCREEN' });
  }

  // Returns a movement target while a player is running to / holding a screen.
  updateScreen(p, dt) {
    const S = p.screen;
    S.t += dt;
    const f = S.for, def = this.matchup(f);
    if (this.phase !== 'live' || this.offense !== p.team || !def || p.hasBall) { p.screen = null; return null; }
    if (S.state === 'go') {
      if (S.t > 3.5) { p.screen = null; return null; }
      const dx = p.pos.x - def.pos.x, dz = p.pos.z - def.pos.z, l = len(dx, dz) || 1;
      const spot = { x: def.pos.x + dx / l * 2.3, z: def.pos.z + dz / l * 2.3 };
      if (len(spot.x - p.pos.x, spot.z - p.pos.z) < 1.5) {
        S.state = 'set'; S.t = 0;
        this.setAction(p, 'screen', 1.3);
        p.vel.x = p.vel.z = 0;
        if (!f.isUser && f.hasBall) f.driveT = Math.max(f.driveT || 0, 1.4);
        this.emit('screenSet', { p, for: f });
        return null;
      }
      return { x: spot.x, z: spot.z, sprint: true };
    }
    if (S.t > 1.3) {
      p.screen = null;
      // Roll to the rim after the screen
      if (p.isUser) p.callT = 1.8;
      else if (this.laneBusy(p)) { p.spot = [21, (p.pos.z >= 0 ? 1 : -1) * 10]; p.spotT = 2.5; } // pop instead of rolling into traffic
      else { p.spot = [5, 0]; p.spotT = 1.5; }
      return null;
    }
    return { x: p.pos.x, z: p.pos.z, sprint: false };
  }

  isMove(a) { return a === 'cross' || a === 'behind' || a === 'btl' || a === 'hesi' || a === 'stepback' || a === 'spin' || a === 'dropstep' || a === 'postspin' || a === 'shimmy'; }

  userShoot(u, input) {
    const dh = this.distHoop(u);
    if (u.post && dh > 17) u.post = false; // walked out of the post: a normal jumper
    if (u.post) {
      // Default: turnaround fadeaway. Hold the stick toward the rim for a hook.
      const h = this.hoopOf(u.team), hx = h.x - u.pos.x, hz = h.z - u.pos.z, hl = len(hx, hz) || 1;
      const m = input.move, ml = len(m.x, m.z);
      const toward = ml > 0.3 ? (m.x * hx + m.z * hz) / (ml * hl) : 0;
      this.startJumper(u, false, toward > 0.5 && dh < 12 ? 'hook' : 'fade', true);
      return;
    }
    if (u.fadeReady && this.time - u.fadeReady < 0.8 && dh > 8) { this.startJumper(u, false, 'fade'); return; }
    const spd = len(u.vel.x, u.vel.z);
    const h = this.hoopOf(u.team);
    // Stick pulled away from the rim as you shoot: fadeaway
    const sm = input.move || { x: 0, z: 0 }, sml = len(sm.x, sm.z);
    if (dh > 8 && sml > 0.5 && ((h.x - u.pos.x) * sm.x + (h.z - u.pos.z) * sm.z) / (dh * sml) < -0.6) { this.startJumper(u, false, 'fade'); return; }
    const toward = ((h.x - u.pos.x) * u.vel.x + (h.z - u.pos.z) * u.vel.z) / (dh * Math.max(1, spd));
    const canDunk = this.canDunk(u);
    const dr = this.dunkRange(u);
    const attacking = spd > 7 && toward > 0.35;
    if (dh < 6.5 || (dh < 13 && spd > 9 && toward > 0.4) || (canDunk && attacking && dh < dr)) {
      // Sprinting at the rim with a dunker always throws it down; otherwise it's usually a dunk too
      const inRange = dh < (attacking ? dr : 6.5);
      const type = canDunk && inRange && (input.sprint || chance(0.6 + u.r.dunk / 250)) ? 'dunk' : 'layup';
      this.startFinish(u, type);
      // Layups use the shot meter (dunks don't)
      if (type === 'layup') { u.meterOn = true; u.meter = 0; this.emit('meterStart', { p: u }); }
    } else this.startJumper(u);
  }

  userSteal(u) {
    this.setAction(u, 'steal', 0.38);
    const h = this.ball.holder;
    if (!h || this.ball.state !== 'held' || h.team === u.team) return;
    const d = len(h.pos.x - u.pos.x, h.pos.z - u.pos.z);
    if (d > 5.2) return;
    let p = 0.2 + (u.r.steal - h.r.handle) / 170 + (u.intenseD ? 0.05 : 0) + this.bt(u, 'interceptor') * 0.03 + (this.toIs(u, 'lockdown') ? 0.12 : 0);
    if (h.holding) p -= 0.08;
    if (this.isMove(h.action)) p -= 0.1;
    if (h.y > 0) p -= 0.15;
    p = clamp(p, 0.04, 0.5);
    if (chance(p)) this.stealSuccess(u, h);
    else if (d < 3.6 && chance(0.13)) this.foul(u, h, false);
  }

  stealSuccess(def, h) {
    h.stats.tov++; def.stats.stl++; this.bc(def, 'interceptor');
    this.toGain(def, 0.18, 'lockdown'); this.toGain(h, -0.08); this.goatHit(def, 'defense');
    if (h.isUser) this.addGrade(-3, 'Turnover');
    if (def.isUser) this.addGrade(2.5, 'Steal');
    this.emit('steal', { def, h });
    // Pop the ball loose toward the defender
    const b = this.ball;
    h.hasBall = false;
    b.state = 'loose'; b.holder = null; b.lastTouch = def.team;
    b.pos = { x: h.pos.x, y: 2.5, z: h.pos.z };
    const dx = def.pos.x - h.pos.x, dz = def.pos.z - h.pos.z, l = len(dx, dz) || 1;
    b.vel = { x: dx / l * 9, y: 4, z: dz / l * 9 };
    b.stealer = def; b.stealT = 0.5;
    b.noGrab = { p: h, until: this.time + 0.45, all: this.time + 0.05 };
  }

  // Heated games (rivalries, the Finals): a hard play can turn into a shoving match. Both get a technical.
  maybeScuffle(a, b, base = 0.25) {
    if (!a || !b || a.team === b.team || this.intensity < 0.35 || this.time - this.lastScuffle < 45 || !chance(this.intensity * base)) return;
    this.lastScuffle = this.time;
    this.knock(a, b.pos, 4, 'bump', 0.6); this.knock(b, a.pos, 4, 'bump', 0.6);
    a.stats.pf++; b.stats.pf++;
    this.emit('scuffle', { a, b });
  }
  foul(def, off, shooting, made = false, pts = 2) {
    if (shooting) this.maybeScuffle(off, def, 0.2);
    def.stats.pf++;
    this.teamFouls[def.team]++;
    if (def.isUser) this.addGrade(-1, 'Foul');
    this.emit('whistle', { text: shooting ? (made ? 'AND ONE!' : 'SHOOTING FOUL') : 'REACH-IN FOUL', foul: true });
    if (shooting) {
      this.ftQueue = { shooter: off, n: made ? 1 : pts, done: 0, made: 0 };
      this.pending = { t: made ? 1.4 : 1.0, fn: () => this.setupFT() };
    } else {
      this.knock(off, def.pos, 4, 'bump', 0.4);
      this.inbound(off.team, 1.0, this.sidelineSpot(off.pos));
    }
  }

  // ---------- free throws ----------
  setupFT() {
    const q = this.ftQueue;
    const s = q.shooter;
    const d = this.dir(s.team);
    this.phase = 'ft';
    this.inb = null;
    this.offense = s.team;
    const lane = [[-d * 0 + d * (HOOP_X - 7), 6.5], [d * (HOOP_X - 7), -6.5], [d * (HOOP_X - 10), 6.5], [d * (HOOP_X - 10), -6.5], [d * (HOOP_X - 13), 6.5], [d * (HOOP_X - 13), -6.5], [d * 18, 10], [d * 18, -10], [d * 20, 0]];
    let li = 0;
    for (const p of this.players) {
      p.vel.x = p.vel.z = 0; p.action = null; p.y = 0; p.vy = 0; p.hasBall = false;
      if (p === s) { p.pos = { x: d * (HOOP_X - 13.75), z: 0 }; p.facing = angTo(d, 0); continue; }
      // Defenders take inside lane spots
      const spot = lane[li++] || [d * 15, 0];
      p.pos = { x: spot[0], z: spot[1] };
      p.facing = angTo(Math.sign(-spot[1]) * 0.3 + 0, Math.sign(-spot[1]) || 1);
    }
    this.giveBall(s, true);
    s.ftWait = 0;
    this.emit('ft', { shooter: s, n: q.n, i: q.done });
  }

  updateFT(dt, input) {
    const q = this.ftQueue;
    if (!q) return;
    const s = q.shooter;
    if (s.hasBall && !s.action) {
      s.ftWait += dt;
      if (s.isUser) {
        if (input.shootPressed) this.startJumper(s, true);
      } else if (s.ftWait > 1.2) this.startJumper(s, true);
    }
  }

  ftResult(made) {
    const q = this.ftQueue;
    const s = q.shooter;
    q.done++;
    s.stats.fta++;
    if (made) { s.stats.ftm++; s.stats.pts++; this.score[s.team]++; q.made++; }
    if (q.done < q.n) {
      this.pending = { t: 1.0, fn: () => { this.giveBall(s, true); s.ftWait = 0; this.emit('ft', { shooter: s, n: q.n, i: q.done }); } };
    } else {
      this.ftQueue = null;
      if (made) this.inbound(1 - s.team, 1.0);
      else this.phase = 'live'; // live rebound
    }
  }

  // ---------- dribble moves ----------
  dribbleMove(p, gesture, chained = false) {
    if (!chained && this.time - (p.lastMove || -9) < this.style.cooldown) return;
    p.moveVin = { x: p.vel.x, z: p.vel.z }; // the next move flows out of the last one's momentum
    if (p.post) { this.postMove(p, gesture); return; }
    const h = this.hoopOf(p.team);
    let hx = h.x - p.pos.x, hz = h.z - p.pos.z; const hl = len(hx, hz) || 1; hx /= hl; hz /= hl;
    let kind, dx = gesture.x, dz = gesture.z;
    const dl = len(dx, dz) || 1; dx /= dl; dz /= dl;
    const along = dx * hx + dz * hz;
    // Driving into the paint: stick left/right = euro step to that side, stick up = floater
    if (gesture.type === 'swipe' && p.hasBall && !p.holding) {
      const dh0 = this.distHoop(p), sp0 = len(p.vel.x, p.vel.z);
      const toward0 = ((h.x - p.pos.x) * p.vel.x + (h.z - p.pos.z) * p.vel.z) / ((dh0 || 1) * Math.max(1, sp0));
      if (dh0 < 17 && dh0 > 4 && sp0 > 6.5 && toward0 > 0.35) {
        if (along > 0.55 && dh0 > 5.5) { this.startFloater(p); return; }
        if (Math.abs(along) < 0.6) { this.startEuro(p, (hx * dz - hz * dx) > 0 ? 1 : -1); return; }
      }
    }
    if (gesture.type === 'double') {
      // No spin spam: one spin, then it has to cool down (and a spin can't chain straight into another)
      if (this.time - (p.lastSpin || -9) < 1.3 || p.action === 'spin') return;
      kind = 'spin'; dx = hx; dz = hz; p.lastSpin = this.time;
    }
    else if (along > 0.65) kind = 'hesi';
    else if (along < -0.6) kind = 'stepback';
    else {
      const r = Math.random();
      const flashy = this.style === DRIBBLE_STYLES.flashy;
      kind = flashy ? (r < 0.45 ? 'behind' : r < 0.8 ? 'btl' : 'cross') : (r < 0.55 ? 'cross' : r < 0.85 ? 'btl' : 'behind');
    }
    // Lateral side for animation twist
    const cross = hx * dz - hz * dx;
    p.moveDir = cross > 0 ? 1 : -1;
    const dur = kind === 'spin' ? 0.46 : kind === 'stepback' ? 0.4 : kind === 'hesi' ? 0.42 : kind === 'behind' ? 0.38 : 0.34;
    this.setAction(p, kind, dur);
    p.holding = false;
    if (kind !== 'hesi' && kind !== 'stepback') p.dribbleHand = p.dribbleHand === 'R' ? 'L' : 'R';
    const burst = this.style.burst * (0.8 + p.r.handle / 250 + p.r.speed / 400);
    const sp = { cross: 15, behind: 15, btl: 13, spin: 13, hesi: 9, stepback: 13 }[kind] * burst;
    p.moveVel = { x: dx * sp, z: dz * sp };
    if (kind === 'spin') {
      // spin rolls laterally around the defender then toward the hoop
      p.moveVel = { x: (hx + -hz * p.moveDir * 0.9) * sp, z: (hz + hx * p.moveDir * 0.9) * sp };
    }
    if (kind === 'stepback') { p.stepbackT = this.time; p.moveVel = { x: -hx * sp, z: -hz * sp }; }
    p.lastMove = this.time;
    if (this.time - this.lastMoveT < 1.0 && p.isUser) this.moveCombo++; else this.moveCombo = 0;
    if (p.isUser) this.lastMoveT = this.time;
    p.energy = Math.max(0, p.energy - 3);
    this.emit('move', { kind, p });

    // Effect on the on-ball defender
    const { q: def, d } = this.nearestDefender(p);
    if (def && d < 7.5 && def.stun <= 0 && def.y === 0) {
      const toDx = def.pos.x - p.pos.x, toDz = def.pos.z - p.pos.z;
      const inFront = (toDx * hx + toDz * hz) / (d || 1) > -0.2;
      if (inFront) {
        let s = 0.3 + (p.r.handle - def.r.perD) / 110 + (this.style.ankle - 1) * 0.12 + Math.min(this.moveCombo, 3) * 0.07;
        if (kind === 'hesi') s -= 0.06;
        if (kind === 'spin' || kind === 'behind' || kind === 'btl') s += 0.04;
        if (def.isUser) s -= 0.08;
        if (def.intenseD) s -= 0.06;
        if (!p.isUser) s -= 0.08;
        if (this.repeatKind === kind) s -= 0.08;
        this.repeatKind = kind;
        s += this.bt(p, 'ankleBreaker') * 0.03 - this.bt(def, 'clamps') * 0.03;
        if (this.toIs(p, 'playmaking')) s += 0.12;
        if (this.toIs(def, 'lockdown')) s -= 0.12;
        s = clamp(s, 0.06, 0.85);
        if (chance(s)) {
          const ankle = chance(s * 0.2 * this.style.ankle * (1 + this.bt(p, 'ankleBreaker') * 0.25) * (this.toIs(p, 'playmaking') ? 1.7 : 1));
          if (ankle) {
            this.setAction(def, 'fall', 1.7); def.stun = 1.7; def.fallVar = chance(0.5) ? 1 : 0;
            if (p.isUser) this.addGrade(1.5, 'Ankle breaker');
            this.emit('ankle', { p, def }); this.bc(p, 'ankleBreaker', 3);
            this.toGain(p, 0.15, 'playmaking'); this.toGain(def, -0.06);
          } else {
            this.setAction(def, 'stumble', 0.7); def.stun = 0.7;
            this.emit('beat', { p, def }); this.bc(p, 'ankleBreaker'); this.toGain(p, 0.04, 'playmaking');
          }
        }
      }
    }
    if (this.style.risk && chance(this.style.risk) && p.isUser) {
      this.emit('whistle', { text: 'LOST THE HANDLE' });
      const def2 = this.nearestDefender(p).q;
      this.stealSuccess(def2, p);
    }
  }

  // ---------- post game ----------
  postMove(p, gesture) {
    const h = this.hoopOf(p.team);
    let hx = h.x - p.pos.x, hz = h.z - p.pos.z; const hl = len(hx, hz) || 1; hx /= hl; hz /= hl;
    let dx = gesture.x, dz = gesture.z; const dl = len(dx, dz) || 1; dx /= dl; dz /= dl;
    const along = dx * hx + dz * hz;
    const side = (hx * dz - hz * dx) > 0 ? 1 : -1;
    let kind;
    if (gesture.type === 'double') kind = 'postspin';
    else if (along < -0.5) kind = 'shimmy';
    else kind = 'dropstep';
    p.moveDir = side;
    this.setAction(p, kind, kind === 'shimmy' ? 0.38 : 0.5);
    p.lastMove = this.time;
    const lat = { x: -hz * side, z: hx * side };
    if (kind === 'dropstep') p.moveVel = { x: (lat.x * 0.9 + hx * 0.8) * 12, z: (lat.z * 0.9 + hz * 0.8) * 12 };
    else if (kind === 'postspin') p.moveVel = { x: (-lat.x * 0.9 + hx * 0.8) * 12, z: (-lat.z * 0.9 + hz * 0.8) * 12 };
    else { p.moveVel = { x: -hx * 5, z: -hz * 5 }; p.fadeReady = this.time; }
    if (kind !== 'shimmy') { p.post = false; p.dribbleHand = side > 0 ? 'L' : 'R'; }
    this.emit('move', { kind, p });
    const { q: def, d } = this.nearestDefender(p);
    if (def && d < 6 && def.stun <= 0) {
      let s = 0.32 + (p.r.strength * 0.4 + p.r.close * 0.6 - def.r.intD) / 90 + (kind === 'shimmy' ? -0.1 : 0);
      if (!p.isUser) s -= 0.08;
      if (def.isUser) s -= 0.08;
      if (chance(clamp(s, 0.08, 0.8))) {
        this.setAction(def, 'stumble', kind === 'shimmy' ? 0.5 : 0.75); def.stun = kind === 'shimmy' ? 0.5 : 0.75;
        if (kind === 'shimmy') def.vy = 9; // bit on the fake
        this.emit('beat', { p, def });
      }
    }
  }

  // Backing down: push toward the rim, the defender gets moved based on strength.
  backDown(p, desX, desZ, dt) {
    const h = this.hoopOf(p.team);
    let hx = h.x - p.pos.x, hz = h.z - p.pos.z; const hl = len(hx, hz) || 1; hx /= hl; hz /= hl;
    const dl = len(desX, desZ);
    let vx = desX * 0.4, vz = desZ * 0.4;
    const { q: def, d } = this.nearestDefender(p);
    const toward = dl > 1 ? (desX * hx + desZ * hz) / dl : 0;
    if (def && d < 4 && toward > 0.3 && def.stun <= 0 && (!def.action || def.action === 'bump')) {
      // Every step is a shove: the ball handler drives a shoulder into the defender and knocks him back
      const power = clamp(0.55 + (p.r.strength - def.r.strength) / 70, 0.15, 1.2) * (1 + this.bt(p, 'bully') * 0.12);
      const creep = power * 2.2;
      vx = hx * creep; vz = hz * creep;
      def.pos.x += hx * creep * dt; def.pos.z += hz * creep * dt;
      p.bumpT = (p.bumpT || 0) - dt;
      if (p.bumpT <= 0) {
        p.bumpT = 0.85; p.bumpAt = this.time;
        def.push.x += hx * power * 8; def.push.z += hz * power * 8;
        p.push.x += hx * power * 4; p.push.z += hz * power * 4;
        this.setAction(def, 'bump', 0.35);
        def.hitDir = { x: hx, z: hz };
        this.emit('contact', { p, power: 3, post: true });
        this.bc(p, 'bully', 0.25);
      }
    }
    return { x: vx, z: vz };
  }

  // ---------- shooting ----------
  startJumper(p, ft = false, style = null, fromPost = false) {
    // The animation always outlasts the longest possible meter so the ball can't get stuck in the hands
    this.setAction(p, 'shoot', Math.max(1.15, this.js.fill * (ft ? 1.1 : 1) * 1.45 + 0.15));
    // Shooting on the move: the shot comes out of how you're moving. Heading away from the rim is a running
    // fadeaway, sideways is a drifting jumper (shoulders square, body carrying across), attacking is a pull-up.
    const spd0 = len(p.vel.x, p.vel.z);
    p.shotVel = null; p.driftSide = 0; p.takeoffVel = null;
    const cs0 = ft ? { side: 0 } : this.contactSideOf(p, 4.5);
    p.contestSide = cs0.side ? -cs0.side : 0; // lean away from him
    if (!ft && !fromPost && spd0 > 6 && (!style || style === 'fade')) {
      const h = this.hoopOf(p.team), hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
      const along = (p.vel.x * hx + p.vel.z * hz) / (hl * spd0);
      if (!style) style = along > 0.55 ? 'pullup' : along < -0.45 ? 'fade' : 'drift';
      p.shotVel = { x: p.vel.x, z: p.vel.z };
      // Which way the drift carries, from the shooter's point of view facing the rim (+1 = to their left)
      const lat = (p.vel.x * (hz / hl) - p.vel.z * (hx / hl)) / spd0;
      p.driftSide = Math.max(-1, Math.min(1, lat * Math.min(1, spd0 / 12)));
    }
    p.shotStyle = style;
    p.turnaround = fromPost && style === 'fade';
    if (p.turnaround) {
      const h = this.hoopOf(p.team);
      p.turnSide = chance(0.5) ? 1 : -1;
      p.facing = angTo(h.x - p.pos.x, h.z - p.pos.z);
    }
    p.post = false;
    p.shotId = ++this.shotSeq;
    p.meter = 0; p.ft = ft;
    p.shotSpeed = len(p.vel.x, p.vel.z);
    p.holding = false;
    // Motion: load the ball above the head, dip, jump, release. Timed so the top of the jump is exactly
    // where the meter fills (meter = 1), i.e. the green is at the top of the jump.
    p.shotVy = ft ? 4 : (style === 'fade' ? 10.5 : 9) + p.r.vert * 0.03;
    p.jumpAt = Math.max(ft ? 0.3 : 0.2, this.js.fill * (ft ? 1.1 : 1) - p.shotVy / G_PLAYER);
    // AI release timing
    if (!p.isUser) {
      const rating = this.shotRating(p);
      const sigma = (0.3 - rating / 99 * 0.2) * (this.toIs(p, 'shooting') ? 0.6 : 1);
      p.aiRelease = 1 + gauss() * sigma;
    }
    if (!ft) {
      // Defenders react to the shot
      for (const q of this.players) {
        if (q.team === p.team || q.isUser || q.stun > 0) continue;
        const d = len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
        if (d < 5.5 && chance(0.25 + q.r.block / 200)) q.blockQueued = rand(0.08, 0.2);
      }
    }
    if (!ft) this.closeOut(p, 13);
    if (p.isUser) this.emit('meterStart', { p });
  }

  shotRating(p) {
    if (p.action === 'layup') return p.r.layup;
    if (p.ft) return p.r.ft;
    if (p.shotStyle === 'hook') return p.r.close * 0.75 + p.r.strength * 0.25;
    return this.is3(p.pos.x, p.pos.z, p.team) ? p.r.three : p.r.mid;
  }

  // How hard the shot is right now (1 = open and set, smaller = contested / deep / off the dribble).
  shotDifficulty(p) {
    const c = this.contestOf(p).c * (p.shotStyle === 'fade' ? lerp(0.6, 1, clamp((this.distHoop(p) - 14) / 8, 0, 1)) : p.shotStyle === 'hook' ? 0.65 : p.shotStyle === 'drift' ? 0.85 : 1);
    let f = 1 - 0.7 * c;
    const dh = this.distHoop(p);
    if (dh > 26) f *= Math.max(0.25, 1 - (dh - 26) * 0.12);
    if (p.shotSpeed > 12 && !(p.stepbackT && this.time - p.stepbackT < 0.7)) f *= 0.7;
    return clamp(f, 0.15, 1);
  }

  // Defenders near a shooter sprint at him with a hand up
  closeOut(p, range) {
    const h = this.hoopOf(p.team);
    for (const q of this.players) {
      if (q.team === p.team || q.isUser || q.benched || q.stun > 0) continue;
      const d = len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
      if (d > range) continue;
      if (q !== this.matchup(p) && d > 8) continue;
      q.closeOn = p; q.closeT = this.time + 1.0;
    }
    void h;
  }

  meterWindow(p) {
    const rating = this.shotRating(p);
    const diffMult = [1.5, 1.2, 1.0, 0.8][this.diff];
    let w = (0.05 + rating / 99 * 0.06) * this.js.window * diffMult * (this.opts.greenBoost || 1);
    if (p.action === 'layup') w *= 1.3;
    if (!p.ft) w *= this.shotDifficulty(p) * this.greenRange(p);
    if (p.catchT && this.time - p.catchT < 1.6) w *= 1 + this.bt(p, 'catchShoot') * 0.08;
    if ((p.shotStyle === 'fade' || p.shotStyle === 'hook') && this.distHoop(p) < 20) w *= 1 + this.bt(p, 'fadeAce') * 0.08;
    w *= 1 + this.bt(p, 'greenMachine') * 0.06 * Math.min(this.greenStreak, 3);
    if (p.isUser) w *= 1 - this.heat * 0.3;
    if (this.toIs(p, 'shooting')) w *= 1.6;
    // Post fades and hooks are a skill: tiny window for low ratings, normal for good post scorers
    if (p.shotStyle === 'fade' || p.shotStyle === 'hook') w *= clamp((rating - 35) / 50, 0.2, 1);
    return w > 0 ? Math.max(p.shotStyle === 'fade' || p.shotStyle === 'hook' ? 0.006 : 0.012, w) : 0;
  }
  // No greens from way downtown: the window closes over a few feet past the player's range
  greenRange(p) {
    if (p.action === 'layup') return 1;
    const range = 27 + clamp((this.shotRating(p) - 70) / 29, 0, 1) * 4 + (this.toIs(p, 'shooting') ? 4 : 0);
    return clamp(1 - (this.distHoop(p) - range) / 4, 0, 1);
  }

  releaseJumper(p) {
    p.released = true;
    const t = p.meter;
    const err = t - 1;
    const rating = this.shotRating(p);
    const w = p.isUser ? this.meterWindow(p) : (0.05 + rating / 99 * 0.06) * this.js.window * (this.toIs(p, 'shooting') ? 1.6 : 1) * (p.shotStyle === 'fade' || p.shotStyle === 'hook' ? clamp((rating - 35) / 50, 0.2, 1) : 1);
    let q;
    const ae = Math.abs(err);
    if (w > 0 && ae <= w) q = 'perfect';
    else if (ae <= Math.max(w * 2.4, 0.1)) q = 'good';
    else if (ae <= 0.35) q = err < 0 ? 'early' : 'late';
    else q = err < 0 ? 'very early' : 'very late';
    if (p.isUser && !p.ft) { if (q === 'perfect') { this.greenStreak++; this.bc(p, 'greenMachine'); } else this.greenStreak = 0; }
    if (p.isUser) this.emit('release', { q, err, w });
    this.resolveShot(p, p.ft ? 'ft' : 'jumper', q);
  }

  releaseLayup(p) {
    p.released = true;
    const err = p.meter - 1, ae = Math.abs(err), w = this.meterWindow(p);
    let q;
    if (ae <= w) q = 'perfect';
    else if (ae <= w * 2.4) q = 'good';
    else if (ae <= 0.35) q = err < 0 ? 'early' : 'late';
    else q = err < 0 ? 'very early' : 'very late';
    this.emit('release', { q, err, w });
    this.resolveShot(p, 'layup', q);
  }

  // Dunk tiers: 65 basic dunks, 70 hanging, 75 slight contact, 85 contact (knockdowns), 90+ elite contact
  canDunk(p) { return p.r.dunk >= 65 && p.r.vert + p.r.strength * 0.4 >= 70; }
  // How far out a player can take off for a dunk on the move (feet from the rim)
  dunkRange(p) {
    return 11.5 + clamp((p.r.dunk - 55) / 40, 0, 1) * 4 + clamp((p.r.vert - 55) / 40, 0, 1) * 3 + (p.heightFt - 6.5) * 0.8 + (this.toIs(p, 'finishing') ? 1.5 : 0);
  }
  // Dunk jump: rise until the hand clears the rim, higher for bouncier players and flashy dunks
  dunkApex(p, flashy) {
    const need = RIM_Y + 1.0 - reachOf(p.heightFt);
    const over = p.dunkStyle === 'contact' && p.contactVar === 1 ? 0.75 : 0; // jumping over the defender
    return Math.max(3.0, need) + clamp((p.r.vert - 55) / 40, 0, 1) * 0.9 + (flashy ? 0.6 : 0) + over;
  }

  // Better dunkers unlock more dunk styles
  pickDunk(p) {
    const pkg = (p.anim && p.anim.dunkPkg) || 'standard';
    const r = p.r.dunk, a = p.anim || {}, fin = this.toIs(p, 'finishing');
    // Dunk package (equipped animation): power, high flyer, posterizer or the elite everything package
    const flair = fin || pkg === 'flyer' || pkg === 'elite' ? 1 : pkg === 'power' ? 0 : a.dunkFlair || 0;
    const pw = pkg === 'power' ? 1 : pkg === 'flyer' ? 0 : a.power || 0;
    const posterBoost = pkg === 'poster' ? 0.25 : pkg === 'elite' ? 0.12 : 0;
    // Higher dunk ratings unlock flashier dunks; how a player dunks leans on their profile: high flyers
    // go flashy, bigs and strong builds go power (two hands, tomahawks, cock-backs)
    const pool = [['one', 3], ['two', 3 + pw * 5]];
    if (r >= 68) pool.push(['tomahawk', 2 + pw * 3], ['cockback', 2 + pw * 3]);
    if (r >= 75) pool.push(['reverse', 2], ['clutch', 1.5], ['leaner', 1.2]);
    if (r >= 82) pool.push(['windmill', 2], ['backscratch', 1.5]);
    // 90+: the super eccentric ones
    if (r >= 90) pool.push(['360', 1.5], ['btl', 1], ['cradle', 1.2], ['windmill2', 1.5]);
    if (r >= 94 && p.r.vert >= 85) pool.push(['360wm', 1.2]);
    for (const e of pool) if (FLASHY_DUNKS.includes(e[0]) || ['leaner', 'backscratch'].includes(e[0])) e[1] *= 0.5 + 2 * flair;
    // Going at a defender near the rim: contact dunk
    const h = this.hoopOf(p.team);
    // A defender between the dunker and the rim, near the basket
    const hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
    const def = this.players.find(q => {
      if (q.team === p.team || q.benched || q.stun > 0) return false;
      const qx = q.pos.x - p.pos.x, qz = q.pos.z - p.pos.z;
      const along = (qx * hx + qz * hz) / hl, perp = Math.abs(qx * hz - qz * hx) / hl;
      return len(q.pos.x - h.x, q.pos.z - h.z) < 8 && along > -1 && along < hl + 2 && perp < 4.5;
    });
    p.contactDef = null;
    // Contact tiers: 75 slight contact (through his arm, he just gets bumped), 85 contact dunks that put him on
    // the floor, 90+ elite: going over the top of him and stepping over
    p.contactLite = false;
    if (def && r >= 75 && chance(0.35 + (r - 75) / 70 + (fin ? 0.25 : 0) + posterBoost)) {
      if (r < 85) { p.contactVar = 2; p.contactLite = true; }
      else if (r < 90) p.contactVar = chance(0.5) ? 0 : 2;
      else p.contactVar = chance(0.45) ? 1 : chance(0.5) ? 0 : 2;
      p.contactDef = def; return 'contact';
    }
    if (def) for (const e of pool) if (FLASHY_DUNKS.includes(e[0])) e[1] *= 0.2;
    let tot = pool.reduce((a, e) => a + e[1], 0), x = Math.random() * tot;
    for (const [k, w] of pool) { x -= w; if (x <= 0) return k; }
    return 'two';
  }

  // Euro step: a short step one way, then a long step to the side you chose, then into the layup
  startEuro(p, side) {
    this.setAction(p, 'euro', 0.5);
    p.euroSide = side; p.holding = false; p.post = false;
    const h = this.hoopOf(p.team), hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
    p.euroDir = { x: hx / hl, z: hz / hl };
    this.emit('move', { kind: 'euro', p });
    // The on-ball defender bites on the first step
    const { q: def, d } = this.nearestDefender(p);
    if (def && d < 6 && def.stun <= 0 && def.y === 0 && chance(0.25 + (p.r.layup - def.r.perD) / 120 + (this.toIs(p, 'playmaking') ? 0.15 : 0))) {
      this.setAction(def, 'stumble', 0.6); def.stun = 0.6; this.emit('beat', { p, def });
    }
  }
  // Floater: one-handed, released early on the way up with a high arc over the rim protector
  startFloater(p) {
    this.startFinish(p, 'layup');
    p.layupStyle = 'floater';
    p.releaseAt = 0.36;
    const h = this.hoopOf(p.team), hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
    const go = Math.min(2.2, Math.max(0, hl - 5.5));
    p.finishPt = { x: p.pos.x + hx / hl * go, z: p.pos.z + hz / hl * go };
    if (p.isUser) { p.meterOn = true; p.meter = 0; this.emit('meterStart', { p }); }
  }

  // Defender right in front / on the hip as you go up: which side (+1 = on your left), or 0
  contactSideOf(p, range) {
    const { q, d } = this.nearestDefender(p);
    if (!q || d > range || q.stun > 0) return { side: 0, q: null };
    const fx = Math.sin(p.facing), fz = Math.cos(p.facing), lx = q.pos.x - p.pos.x, lz = q.pos.z - p.pos.z;
    if ((lx * fx + lz * fz) / (d || 1) < -0.3) return { side: 0, q: null }; // behind him
    return { side: (lx * fz - lz * fx) > 0 ? 1 : -1, q };
  }

  startFinish(p, type) {
    this.setAction(p, type, type === 'dunk' ? 1.1 : 0.8);
    p.layupStyle = null;
    const cs = type === 'layup' ? this.contactSideOf(p, 4) : { side: 0 };
    p.contactSide = cs.side; p.contactQ = cs.q;
    p.releaseAt = type === 'dunk' ? 0.64 : 0.44;
    p.meterOn = false;
    p.extraHops = false;
    p.jumpAtF = type === 'dunk' ? 0.28 : 0.22;
    p.shotId = ++this.shotSeq;
    p.holding = false;
    p.post = false;
    const h = this.hoopOf(p.team);
    if (type === 'dunk') {
      p.dunkStyle = this.pickDunk(p);
      // Flashy dunks need more air time
      p.extraHops = FLASHY_DUNKS.includes(p.dunkStyle);
      // Long gathers from further out; release at the top of the jump with the hand over the rim
      const dh = len(p.pos.x - h.x, p.pos.z - h.z);
      // Take off early on long approaches so the dunker flies in from further out
      p.jumpAtF = clamp(0.18 + (dh - 4) * 0.012, 0.18, 0.3);
      p.dunkVy = Math.sqrt(2 * G_PLAYER * this.dunkApex(p, p.extraHops));
      p.releaseAt = p.jumpAtF + p.dunkVy / G_PLAYER * 0.97;
      this.setAction(p, 'dunk', p.releaseAt + 0.36);
    }
    let dx = p.pos.x - h.x, dz = p.pos.z - h.z; const l = len(dx, dz) || 1;
    // Don't finish from behind the backboard
    if (Math.sign(dx) === this.dir(p.team) || Math.abs(dx) < 1) { dx = -this.dir(p.team) * 0.8; dz = dz / l; }
    const ll = len(dx, dz) || 1;
    const stand = type === 'dunk' ? 1.6 : 2.6;
    p.finishPt = { x: h.x + dx / ll * stand, z: h.z + dz / ll * stand };
    this.closeOut(p, 10);
    for (const q of this.players) {
      if (q.team === p.team || q.isUser || q.stun > 0) continue;
      const d = len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
      if (d < 8 && !this.isBehind(q, p) && chance(0.12 + q.r.block / 220)) q.blockQueued = rand(0.12, 0.3);
      // Trailing defender sprints in for the chase-down
      else if (d < 14 && this.isBehind(q, p) && len(q.vel.x, q.vel.z) > 9 && chance(0.12 + q.r.block / 300 + q.r.speed / 400)) {
        q.chase = { target: p, until: this.time + 1.0 };
        q.blockQueued = clamp(d / 30, 0.12, 0.42);
      }
    }
    // Contact dunk: the defender steps up in front of the rim and rises to meet it, so they collide in the air
    const cd = type === 'dunk' && p.dunkStyle === 'contact' ? p.contactDef : null;
    if (cd && !cd.isUser && cd.stun <= 0) {
      cd.meet = { x: h.x + dx / ll * 3.2, z: h.z + dz / ll * 3.2, until: this.time + p.releaseAt };
      if (p.contactVar === 1) { cd.duckUntil = this.time + p.releaseAt + 0.25; cd.blockQueued = undefined; }
      else cd.blockQueued = Math.max(0.05, p.releaseAt - 0.32);
    }
  }

  contestOf(p) {
    const h = this.hoopOf(p.team);
    let best = 0, bestQ = null;
    for (const q of this.players) {
      if (q.team === p.team || q.benched) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = len(dx, dz);
      if (d > 9) continue;
      const hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
      const front = (dx * hx + dz * hz) / ((d || 1) * hl);
      let c = clamp(1 - (d - 2) / 6.5, 0, 1) * (front > 0 ? 1 : 0.45);
      if (q.stun > 0) c *= 0.15;
      if (q.y > 0.5 || q.action === 'block') c = Math.min(1, c + 0.25);
      if (q.intenseD && d < 6) c = Math.min(1, c + 0.12);
      const dq = this.distHoop(p) < 10 ? q.r.intD : q.r.perD;
      c *= 0.7 + dq / 99 * 0.5;
      c += this.bt(q, 'clamps') * 0.04;
      if (this.toIs(q, 'lockdown')) c = Math.min(1, c + 0.15);
      if (c > best) { best = c; bestQ = q; }
    }
    if (p.isUser && bestQ) best *= 1 + this.heat * 0.3;
    return { c: Math.min(1, best), q: bestQ };
  }

  resolveShot(p, kind, quality = 'good') {
    if (this.phase === 'ending' || this.phase === 'break' || this.phase === 'over') return;
    const b = this.ball;
    const h = this.hoopOf(p.team);
    const dh = this.distHoop(p);
    const three = kind === 'jumper' && this.is3(p.pos.x, p.pos.z, p.team);
    const pts = kind === 'ft' ? 1 : three ? 3 : 2;
    const { c, q: nearest } = kind === 'ft' ? { c: 0 } : this.contestOf(p);
    // A contact dunk goes at the defender who rose to meet it
    const contester = kind === 'dunk' && p.dunkStyle === 'contact' && p.contactDef && !p.contactDef.benched ? p.contactDef : nearest;
    let prob;
    let c2 = c;
    if (p.shotStyle === 'hook') c2 = c * 0.65;
    if (p.shotStyle === 'fade') c2 = c * lerp(0.6, 1, clamp((dh - 14) / 8, 0, 1));
    if (p.shotStyle === 'drift') c2 = c * 0.85;
    if (this.toIs(p, 'shooting')) c2 *= 0.6;
    if (kind === 'jumper') c2 *= 1 - this.bt(p, 'deadeye') * 0.1;
    const catchShot = !!(p.catchT && this.time - p.catchT < 1.6) && kind === 'jumper' && (!p.shotStyle || p.shotStyle === 'pullup' || p.shotStyle === 'drift');
    if (kind === 'ft') prob = 0.3 + p.r.ft / 99 * 0.62;
    else if (kind === 'jumper' && p.shotStyle === 'hook') {
      const r = p.r.close * 0.75 + p.r.strength * 0.25;
      prob = (0.3 + r / 99 * 0.45 + (dh < 6 ? 0.05 : 0)) * (1 - 0.5 * c2);
    }
    else if (kind === 'dunk') {
      // A dunk is only bothered by someone actually challenging at the rim (close and off the floor),
      // not by every defender standing in the paint
      let dc = 0;
      for (const q of this.players) {
        if (q.team === p.team || q.benched || q.stun > 0) continue;
        const d = len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
        if (d > 5 || (q.y < 0.5 && q.action !== 'block')) continue;
        dc = Math.max(dc, clamp(1 - (d - 1.5) / 3.5, 0, 1) * (0.55 + q.r.block / 220));
      }
      if (this.toIs(p, 'finishing')) dc *= 0.5;
      const legs = clamp((p.r.vert + p.r.strength) / 2 - 50, 0, 40) / 400;
      prob = 0.88 + p.r.dunk / 99 * 0.1 + legs - dc * (0.32 - p.r.dunk / 99 * 0.12);
    }
    else if (kind === 'layup' && p.contactSide && p.contactQ) {
      // Contact layup: strength decides who gives ground. Stronger: he's knocked off you and the contest barely
      // matters; weaker: you get bumped off line
      const q = p.contactQ, edge = p.r.strength - q.r.strength + (this.toIs(p, 'finishing') ? 15 : 0);
      const absorb = clamp(0.5 + edge / 60, 0.1, 0.95);
      prob = (0.5 + p.r.layup / 99 * 0.42) * (1 - 0.45 * c * (1 - absorb));
      if (edge >= 6) { this.knock(q, p.pos, 3 + edge / 10, 'stumble', 0.5); q.stun = Math.max(q.stun, 0.4); }
      else p.hitT = Math.max(p.hitT, 0.35);
      this.emit('contact', { p, power: 3 });
    }
    else if (kind === 'layup' && p.layupStyle === 'floater') prob = (0.34 + p.r.close / 99 * 0.46) * (1 - 0.22 * c);
    else if (kind === 'layup') prob = (0.5 + p.r.layup / 99 * 0.42) * (1 - 0.4 * c * (this.toIs(p, 'finishing') ? 0.45 : 1) * (1 - this.bt(p, 'acrobat') * 0.12)) * (1 + this.bt(p, 'acrobat') * 0.03);
    else {
      let r = dh < 10 ? p.r.close : three ? p.r.three : p.r.mid;
      prob = three ? 0.15 + r / 99 * 0.45 : 0.22 + r / 99 * 0.48;
      if (dh < 10) prob += 0.08;
      if (dh > 27) prob -= (dh - 27) * 0.045;
      if (p.shotSpeed > 12 && !(p.stepbackT && this.time - p.stepbackT < 0.7)) prob -= 0.08;
      if (p.shotStyle === 'fade') prob -= 0.03;
      if (p.shotStyle === 'drift') prob -= 0.04 * (1 - p.r[three ? 'three' : 'mid'] / 140);
      prob *= 1 - 0.42 * c2;
      if (catchShot) prob += this.bt(p, 'catchShoot') * 0.03;
      if (p.shotStyle && p.shotStyle !== 'pullup') prob += this.bt(p, 'fadeAce') * 0.035;
    }
    if (kind !== 'dunk' && (kind !== 'layup' || p.meterOn)) {
      const tm = { perfect: -1, good: 1.12, early: 0.55, late: 0.55, 'very early': 0.1, 'very late': 0.1 }[quality];
      if (tm === -1) prob = p.isUser ? 1 : c < 0.35 ? 0.97 : Math.min(0.9, prob * 1.5 + 0.28);
      else prob *= tm;
    }
    if (!p.isUser && kind !== 'ft') prob *= [0.8, 0.92, 1.0, 1.08][this.diff];
    if (this.isFoe(p) && kind !== 'ft') prob *= 1 + this.heat * 0.08;
    // Dimer: teammates shoot better right after the user's pass
    if (!p.isUser && p.lastPassFrom && p.lastPassFrom.isUser && this.time - p.catchT < 3) prob += this.bt(p.lastPassFrom, 'dimer') * 0.03;
    if (p.isUser && p.energy < 25) prob *= 0.9;
    prob = clamp(prob, 0.01, 0.99);
    let make = chance(prob);
    // A perfect (green) release always goes in
    if (p.isUser && quality === 'perfect' && (kind === 'jumper' || kind === 'ft' || (kind === 'layup' && p.meterOn))) make = true;

    // Contact dunk: posterize a defender who challenged at the rim
    let poster = false;
    if (kind === 'dunk' && contester) {
      const d = len(contester.pos.x - p.pos.x, contester.pos.z - p.pos.z);
      if (p.dunkStyle === 'contact' && d < 6.5) {
        // Contact dunk: going through the defender. Made ones always put him on the floor.
        const pp = clamp(0.35 + (p.r.dunk - contester.r.block) / 110 + (p.r.strength - contester.r.strength) / 160 + (p.r.vert - 50) / 300 + this.bt(p, 'posterizer') * 0.07, 0.25, 0.92);
        if (make || chance(pp)) { poster = true; make = true; }
      } else if (d < 5 && (contester.y > 0.3 || contester.action === 'block')) {
        const pp = clamp(0.14 + (p.r.dunk - contester.r.block) / 130 + (p.r.strength - contester.r.strength) / 200 + (p.r.vert - 50) / 300 + this.bt(p, 'posterizer') * 0.06, 0.1, 0.85);
        if (chance(pp)) { poster = true; make = true; }
      }
    }

    // Foul check on drives / close contests
    let foul = null;
    if (kind !== 'ft' && contester) {
      const d = len(contester.pos.x - p.pos.x, contester.pos.z - p.pos.z);
      let fp = 0;
      if ((kind === 'layup' || kind === 'dunk') && d < 4) fp = 0.1 + c * 0.12;
      else if (d < 3 && contester.y > 0.3) fp = 0.05;
      if (contester.isUser) fp *= 0.8;
      if (poster) fp = 0.5;
      if (chance(fp)) foul = contester;
    }
    if (poster) {
      contester.duckUntil = 0;
      if (p.contactLite) {
        // Slight contact: he gets bumped out of the way, not put on the floor
        this.knock(contester, p.pos, 6, 'stumble', 0.7, true);
        p.stepOver = null;
      } else {
        contester.fallVar = p.dunkStyle === 'contact' && p.contactVar === 1 ? 0 : Math.floor(Math.random() * 3);
        this.knock(contester, p.pos, 13, 'posterfall', 2.5, true);
        // Elite (90+) dunkers sometimes step over the guy they just dunked on
        p.stepOver = p.r.dunk >= 90 && chance(0.45) ? contester : null;
      }
      this.emit('poster', { p, def: contester }); this.bc(p, 'posterizer', 2);
      this.pending2 = () => this.maybeScuffle(contester, p, 0.45);
      if (p.isUser) this.addGrade(2, 'Posterized');
    } else if (foul) {
      // Visible contact on the foul
      this.knock(foul, p.pos, 5, 'bump', 0.45);
      this.knock(p, foul.pos, kind === 'jumper' ? 2 : 4, null);
    }

    if (kind !== 'ft') {
      p.stats.fga++; if (three) p.stats.tpa++;
      if (p.isUser) {
        if (!make && c > 0.6 && kind === 'jumper' && quality !== 'perfect') this.addGrade(-2, 'Bad shot');
        else if (!make) this.addGrade(-0.5, 'Missed shot');
      }
      // Defensive grade: user contested their man
      if (contester && contester.isUser && !make) { this.addGrade(1.5, 'Forced miss'); this.bc(contester, 'clamps'); }
    }

    // Ball flight
    const start = b.vis && b.holder === p ? { ...b.vis } : { x: p.pos.x, y: p.heightFt + 1 + p.y, z: p.pos.z };
    for (const q of this.players) q.hasBall = false;
    b.holder = null;
    b.state = 'shot';
    b.lastTouch = p.team;
    const dist = len(h.x - start.x, h.z - start.z);
    let T = kind === 'dunk' ? 0.12 : kind === 'layup' ? (p.layupStyle === 'floater' ? 0.95 : 0.5) : 0.75 + dist * 0.022 + (this.js === JUMPSHOTS.higharc ? 0.1 : 0);
    let tx = h.x, tz = h.z, ty = RIM_Y + 0.15;
    let missOff = 0;
    if (!make) {
      missOff = quality.startsWith('very') ? rand(1.6, 2.6) : rand(0.75, 1.05);
      // Mostly short/long misses along the shot line
      const ang = Math.atan2(h.z - start.z, h.x - start.x) + gauss() * 0.6;
      const sgn = chance(0.5) ? 1 : -1;
      tx += Math.cos(ang) * missOff * sgn; tz += Math.sin(ang) * missOff * sgn;
    } else if (kind !== 'dunk') {
      tx -= this.dir(p.team) * 0.1;
    }
    b.pos = { ...start };
    b.vel = { x: (tx - start.x) / T, z: (tz - start.z) / T, y: (ty - start.y + 0.5 * G_BALL * T * T) / T };
    b.shot = { catchShot, style: p.shotStyle, shooter: p, kind, make, pts, T, t: 0, quality, three, foul, missOff, contest: c, assister: this.assistCredit(p), side: this.dir(p.team), blockable: kind !== 'ft' };
    if (foul && kind !== 'ft') {
      // whistle resolves after the ball result
      b.shot.foulPending = true;
    }
    this.emit('shot', { p, kind, three });
  }

  assistCredit(p) {
    if (p.lastPassFrom && this.time - p.catchT < 4 && p.lastPassFrom.team === p.team) return p.lastPassFrom;
    return null;
  }

  shotResult() {
    const b = this.ball, s = b.shot, p = s.shooter;
    const h = { x: s.side * HOOP_X, z: 0 };
    if (s.make) {
      b.state = 'net';
      b.pos = { x: h.x, y: RIM_Y - 0.1, z: h.z };
      b.vel = { x: rand(-1, 1), y: -10, z: rand(-1, 1) };
      b.netT = 0;
      this.emit('swish', { side: s.side, perfect: s.quality === 'perfect' });
      if (s.kind === 'ft') { this.ftResult(true); return; }
      this.score[p.team] += s.pts;
      p.stats.pts += s.pts; p.stats.fgm++; if (s.three) p.stats.tpm++; if (s.kind === 'dunk') p.stats.dnk++;
      if (s.kind === 'layup') this.bc(p, 'acrobat');
      if (s.kind === 'jumper' && s.catchShot) this.bc(p, 'catchShoot');
      if (s.kind === 'jumper' && s.contest > 0.5) this.bc(p, 'deadeye');
      if (s.kind === 'jumper' && s.style) this.bc(p, 'fadeAce');
      if (s.assister) { s.assister.stats.ast++; if (s.assister.isUser) this.addGrade(2.5, 'Assist'); this.bc(s.assister, 'dimer'); }
      this.goatHit(p, s.kind === 'jumper' ? 'shooting' : 'finishing');
      if (s.assister) this.goatHit(s.assister, 'playmaking');
      this.toGain(p, 0.2 + (s.three ? 0.06 : 0) + (s.quality === 'perfect' ? 0.08 : 0) + (s.kind === 'dunk' ? 0.06 : 0), s.kind === 'jumper' ? 'shooting' : 'finishing');
      if (s.assister) this.toGain(s.assister, 0.14, 'playmaking');
      this.toGain(this.opp(p), -0.03);
      if (p.isUser) this.addGrade(s.three ? 3.5 : 2.5, s.three ? 'Made 3' : 'Made shot');
      const defender = this.opp(p);
      if (defender && defender.isUser && len(defender.pos.x - p.pos.x, defender.pos.z - p.pos.z) < 8) this.addGrade(-1.5, 'Allowed score');
      this.emit('make', { p, kind: s.kind, pts: s.pts, three: s.three, assister: s.assister });
      if (s.foulPending) { this.foul(s.foul, p, true, true); return; }
      if (this.buzzer) { this.pending = { t: 1.2, fn: () => this.endQuarter() }; this.phase = 'dead'; return; }
      this.inbound(1 - p.team, 1.3);
      return;
    }
    // Miss
    if (s.kind === 'ft') {
      const last = this.ftQueue && this.ftQueue.done + 1 >= this.ftQueue.n;
      this.ftResult(false);
      this.emit('rim', {});
      if (!last) { b.state = 'dead'; b.vel = { x: -s.side * 4, y: 6, z: rand(-2, 2) }; return; }
    }
    if (s.kind !== 'ft') { this.toGain(p, -0.03); if (s.contest > 0.45) { this.toGain(this.opp(p), 0.06, 'lockdown'); this.goatHit(this.opp(p), 'defense'); } }
    if (s.foulPending) { this.foul(s.foul, p, true, false, s.pts); b.state = 'dead'; return; }
    if (s.missOff > 1.5) {
      // Airball / off the side: keep flying
      b.state = 'loose';
      this.emit('airball', { p });
    } else {
      const ox = b.pos.x - h.x, oz = b.pos.z - h.z, ol = len(ox, oz) || 1;
      const out = rand(5, 12);
      b.vel = { x: ox / ol * out + rand(-2, 2), y: rand(7, 14), z: oz / ol * out + rand(-2, 2) };
      b.pos.y = RIM_Y + 0.2;
      b.state = 'loose';
      this.emit('rim', {});
    }
    b.rimmed = true;
    this.shotClock = 24;
    if (this.buzzer) { this.pending = { t: 0.8, fn: () => this.endQuarter() }; }
  }

  // ---------- passing ----------
  pickPassTarget(p, move, preferRim = false) {
    const mates = this.teamPlayers(p.team).filter(q => q !== p);
    const ml = move ? len(move.x, move.z) : 0;
    let best = null, bs = -1e9;
    for (const q of mates) {
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, d = len(dx, dz) || 1;
      let s;
      if (ml > 0.3) {
        const dot = (dx * move.x + dz * move.z) / (d * ml);
        s = dot * 10 - d * 0.05;
      } else {
        s = this.nearestDefender(q).d - d * 0.08;
        if (preferRim) s -= this.distHoop(q) * 0.3;
      }
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }

  startPass(from, to, opt = {}) {
    const b = this.ball;
    const start = opt.from ? { ...opt.from } : (b.vis && b.holder === from ? { ...b.vis } : { x: from.pos.x, y: 4.5, z: from.pos.z });
    for (const q of this.players) q.hasBall = false;
    if (from) { this.setAction(from, 'pass', 0.4); from.holding = false; }
    b.holder = null;
    b.state = 'pass';
    b.lastTouch = from ? from.team : opt.team;
    let T, tx, ty, tz;
    if (opt.lob) {
      const h = this.hoopOf(to.team);
      const ux = to.pos.x - h.x, uz = to.pos.z - h.z, ul = len(ux, uz) || 1;
      tx = h.x + ux / ul * 2.2; tz = h.z + uz / ul * 2.2; ty = RIM_Y + 0.8;
      T = 0.95;
      to.lobPt = { x: tx, z: tz };
    } else {
      const d0 = len(to.pos.x - start.x, to.pos.z - start.z);
      const speed = 40 + (from ? from.r.pass * 0.12 : 0);
      T = Math.max(0.22, d0 / speed);
      tx = to.pos.x + to.vel.x * T * 0.8; tz = to.pos.z + to.vel.z * T * 0.8;
      tx = clamp(tx, -46.5, 46.5); tz = clamp(tz, -24.5, 24.5);
      ty = 4.2;
      T = Math.max(0.22, len(tx - start.x, tz - start.z) / speed);
      if (opt.float) { T += 0.3; ty = 4.6; }
    }
    b.pos = start;
    b.vel = { x: (tx - start.x) / T, z: (tz - start.z) / T, y: (ty - start.y + 0.5 * G_BALL * T * T) / T };
    b.pass = { from, to, T, t: 0, target: { x: tx, z: tz }, noIntercept: !!opt.noIntercept, lob: !!opt.lob, checked: new Set() };
    if (from && from.isUser) this.emit('pass', {});
  }

  // ---------- AI ----------
  updateAI(dt) {
    const b = this.ball;
    for (const p of this.players) {
      if (p.benched) continue;
      if (p.blockQueued !== undefined) {
        p.blockQueued -= dt;
        if (p.blockQueued <= 0) {
          delete p.blockQueued;
          if (!p.action && p.y === 0 && p.stun <= 0) this.startBlock(p);
        }
      }
      if (p.isUser) continue;
      if (this.phase === 'ft') { p.aiTarget = null; continue; }
      p.aiT -= dt;
      if (p.hasBall && b.state === 'held' && !p.inbounding) this.aiHandler(p, dt);
      else p.aiTarget = this.aiOffBall(p, dt);
    }
    // Pick a help defender when a driver attacks the rim
    this.helper = null;
    if (this.phase === 'live' && b.state === 'held' && b.holder) {
      const hd = b.holder, h = this.hoopOf(hd.team);
      const dh = len(hd.pos.x - h.x, hd.pos.z - h.z), sp = len(hd.vel.x, hd.vel.z);
      if (dh < 16 && sp > 9) {
        const px = hd.pos.x + (h.x - hd.pos.x) / (dh || 1) * 5, pz = hd.pos.z + (h.z - hd.pos.z) / (dh || 1) * 5;
        let best = null, bd = 12;
        for (const q of this.players) {
          if (q.team === hd.team || q.isUser || q.benched || q === this.matchup(hd) || q.stun > 0) continue;
          const d = len(q.pos.x - px, q.pos.z - pz);
          if (d < bd) { bd = d; best = q; }
        }
        this.helper = best;
      }
    }
    // AI steal attempts on handlers
    if (this.phase === 'live' && b.state === 'held' && b.holder) {
      const h = b.holder;
      for (const q of this.players) {
        if (q.team === h.team || q.isUser || q.stun > 0 || q.action) continue;
        const d = len(q.pos.x - h.pos.x, q.pos.z - h.pos.z);
        if (d < 4) {
          const rate = 0.22 * (q.r.steal / 99) * [0.5, 0.8, 1, 1.3][this.diff] * (h.isUser ? 1 + this.heat * 0.6 : 0.6) * (this.toIs(q, 'lockdown') ? 1.4 : 1);
          if (chance(rate * dt)) {
            this.setAction(q, 'steal', 0.38);
            let pr = clamp(0.14 + (q.r.steal - h.r.handle) / 200, 0.04, 0.35) * (this.toIs(q, 'lockdown') ? 1.6 : 1);
            if (this.isMove(h.action)) pr *= 0.4;
            if (chance(pr)) this.stealSuccess(q, h);
            else if (chance(0.05)) this.foul(q, h, false);
          }
        }
      }
    }
  }

  aiHandler(p, dt) {
    if (this.inb || this.phase !== 'live') return;
    const h = this.hoopOf(p.team);
    const d = this.dir(p.team);
    const dh = this.distHoop(p);
    if (p.action) return;
    if ((p.paintT || 0) > 2.1) {
      p.post = false; p.driveT = 0;
      if (dh < 10) this.aiFinish(p); else if (!this.aiPass(p)) this.startJumper(p);
      return;
    }
    if (p.post) {
      p.postT -= dt;
      p.aiTarget = { x: h.x, z: h.z, sprint: false };
      if (p.postT <= 0 || dh < 7) {
        const lat = { x: -(h.z - p.pos.z), z: (h.x - p.pos.x) };
        const sgn = chance(0.5) ? 1 : -1;
        if (chance(0.35)) this.postMove(p, { x: lat.x * sgn, z: lat.z * sgn, type: chance(0.3) ? 'double' : 'swipe' });
        else this.startJumper(p, false, dh < 8 && p.r.close > p.r.mid + 5 ? 'hook' : 'fade', true);
      }
      return;
    }
    const backcourt = d * p.pos.x < 0;
    const { q: def, d: dd } = this.nearestDefender(p);
    if (p.driveT > 0) {
      p.driveT -= dt;
      p.aiTarget = { x: h.x - d * 3, z: h.z + (p.pos.z > 0 ? 1.5 : -1.5), sprint: true };
      if (dh < 8.5 || (this.canDunk(p) && p.r.dunk >= 70 && dh < Math.min(12, this.dunkRange(p)) && len(p.vel.x, p.vel.z) > 9 && chance(0.35))) this.aiFinish(p);
      return;
    }
    const held = this.time - p.ballSince;
    // Get the ball to the user quickly when they're open or asking for it
    if (p.team === this.userTeam && !this.user.benched && this.user !== p && held > 0.2) {
      const u = this.user;
      p.feedT = (p.feedT || 0) - dt;
      if (p.feedT <= 0) {
        p.feedT = 0.18;
        const ud = this.nearestDefender(u).d, uh = this.distHoop(u);
        const lane = this.laneClear(p, u);
        if (u.lobCall > 0 && uh < 22 && (ud > 2.5 || chance(0.5))) { this.startPass(p, u, { lob: true }); u.lobCall = 0; return; }
        if (u.callT > 0 && (lane || chance(0.35))) { this.startPass(p, u); u.callT = 0; return; }
        if (ud > 7 && uh < 30 && lane && chance(0.45 + this.passBias)) { this.startPass(p, u); return; }
      }
    }
    if (p.aiT > 0) return;
    p.aiT = rand(0.3, 0.6);

    if (backcourt) {
      p.aiTarget = { ...this.spotToWorld(p.team, 27, p.pos.z * 0.5), sprint: held < 3 };
      if (held > 1.2 && chance(0.15)) this.aiPass(p, true);
      return;
    }
    // Run a pick and roll now and then
    if (dd < 5 && dh < 32 && !this.teamPlayers(p.team).some(q => q.screen) && chance(0.08)) this.callScreen(p);
    if (this.shotClock < 3.5) { if (dh < 9) this.aiFinish(p); else this.startJumper(p); return; }
    if (dh < 7) { this.aiFinish(p); return; }
    if (dh < 17 && dh > 7 && dd < 5 && (p.slot >= 3 || p.r.close > 72) && chance(0.3)) {
      p.post = true; p.postT = rand(1.2, 2.6); return;
    }
    const est = this.estShot(p);
    const three = this.is3(p.pos.x, p.pos.z, p.team);
    const best = this.bestPassOption(p);
    const passScore = best ? best.score + held * 0.025 : 0;
    const shootScore = est + (dd > 6 ? 0.05 : 0) + (p.catchT && this.time - p.catchT < 1.2 ? 0.03 : 0);
    const thresh = three ? 0.31 : 0.34;
    if (dh < 28 && shootScore > thresh && shootScore >= passScore - 0.02 && chance(0.75)) {
      // Good mid-range shooters fade away from a tight contest
      const tight = dh > 9 && dh < 22 && this.contestOf(p).c > 0.45 && chance(clamp((p.r.mid - 65) / 60, 0, 0.45));
      this.startJumper(p, false, tight ? 'fade' : null); return;
    }
    // Drive if lane is open
    const lane = this.laneOpen(p, h);
    if (lane && dh < 30 && held > 0.4 && chance(0.25 + p.r.layup / 400 + p.r.speed / 500)) { p.driveT = rand(0.9, 1.6); return; }
    // Dribble move to shake defender
    if (dd < 5 && chance(0.1 + p.r.handle / 600)) {
      const lat = { x: -(h.z - p.pos.z), z: (h.x - p.pos.x) };
      const s = chance(0.5) ? 1 : -1;
      this.dribbleMove(p, { x: lat.x * s, z: lat.z * s, type: chance(0.15) ? 'double' : 'swipe' });
      if (chance(0.4)) p.driveT = rand(0.5, 1.0);
      return;
    }
    // Move the ball
    if (best && (passScore > 0.3 || held > 2.2) && held > 0.5 && chance(0.7)) { this.startPass(p, best.q); return; }
    // Otherwise move toward a scoring spot
    const sp = SPOT_POOL[Math.floor(Math.random() * 5)];
    p.aiTarget = { ...this.spotToWorld(p.team, sp[0], sp[1]), sprint: false };
  }

  estShot(p) {
    const dh = this.distHoop(p);
    const three = this.is3(p.pos.x, p.pos.z, p.team);
    const r = three ? p.r.three : dh < 10 ? p.r.close : p.r.mid;
    let e = three ? 0.15 + r / 99 * 0.45 : 0.22 + r / 99 * 0.48;
    if (dh < 10) e += 0.08;
    if (dh > 26) e -= (dh - 26) * 0.05;
    return e * (1 - 0.5 * this.contestOf(p).c) + (three ? 0.05 : 0);
  }

  bestPassOption(p) {
    let best = null;
    for (const q of this.teamPlayers(p.team)) {
      if (q === p) continue;
      let score = this.estShot(q);
      if (this.distHoop(q) < 8) score += 0.08;
      if (q.isUser) score += this.passBias * 0.25 + (q.callT > 0 ? 0.2 : 0);
      // Lane risk
      const lx = q.pos.x - p.pos.x, lz = q.pos.z - p.pos.z, ll = len(lx, lz) || 1;
      for (const o of this.players) {
        if (o.team === p.team || o.benched) continue;
        const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
        const along = (ox * lx + oz * lz) / ll;
        if (along < 1 || along > ll - 1) continue;
        if (Math.abs(ox * lz - oz * lx) / ll < 2.2) score -= 0.15;
      }
      if (ll > 45) score -= 0.1;
      if (!best || score > best.score) best = { q, score };
    }
    return best;
  }

  laneClear(p, q) {
    const lx = q.pos.x - p.pos.x, lz = q.pos.z - p.pos.z, ll = len(lx, lz) || 1;
    for (const o of this.players) {
      if (o.team === p.team || o.benched) continue;
      const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
      const along = (ox * lx + oz * lz) / ll;
      if (along < 1 || along > ll - 1) continue;
      if (Math.abs(ox * lz - oz * lx) / ll < 2.4) return false;
    }
    return true;
  }

  laneOpen(p, h) {
    const hx = h.x - p.pos.x, hz = h.z - p.pos.z, hl = len(hx, hz) || 1;
    for (const q of this.players) {
      if (q.team === p.team || q.benched) continue;
      const qx = q.pos.x - p.pos.x, qz = q.pos.z - p.pos.z;
      const along = (qx * hx + qz * hz) / hl;
      if (along < 0 || along > 14) continue;
      const perp = Math.abs(qx * hz - qz * hx) / hl;
      if (perp < 3.2 && q.stun <= 0) return false;
    }
    return true;
  }

  aiFinish(p) {
    p.driveT = 0;
    const dh = this.distHoop(p);
    const canDunk = this.canDunk(p) && dh < this.dunkRange(p);
    const nd = this.nearestDefender(p);
    // Floater over a rim protector from the short corner / lane line
    if (!canDunk && dh > 6 && dh < 13 && nd.q && nd.d < 6 && (nd.q.r.block > 65 || nd.q.heightFt > p.heightFt + 0.3) && chance(0.4)) { this.startFloater(p); return; }
    this.startFinish(p, canDunk && chance(0.25 + p.r.dunk / 220) ? 'dunk' : 'layup');
  }

  aiPass(p, safe = false) {
    const mates = this.teamPlayers(p.team).filter(q => q !== p);
    let best = null, bs = -1e9;
    for (const q of mates) {
      const open = this.nearestDefender(q).d;
      const dq = this.distHoop(q);
      const three = this.is3(q.pos.x, q.pos.z, q.team);
      const r = three ? q.r.three : dq < 12 ? q.r.close : q.r.mid;
      let s = Math.min(open, 12) * 0.8 + r / 10 - (dq > 30 ? 6 : 0);
      if (q.isUser) s += this.passBias * 12 + (q.callT > 0 ? 8 : 0);
      if (safe) s = open;
      // Lane risk
      const lx = q.pos.x - p.pos.x, lz = q.pos.z - p.pos.z, ll = len(lx, lz) || 1;
      for (const o of this.players) {
        if (o.team === p.team) continue;
        const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
        const along = (ox * lx + oz * lz) / ll;
        if (along < 0 || along > ll) continue;
        const perp = Math.abs(ox * lz - oz * lx) / ll;
        if (perp < 2.5) s -= 6;
      }
      if (s > bs) { bs = s; best = q; }
    }
    if (best) { this.startPass(p, best); return true; }
    return false;
  }

  aiOffBall(p, dt) {
    const b = this.ball;
    if (p.screen) { const t = this.updateScreen(p, dt); if (t) return t; }
    if (this.inb) {
      if (p === this.inb.inbounder) return { x: this.inb.spot.x, z: this.inb.spot.z, sprint: true };
      if (p === this.inb.receiver) return { x: this.inb.recvSpot.x, z: this.inb.recvSpot.z, sprint: true };
    }
    // Pass receiver
    if (b.state === 'pass' && b.pass.to === p) return { x: b.pass.target.x, z: b.pass.target.z, sprint: true };
    // Loose ball / rebound
    if (b.state === 'loose' || (b.state === 'shot' && b.shot && b.shot.t > b.shot.T * 0.45)) {
      const land = this.predictLanding();
      const d = len(land.x - p.pos.x, land.z - p.pos.z);
      const rank = this.players.filter(q => q.team === p.team && !q.benched && len(land.x - q.pos.x, land.z - q.pos.z) < d).length;
      const crash = b.state === 'loose' ? 2 : p.team === this.offense ? 1 : 2;
      if (rank < crash || d < (b.state === 'loose' ? 10 : 6)) {
        // auto-jump for rebounds
        const bd = len(b.pos.x - p.pos.x, b.pos.z - p.pos.z);
        if (b.state === 'loose' && bd < 4 && b.pos.y > 7 && b.pos.y < 12.5 && b.vel.y < 2 && !p.action && p.y === 0 && p.stun <= 0) {
          this.setAction(p, 'rebound', 0.75); p.vy = 11 + p.r.vert * 0.06;
        }
        return { x: land.x, z: land.z, sprint: true };
      }
    }
    if (this.offense === p.team) return this.offSpot(p, dt);
    return this.defSpot(p);
  }

  predictLanding() {
    const b = this.ball;
    if (b.state === 'shot' && b.shot) {
      const h = { x: b.shot.side * HOOP_X, z: 0 };
      return { x: h.x - b.shot.side * 5, z: h.z };
    }
    // Time until ball drops to ~8ft
    const vy = b.vel.y, y = b.pos.y - 8;
    const disc = vy * vy + 2 * G_BALL * Math.max(0, y);
    const t = y > 0 ? (vy + Math.sqrt(disc)) / G_BALL : 0.1;
    return { x: clamp(b.pos.x + b.vel.x * t, -46, 46), z: clamp(b.pos.z + b.vel.z * t, -24, 24) };
  }

  // Is a teammate already in the lane (or cutting into it)?
  laneBusy(p) {
    return this.teamPlayers(p.team).some(q => q !== p && !q.hasBall &&
      (this.inPaint(q, q.team) || (q.spot && q.spotT > 0 && inLane(q.spot[0], q.spot[1]))));
  }

  offSpot(p, dt) {
    p.spotT -= dt;
    // Don't camp in the lane: clear out well before three seconds, and right away if it's crowded
    const inside = this.inPaint(p, p.team);
    if (inside && ((p.paintT || 0) > 1.0 || (this.laneBusy(p) && (p.paintT || 0) > 0.4)) && (!p.spot || inLane(p.spot[0], p.spot[1]))) {
      const sz = p.pos.z >= 0 ? 1 : -1;
      p.spot = chance(0.5) ? [5, sz * 11] : [21, sz * 12];
      p.spotT = 2.5;
    }
    const handler = this.ball.holder;
    if (!p.spot || p.spotT <= 0) {
      p.spotT = rand(3, 6);
      const base = BASE_SPOTS[p.slot];
      let choice = base;
      if (chance(0.55)) {
        const opts = SPOT_POOL.filter(s => len(s[0] - base[0], s[1] - base[1]) < 16);
        choice = opts[Math.floor(Math.random() * opts.length)] || base;
      }
      // Cut to the basket occasionally if defender is ball watching, but only into an empty lane
      const def = this.opp(p);
      if ((def && def.stun > 0 || chance(0.1)) && !this.laneBusy(p)) choice = [4, rand(-3, 3)], p.spotT = 1.4;
      // Avoid stacking
      const mates = this.teamPlayers(p.team).filter(q => q !== p && q.spot);
      if (mates.some(q => len(q.spot[0] - choice[0], q.spot[1] - choice[1]) < 8)) choice = base;
      if (inLane(choice[0], choice[1]) && p.spotT > 1.5) choice = base;
      p.spot = choice;
    }
    const w = this.spotToWorld(p.team, p.spot[0], p.spot[1]);
    // In transition, run the floor
    const far = len(w.x - p.pos.x, w.z - p.pos.z) > 20;
    void handler;
    return { x: w.x, z: w.z, sprint: far };
  }

  // Box out whoever is closest (not just your matchup): get between them and the rim, back into them.
  // The target sticks while the button is held unless someone else gets clearly closer.
  boxOutSpot(p) {
    const h = this.hoopOf(this.offense);
    const dist = q => len(q.pos.x - p.pos.x, q.pos.z - p.pos.z);
    const foes = this.players.filter(q => q.team !== p.team && !q.benched && !this.isDown(q));
    if (!foes.length) return { x: p.pos.x, z: p.pos.z };
    let man = foes.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    const cur = p.boxTarget && foes.includes(p.boxTarget) ? p.boxTarget : null;
    if (cur && dist(cur) < dist(man) + 1.5) man = cur;
    if (dist(man) > 14) { p.boxTarget = null; return { x: p.pos.x, z: p.pos.z }; } // nobody near: hold your ground
    p.boxTarget = man;
    const hx = h.x - man.pos.x, hz = h.z - man.pos.z, hl = len(hx, hz) || 1;
    return { x: man.pos.x + hx / hl * 1.9, z: man.pos.z + hz / hl * 1.9, sprint: dist(man) > 4 };
  }

  defSpot(p) {
    const man = this.opp(p);
    const h = this.hoopOf(this.offense);
    if (!man || man.benched) return { x: h.x - this.dir(this.offense) * 10, z: 0 };
    const mx = man.pos.x, mz = man.pos.z;
    const hx = h.x - mx, hz = h.z - mz, hl = len(hx, hz) || 1;
    const b = this.ball;
    let gap;
    if (man.hasBall) gap = man.post ? 1.8 : hl > 30 ? 6 : hl < 27 && Math.max(man.r.three, man.r.mid) > 65 ? 2.9 : 3.4;
    else gap = 5 + Math.min(6, hl * 0.12);
    if (man.hasBall && man.isUser) gap *= 1 - this.heat * 0.2;
    // Help defense: one defender steps into a driver's path
    if (this.helper === p && b.holder && b.holder.team !== p.team) {
      const hd = b.holder, dx = h.x - hd.pos.x, dz = h.z - hd.pos.z, dl = len(dx, dz) || 1;
      return { x: hd.pos.x + dx / dl * 3.2, z: hd.pos.z + dz / dl * 3.2, sprint: true, face: hd };
    }
    let tx = mx + hx / hl * gap, tz = mz + hz / hl * gap;
    if (!man.hasBall && b.holder) {
      // Sag toward the ball
      tx += (b.holder.pos.x - tx) * 0.18; tz += (b.holder.pos.z - tz) * 0.18;
    }
    // One help defender may sit in the lane; the rest stay attached to men who aren't in it
    if (!man.hasBall && this.laneXZ(tx, tz, this.offense) && !this.inPaint(man, this.offense) && this.laneAnchor() !== p) {
      for (let i = 1; i <= 10 && this.laneXZ(tx, tz, this.offense); i++) { tx += (mx - tx) * 0.2; tz += (mz - tz) * 0.2; }
    }
    // Transition defense: get back
    const manBack = this.dir(this.offense) * mx < -5;
    if (manBack && !man.hasBall) { tx = h.x - this.dir(this.offense) * 18 + (tx - h.x) * 0.2; }
    return { x: tx, z: tz, sprint: len(tx - p.pos.x, tz - p.pos.z) > 8, face: man };
  }

  // ---------- physics / players ----------
  updatePlayers(dt, input) {
    const b = this.ball;
    for (const p of this.players) {
      if (p.benched) continue;
      if (p.stun > 0) p.stun -= dt;
      if (p.action) {
        p.actionT += dt;
        this.updateAction(p, dt, input);
        if (p.action && p.actionT >= p.actionDur && p.y <= 0) {
          // Safety net: a shot animation must never end with the ball still in hand
          if (!p.released && p.hasBall && this.ball.holder === p) {
            if (p.action === 'shoot') { p.meter = Math.max(p.meter || 0, 1.45); this.releaseJumper(p); }
            else if (p.action === 'layup') { if (p.meterOn) { p.meter = Math.max(p.meter || 0, 1.45); this.releaseLayup(p); } else { p.released = true; this.resolveShot(p, 'layup'); } }
            else if (p.action === 'dunk') { p.released = true; this.resolveShot(p, 'dunk'); }
          }
          const was = p.action;
          p.action = null;
          if (was === 'euro' && p.hasBall && this.ball.holder === p) {
            this.startFinish(p, 'layup');
            p.layupStyle = 'euro';
            if (p.isUser) { p.meterOn = true; p.meter = 0; this.emit('meterStart', { p }); }
          }
          if (was === 'land' && p.stepOver) {
            const v = p.stepOver; p.stepOver = null;
            const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, d = len(dx, dz);
            if (v.action === 'posterfall' && v.fallVar !== 1 && v.actionT < v.actionDur * 0.6 && d < 7) {
              // Walk right over him: past his body and a couple of steps beyond, looking down at him
              const go = d + 1.2, T = 1.6;
              this.setAction(p, 'stepover', T);
              p.moveVel = { x: dx / (d || 1) * go / T, z: dz / (d || 1) * go / T };
              p.facing = Math.atan2(dx, dz); p.stepVictim = v;
              this.emit('stepover', { p, def: v });
            }
          }
          if (was === 'shoot' && !p.ft && p.isUser && !p.hasBall) this.setAction(p, 'shotfollow', 0.35);
        }
      }
      // Desired velocity
      let desX = 0, desZ = 0, sprint = false;
      const ms = this.maxSpeed(p);
      const lockedAct = p.action && ['shoot', 'layup', 'dunk', 'hang', 'fall', 'posterfall', 'block', 'rebound', 'steal', 'pass', 'land', 'screen', 'stepover', 'euro'].includes(p.action);
      if (p.isUser) {
        const m = input.move;
        const ml = len(m.x, m.z);
        sprint = input.sprint && p.energy > 3;
        let useAI = false;
        if (p.autoRun) {
          p.autoRunT += dt;
          if (ml > 0.15 || p.hasBall || p.autoRunT > 12 || this.phase === 'ft') p.autoRun = false;
        }
        if (this.phase === 'ft') useAI = false;
        else if (p.autoRun && !(this.inb && this.inb.receiver === p)) { useAI = true; }
        else if (p.lobPt && b.state === 'pass' && b.pass.to === p) { useAI = true; }
        else if (this.inb && this.inb.receiver === p && ml < 0.15) { useAI = true; }
        else if (p.screen && ml < 0.6) { useAI = true; }
        else if (this.offense !== p.team && (p.defAssistHeld || p.boxing)) { useAI = true; }
        else if (this.defAssist && this.offense !== p.team && ml < 0.15) { p.idleT = (p.idleT || 0) + dt; useAI = p.idleT > 0.5; }
        else p.idleT = 0;
        if (p.screen && ml >= 0.6 && p.screen.state === 'go') p.screen = null;
        if (useAI) {
          let t = p.lobPt && b.state === 'pass' ? { x: p.lobPt.x, z: p.lobPt.z, sprint: true }
            : this.inb && this.inb.receiver === p ? { x: this.inb.recvSpot.x, z: this.inb.recvSpot.z, sprint: true } : null;
          if (!t && p.screen) t = this.updateScreen(p, dt) || { x: p.pos.x, z: p.pos.z };
          if (!t && p.boxing) t = this.boxOutSpot(p);
          if (!t && p.autoRun && this.offense === p.team) t = this.offSpot(p, dt);
          if (!t) t = this.defSpot(p);
          const dx = t.x - p.pos.x, dz = t.z - p.pos.z, d = len(dx, dz);
          const s = Math.min(ms * (t.sprint ? 1.3 : 1), d * 4);
          if (d > 0.3) { desX = dx / d * s; desZ = dz / d * s; }
          if (t.face) p.faceTarget = t.face;
        } else {
          const s = ms * (sprint ? 1.32 : 1) * Math.min(1, ml);
          if (ml > 0.05) { desX = m.x / ml * s; desZ = m.z / ml * s; }
          p.faceTarget = null;
        }
        if (this.phase === 'ft') { desX = desZ = 0; }
        // Energy
        if (sprint && ml > 0.2) p.energy = Math.max(0, p.energy - dt * (14 - p.r.stamina * 0.08));
        else p.energy = Math.min(100, p.energy + dt * 7);
      } else if (p.aiTarget && this.phase !== 'ft') {
        let t = p.aiTarget;
        if (p.closeOn && this.time < p.closeT && !p.action) {
          const s = p.closeOn, h = this.hoopOf(s.team);
          const hx = h.x - s.pos.x, hz = h.z - s.pos.z, hl = len(hx, hz) || 1;
          t = { x: s.pos.x + hx / hl * 3.0, z: s.pos.z + hz / hl * 3.0, sprint: true, face: s };
        }
        if (p.meet && this.time < p.meet.until && !p.action) t = { x: p.meet.x, z: p.meet.z, sprint: true };
        if (p.chase && this.time < p.chase.until && !p.action) {
          const s = p.chase.target, h = this.hoopOf(s.team);
          const hx = h.x - s.pos.x, hz = h.z - s.pos.z, hl = len(hx, hz) || 1;
          t = { x: s.pos.x + hx / hl * 1.2, z: s.pos.z + hz / hl * 1.2, sprint: true };
        }
        const dx = t.x - p.pos.x, dz = t.z - p.pos.z, d = len(dx, dz);
        let s = Math.min(ms * (t.sprint ? 1.25 : 1), d * 3.5);
        // Getting boxed out by the user
        const u = this.user;
        if (u && u.boxing && u.boxTarget === p && len(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < 3.8) s *= 0.35;
        if (d > 0.4) { desX = dx / d * s; desZ = dz / d * s; }
        p.faceTarget = t.face || null;
      }
      if (p.stun > 0) { desX *= this.isDown(p) ? 0 : 0.25; desZ *= this.isDown(p) ? 0 : 0.25; }
      if (p.post && (!p.hasBall || this.distHoop(p) > 19)) { p.post = false; if (p.isUser) this.emit('call', { text: 'OUT OF THE POST' }); }
      if (p.post && p.hasBall && !p.action) { const bd = this.backDown(p, desX, desZ, dt); desX = bd.x; desZ = bd.z; }
      if (p.inbounding) { desX = desZ = 0; }

      if (this.isMove(p.action) && p.moveVel) {
        // Flow: ease in from the speed you came in with (the last move, or your run), burst, then hand
        // back to the stick at the end, so chained moves carry through instead of stopping dead.
        const k = Math.min(1, p.actionT / p.actionDur);
        const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
        const vin = p.moveVin || { x: 0, z: 0 };
        let a = sm(0, 0.35, k), mv = p.moveVel;
        if (p.action === 'hesi') { a = sm(0.35, 0.55, k); mv = k < 0.45 ? { x: mv.x * 0.1, z: mv.z * 0.1 } : { x: mv.x * 1.4, z: mv.z * 1.4 }; }
        const out = sm(0.62, 1, k);
        const bx = vin.x + (mv.x - vin.x) * a, bz = vin.z + (mv.z - vin.z) * a;
        p.vel.x = bx + (desX - bx) * out;
        p.vel.z = bz + (desZ - bz) * out;
      } else if (lockedAct) {
        // Committed: carry momentum, drift toward finish point
        if ((p.action === 'layup' || p.action === 'dunk') && p.finishPt) {
          const dx = p.finishPt.x - p.pos.x, dz = p.finishPt.z - p.pos.z, d = len(dx, dz);
          const k = Math.max(0.05, (p.releaseAt || p.actionDur * 0.55) - p.actionT);
          const s = Math.min(26, d / k);
          p.vel.x = d > 0.2 ? dx / d * s : 0; p.vel.z = d > 0.2 ? dz / d * s : 0;
        } else if (p.action === 'hang') { p.vel.x = p.vel.z = 0; }
        else if (p.action === 'euro' && p.euroDir) {
          const k = p.actionT / p.actionDur, ed = p.euroDir, sd = p.euroSide || 1;
          const lx = -ed.z * sd, lz = ed.x * sd; // toward the chosen side
          const lat = k < 0.4 ? -5 : 14, fw = 9;
          p.vel.x = ed.x * fw + lx * lat; p.vel.z = ed.z * fw + lz * lat;
        }
        else if (p.action === 'stepover' && p.moveVel) {
          // Moves only while stepping (first 60%), then stands over him
          const f = p.actionT / p.actionDur < 0.6 ? 1 / 0.6 : 0;
          p.vel.x = p.moveVel.x * f; p.vel.z = p.moveVel.z * f;
        }
        else if (p.action === 'shoot' && !p.ft && (p.shotStyle === 'fade' || p.shotVel)) {
          // Moving shots and fades carry their momentum: the gather plants (a pull-up mostly stops, a drift
          // or a fade keeps most of its speed, and a fade pushes back off the defender), then the take-off
          // velocity carries all the way through the air with no steering until the landing.
          if (!p.jumped) {
            let tx = 0, tz = 0;
            if (p.shotVel) {
              const keep = p.shotStyle === 'pullup' ? 0.12 : p.shotStyle === 'fade' ? 0.3 : 0.38;
              tx = p.shotVel.x * keep; tz = p.shotVel.z * keep;
            }
            if (p.shotStyle === 'fade') {
              const h = this.hoopOf(p.team), hx = p.pos.x - h.x, hz = p.pos.z - h.z, hl = len(hx, hz) || 1;
              tx += hx / hl * 4; tz += hz / hl * 4;
            }
            const k = 1 - Math.exp(-12 * dt);
            p.vel.x += (tx - p.vel.x) * k; p.vel.z += (tz - p.vel.z) * k;
            p.takeoffVel = { x: p.vel.x, z: p.vel.z };
          } else if (p.y > 0 || p.vy > 0) {
            const tv = p.takeoffVel || p.vel, drag = Math.exp(-0.25 * dt);
            p.vel.x = tv.x; p.vel.z = tv.z; tv.x *= drag; tv.z *= drag;
          } else { const dec = Math.exp(-9 * dt); p.vel.x *= dec; p.vel.z *= dec; } // landed: stick it
        }
        else { const dec = Math.exp(-6 * dt); p.vel.x *= dec; p.vel.z *= dec; }
      } else {
        const acc = 9.5 + p.r.speed * 0.035;
        const k = 1 - Math.exp(-acc * dt);
        p.vel.x += (desX - p.vel.x) * k;
        p.vel.z += (desZ - p.vel.z) * k;
      }
      if (p.hasBall && p.holding && len(p.vel.x, p.vel.z) > 2) p.holding = false;

      p.pos.x += (p.vel.x + p.push.x) * dt;
      p.pos.z += (p.vel.z + p.push.z) * dt;
      const pd = Math.exp(-5 * dt); p.push.x *= pd; p.push.z *= pd;
      if (p.hitT > 0) p.hitT -= dt;
      const ob = this.time < p.oobUntil ? 1.9 : 0;
      p.pos.x = clamp(p.pos.x, -46.8 - ob, 46.8 + ob);
      p.pos.z = clamp(p.pos.z, -24.8 - ob, 24.8 + ob);

      // Vertical
      if (p.action === 'hang') { p.vy = 0; if (p.hangY != null) p.y += (p.hangY - p.y) * (1 - Math.exp(-24 * dt)); }
      else if (p.y > 0 || p.vy > 0) {
        p.vy -= G_PLAYER * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; }
      }

      // Facing
      const sp = len(p.vel.x, p.vel.z);
      let want = null;
      if (p.inbounding && this.inb) {
        const r = this.inb.receiver; want = angTo(r.pos.x - p.pos.x, r.pos.z - p.pos.z);
      } else if (p.post && p.hasBall && !p.action) {
        const h = this.hoopOf(p.team); want = angTo(p.pos.x - h.x, p.pos.z - h.z);
      } else if (p.action === 'shoot' && p.shotStyle === 'hook') {
        const h = this.hoopOf(p.team); want = angTo(h.x - p.pos.x, h.z - p.pos.z) + (p.moveDir || 1) * 1.3;
      } else if (p.action === 'shoot' || p.action === 'layup' || p.action === 'dunk' || p.action === 'hang') {
        const h = this.hoopOf(p.team); want = angTo(h.x - p.pos.x, h.z - p.pos.z);
      } else if (this.isDown(p) || p.action === 'bump' || p.action === 'stepover') {
        want = null;
      } else if (p.boxing) {
        const h = this.hoopOf(this.offense); want = angTo(h.x - p.pos.x, h.z - p.pos.z);
      } else if (this.offense !== p.team && (p.faceTarget || this.ball.holder)) {
        const f = p.faceTarget || this.ball.holder;
        if (sp < 16) want = angTo(f.pos.x - p.pos.x, f.pos.z - p.pos.z);
        else want = angTo(p.vel.x, p.vel.z);
      } else if (sp > 2) want = angTo(p.vel.x, p.vel.z);
      else if (p.hasBall) { const h = this.hoopOf(p.team); want = angTo(h.x - p.pos.x, h.z - p.pos.z); }
      else if (this.ball.state !== 'dead') want = angTo(this.ball.pos.x - p.pos.x, this.ball.pos.z - p.pos.z);
      if (want !== null && !this.isMove(p.action)) p.facing = angLerp(p.facing, want, 1 - Math.exp(-10 * dt));

      // Dribble
      if (p.hasBall && !p.holding) {
        const prev = p.dribblePhase;
        // Running: one bounce per stride (matches the run cycle in player.js); standing: the style's rhythm
        const stride = (3 + sp * 0.38) * (p.anim ? p.anim.cadence : 1) / (Math.PI * 2);
        const rate = sp > 6 ? stride * Math.min(1.12, Math.max(0.92, p.anim ? p.anim.dribRate : 1)) : (p.post ? 2.0 : 1.9) * (p.anim ? p.anim.dribRate : 1);
        p.dribblePhase = (p.dribblePhase + dt * rate) % 1;
        if (prev < 0.5 && p.dribblePhase >= 0.5 && this.ball.state === 'held') this.emit('dribble', { p });
      }
    }
    this.collide();
    this.checkThreeSeconds(dt);
  }

  updateAction(p, dt, input) {
    const a = p.action;
    if (a === 'shoot' && !p.released) {
      p.meter += dt / (p.ft ? this.js.fill * 1.1 : this.js.fill);
      if (!p.jumped && p.actionT >= p.jumpAt) {
        p.jumped = true;
        p.vy = p.shotVy || (p.ft ? 4 : 9 + p.r.vert * 0.03);
      }
      if (p.isUser) {
        if (input.shootReleased || !input.shootHeld || p.meter >= 1.45) this.releaseJumper(p);
      } else if (p.meter >= p.aiRelease || p.meter >= 1.45) this.releaseJumper(p);
      // Shot blocked while gathering?
      this.checkBlock(p);
    }
    if ((a === 'layup' || a === 'dunk') && !p.released) {
      if (!p.jumped && p.actionT >= (p.jumpAtF || 0.22)) {
        p.jumped = true;
        p.vy = a === 'dunk' ? (p.dunkVy || Math.sqrt(2 * G_PLAYER * this.dunkApex(p, p.extraHops))) : 12 + p.r.vert * 0.04;
      }
      this.checkBlock(p);
      if (a === 'layup' && p.meterOn && p.isUser && !p.released) {
        p.meter += dt / (p.releaseAt || 0.44);
        if (input.shootReleased || !input.shootHeld || p.meter >= 1.45) this.releaseLayup(p);
      } else if (p.action === a && !p.released && p.actionT >= (p.releaseAt || p.actionDur * 0.55)) {
        p.released = true;
        if (a === 'dunk') {
          // Hang on the rim if made
          this.resolveShot(p, 'dunk');
          if (this.ball.shot && this.ball.shot.make) {
            if ((p.dunkStyle === 'contact' && chance(0.45)) || p.r.dunk < 70) {
              // Through the defender: sometimes no hang, slam it through and come straight down
              this.setAction(p, 'hang', 0.24);
              p.hangY = Math.max(0.4, p.y - 1.6);
            } else {
              this.setAction(p, 'hang', 0.65);
              // Hands on the rim: pull down from the top of the jump into a full straight-arm hang, body
              // hanging below the rim (not perched up at it)
              p.hangY = RIM_Y + 0.05 - reachOf(p.heightFt);
              p.y = Math.max(p.y, p.hangY);
            }
            this.emit('dunk', { p }); this.bc(p, 'posterizer');
          }
        } else this.resolveShot(p, 'layup');
      }
    }
    if (a === 'hang' && p.actionT >= p.actionDur) { this.setAction(p, 'land', 0.5); p.released = true; p.vy = p.dunkStyle === 'contact' ? -9 : -2; p.y = Math.max(0.01, p.y); }
  }

  inPaint(p, team) {
    return COURT_HALF_L - this.dir(team) * p.pos.x < 19 && Math.abs(p.pos.z) < 8;
  }
  laneXZ(x, z, team) { return inLane(COURT_HALF_L - this.dir(team) * x, z); }
  // The defender allowed to protect the rim: the one guarding the off-ball man closest to the basket
  laneAnchor() {
    if (this._anchorT === this.time) return this._anchor;
    this._anchorT = this.time;
    let best = null, bd = 1e9;
    for (const q of this.players) {
      if (q.benched || q.team !== this.offense || q.hasBall) continue;
      const d = this.distHoop(q);
      const def = this.opp(q);
      if (def && !def.benched && d < bd) { bd = d; best = def; }
    }
    this._anchor = best;
    return best;
  }

  // Offensive three seconds: no camping in the lane while your team has the ball
  checkThreeSeconds(dt) {
    const b = this.ball;
    const counting = this.phase === 'live' && !this.inb && (b.state === 'held' || b.state === 'pass') && b.lastTouch === this.offense;
    for (const p of this.players) {
      if (p.benched || p.team !== this.offense || !counting || !this.inPaint(p, p.team) || ['shoot', 'layup', 'dunk', 'hang'].includes(p.action)) { p.paintT = 0; p.paintWarned = false; continue; }
      p.paintT = (p.paintT || 0) + dt;
      if (p.isUser && p.paintT > 2 && !p.paintWarned) { p.paintWarned = true; this.emit('call', { text: 'GET OUT OF THE PAINT!' }); }
      if (p.paintT > 3) {
        p.paintT = 0;
        p.stats.tov++;
        if (p.isUser) this.addGrade(-2, '3 seconds');
        this.emit('whistle', { text: 'THREE SECONDS' });
        const ftx = this.dir(this.offense) * (COURT_HALF_L - 19);
        this.inbound(1 - this.offense, 1.2, this.sidelineSpot({ x: ftx, z: p.pos.z }));
        return;
      }
    }
  }

  checkBlock(shooter) {
    for (const q of this.players) {
      if (q.team === shooter.team || q.y < 0.8 || q.benched) continue;
      const d = len(q.pos.x - shooter.pos.x, q.pos.z - shooter.pos.z);
      if (d > 4.2) continue;
      if (q.blockChecked === shooter.shotId) continue;
      q.blockChecked = shooter.shotId;
      // Bodies meet in the air on a close block attempt
      if (d < 3.3) {
        this.knock(shooter, q.pos, 2.5, null);
        this.knock(q, shooter.pos, 2, null);
      }
      const reach = q.heightFt * 1.3 + q.y;
      const sReach = shooter.heightFt * 1.3 + shooter.y;
      let pb = 0.05 + (q.r.block - 50) / 170 + (reach - sReach) * 0.06 + (shooter.action === 'shoot' ? -0.03 : 0.03) + this.bt(q, 'rimProtector') * 0.03;
      // Chase-down: the shooter can't see you coming
      if (this.isBehind(q, shooter) && (shooter.action === 'layup' || shooter.action === 'dunk')) pb += 0.1;
      // Dunks are hard to block from the front: the ball is already over the rim
      else if (shooter.action === 'dunk') pb *= 0.5 - clamp((shooter.r.dunk - 60) / 200, 0, 0.2);
      if (shooter.isUser) pb *= [0.5, 0.8, 1, 1.15][this.diff] * (1 + this.heat * 0.4);
      if (this.toIs(shooter, 'finishing') && shooter.action !== 'shoot') pb *= 0.5;
      if (this.toIs(q, 'lockdown')) pb += 0.08; else if (this.toIs(q, 'glass')) pb += 0.04;
      pb = clamp(pb, 0.02, q.isUser ? 0.45 : 0.3);
      if (chance(pb)) { this.blockShot(q, shooter); return true; }
    }
    return false;
  }

  blockShot(def, shooter) {
    shooter.released = true;
    def.swatT = this.time;
    this.toGain(def, 0.18, 'lockdown'); this.toGain(shooter, -0.04); this.goatHit(def, 'defense');
    const chaseDown = this.isBehind(def, shooter) && (shooter.action === 'layup' || shooter.action === 'dunk');
    const close = this.distHoop(shooter) < 12;
    const snatchP = clamp(0.08 + (def.r.block - 60) / 110 + (close ? 0.08 : 0) + this.bt(def, 'rimProtector') * 0.04, 0, 0.45);
    if (!chaseDown && def.r.block >= 60 && chance(snatchP)) {
      // Snatch block: rip it out of the air and keep it
      def.stats.blk++; shooter.stats.fga++; this.bc(def, 'rimProtector');
      if (def.isUser) this.addGrade(3, 'Snatch block');
      if (shooter.isUser) this.addGrade(-1, 'Got blocked');
      def.snatchT = this.time;
      shooter.hitT = Math.max(shooter.hitT, 0.35);
      this.giveBall(def, true);
      this.emit('block', { def, shooter, type: 'snatch' });
      return;
    }
    if (chaseDown) def.blockStyle = 'chase';
    shooter.hitT = Math.max(shooter.hitT, 0.35);
    def.stats.blk++; this.bc(def, 'rimProtector');
    shooter.stats.fga++;
    if (def.isUser) this.addGrade(2.5, 'Block');
    if (shooter.isUser) this.addGrade(-1, 'Got blocked');
    for (const q of this.players) q.hasBall = false;
    const b = this.ball;
    b.holder = null; b.state = 'loose'; b.lastTouch = def.team; b.rimmed = true;
    b.noGrab = { p: shooter, until: this.time + 0.6, all: this.time + 0.15 };
    const start = b.vis ? { ...b.vis } : { x: shooter.pos.x, y: shooter.heightFt + 1 + shooter.y, z: shooter.pos.z };
    // The swat happens where the blocker's hand meets the ball: pull the ball to within the blocker's reach
    const shY = def.y + 0.78 * def.heightFt - 0.2, armL = (reachOf(def.heightFt) - (0.81 * def.heightFt - 0.2)) * 0.7;
    const ox = start.x - def.pos.x, oy = start.y - shY, oz = start.z - def.pos.z, ol = Math.hypot(ox, oy, oz) || 1;
    if (ol > armL) {
      // Out of reach: the blocker closes the gap horizontally (bodies collide), the rest of the way the ball comes to them
      const hz = Math.hypot(ox, oz) || 1;
      let close = Math.min(hz - 1.2, Math.max(0, ol - armL));
      // Never through the shooter (a chase-down's ball is on the far side of him): stop 2 ft short of his body
      const stopAt = t => len(def.pos.x + ox / hz * t - shooter.pos.x, def.pos.z + oz / hz * t - shooter.pos.z);
      while (close > 0 && stopAt(close) < 2.0) close -= 0.1;
      if (close > 0) { def.pos.x += ox / hz * close; def.pos.z += oz / hz * close; }
      // Still short: he gets up higher to it (the hand goes to the ball, the ball stays in the shooter's hands)
      let rx = start.x - def.pos.x, rz = start.z - def.pos.z, oy2 = start.y - shY, rl = Math.hypot(rx, oy2, rz) || 1;
      if (rl > armL && oy2 > 0) {
        const hz2 = Math.hypot(rx, rz), needY = Math.sqrt(Math.max(0, armL * armL - hz2 * hz2));
        const lift = Math.min(1.4, oy2 - needY);
        if (lift > 0) { def.y += lift; oy2 -= lift; rl = Math.hypot(rx, oy2, rz) || 1; }
      }
      // Whatever is left (rare) is a few inches: meet in the middle
      if (rl > armL) { const f = armL / rl, shY2 = start.y - oy2; start.x = def.pos.x + rx * f; start.y = shY2 + oy2 * f; start.z = def.pos.z + rz * f; }
    }
    b.pos = start;
    b.vis = { ...start };
    const dx = shooter.pos.x - def.pos.x, dz = shooter.pos.z - def.pos.z, l = len(dx, dz) || 1;
    if (chaseDown) {
      // Pinned off the glass: ball drops back into play
      const h = this.hoopOf(shooter.team);
      b.vel = { x: Math.sign(h.x) * 8, y: 4, z: rand(-2, 2) };
    } else b.vel = { x: dx / l * rand(10, 18), y: rand(2, 8), z: dz / l * rand(10, 18) + rand(-4, 4) };
    this.shotClock = Math.max(this.shotClock, 1);
    this.emit('block', { def, shooter, type: chaseDown ? 'chase' : 'swat' });
    this.maybeScuffle(shooter, def, 0.2);
  }

  charge(handler, def) {
    handler.stats.tov++; handler.stats.pf++;
    if (handler.isUser) this.addGrade(-3, 'Offensive foul');
    if (def.isUser) this.addGrade(2.5, 'Took a charge');
    this.knock(def, handler.pos, 10, 'posterfall', 1.5);
    this.emit('whistle', { text: 'OFFENSIVE FOUL', foul: true });
    this.emit('charge', { handler, def });
    this.inbound(def.team, 1.3, this.sidelineSpot(handler.pos));
  }

  collide() {
    const ps = this.players.filter(p => !p.benched);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j];
      const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
      const d = len(dx, dz);
      const min = 2.1;
      if (d >= min || d < 0.0001) continue;
      if (this.isDown(a) || this.isDown(c)) continue;
      const nx = dx / d, nz = dz / d, o = min - d;
      const scr = a.screen && a.screen.state === 'set' ? a : c.screen && c.screen.state === 'set' ? c : null;
      if (scr && a.team !== c.team) {
        const other = scr === a ? c : a;
        if (other.stun <= 0 && other.y === 0 && !other.hasBall && this.time - (scr.screenHit || -9) > 1.2) {
          scr.screenHit = this.time;
          this.setAction(other, 'bump', 0.5); other.stun = 0.75 + this.bt(scr, 'brickWall') * 0.15; this.bc(scr, 'brickWall');
          this.knock(other, scr.pos, 3, null);
          this.emit('screen', { screener: scr, def: other });
          if (scr.isUser) this.addGrade(1.5, 'Good screen');
        }
        // The screener holds their ground
        if (scr === a) { c.pos.x += nx * o; c.pos.z += nz * o; } else { a.pos.x -= nx * o; a.pos.z -= nz * o; }
        continue;
      }
      let wa = 0.5, wc = 0.5;
      const handler = a.hasBall ? a : c.hasBall ? c : null;
      if (handler && a.team !== c.team) {
        const def = handler === a ? c : a;
        if (def.stun > 0) continue;
        const pw = (this.style.power && handler.isUser) ? 20 : 0;
        const ratio = clamp(0.5 + (def.r.strength - handler.r.strength - pw) / 120, 0.25, 0.8);
        if (handler === a) { wa = ratio; wc = 1 - ratio; } else { wc = ratio; wa = 1 - ratio; }
        // Body-up: bleed handler speed into the defender (a much stronger handler barely slows down)
        const hv = handler.vel, sgn = handler === a ? 1 : -1;
        const into = (hv.x * nx + hv.z * nz) * sgn;
        const edge = handler.r.strength + pw * 0.75 - def.r.strength; // strength advantage
        if (into > 0) { const bleed = clamp(0.6 - edge / 60, 0.1, 0.75); hv.x -= nx * sgn * into * bleed; hv.z -= nz * sgn * into * bleed; }
        // Stronger handler dribbling into his man: bumps him off and keeps going
        if (this.phase === 'live' && edge >= 10 && into > 4 && def.y === 0 && !def.action && !handler.action && this.time - (handler.contactT || -9) > 0.7) {
          handler.contactT = this.time;
          this.knock(def, handler.pos, 4 + edge / 6, 'bump', 0.45 + Math.min(0.35, edge / 80));
          def.stun = Math.max(def.stun, 0.35 + edge / 100);
          this.emit('contact', { p: handler, power: 3 + edge / 10 });
          if (handler.isUser) this.bc(handler, 'bully', 0.5);
        }
        // The stronger player holds his line and the bodies separate by moving the weaker one
        if (edge >= 10) { const r2 = clamp(0.5 - edge / 70, 0.1, 0.5); if (handler === a) { wa = r2; wc = 1 - r2; } else { wc = r2; wa = 1 - r2; } }
        // Hard drive into a set defender: contact, sometimes a charge
        if (this.phase === 'live' && into > 12 && len(def.vel.x, def.vel.z) < 5 && def.y === 0 && !def.action && !handler.post && handler.action !== 'dunk'
          && this.time - (handler.contactT || -9) > 0.9) {
          handler.contactT = this.time;
          if (chance(0.09 + (def.r.intD - 60) / 400 + this.bt(def, 'brickWall') * 0.02)) { this.bc(def, 'brickWall', 2); this.charge(handler, def); return; }
          this.knock(def, handler.pos, 5, 'bump', 0.4);
          this.knock(handler, def.pos, 4, 'bump', 0.3);
        }
      }
      // Off the ball: a stronger offensive player moving through his defender knocks him off his spot
      if (!handler && a.team !== c.team && this.phase === 'live') {
        const off = a.team === this.offense ? a : c, dfn = off === a ? c : a, sg = off === a ? 1 : -1;
        const into2 = (off.vel.x * nx + off.vel.z * nz) * sg, edge2 = off.r.strength - dfn.r.strength;
        if (edge2 >= 12 && into2 > 6 && !dfn.action && dfn.y === 0 && this.time - (off.contactT || -9) > 1.0) {
          off.contactT = this.time;
          this.knock(dfn, off.pos, 3 + edge2 / 8, 'bump', 0.4);
          dfn.stun = Math.max(dfn.stun, 0.3);
          wa = off === a ? 0.15 : 0.85; wc = 1 - wa;
        }
      }
      a.pos.x -= nx * o * wa; a.pos.z -= nz * o * wa;
      c.pos.x += nx * o * wc; c.pos.z += nz * o * wc;
    }
  }

  // ---------- ball ----------
  updateBall(dt) {
    const b = this.ball;
    if (b.state === 'held' && b.holder) {
      const p = b.holder;
      b.pos.x = p.pos.x + Math.sin(p.facing) * 1; b.pos.z = p.pos.z + Math.cos(p.facing) * 1; b.pos.y = 3.5 + p.y;
      return;
    }
    if (b.state === 'shot') {
      const s = b.shot;
      s.t += dt;
      b.vel.y -= G_BALL * dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      // Blocks on the way up
      if (s.blockable && s.t < 0.22 && s.kind !== 'dunk') {
        for (const q of this.players) {
          if (q.team === s.shooter.team || q.y < 0.8) continue;
          if (q.blockChecked === s.shooter.shotId) continue;
          const d = len(q.pos.x - b.pos.x, q.pos.z - b.pos.z);
          if (d < 2.6 && b.pos.y < q.heightFt * 1.3 + q.y + 0.5) {
            q.blockChecked = s.shooter.shotId;
            if (chance(clamp(0.05 + (q.r.block - 50) / 200 + this.bt(q, 'rimProtector') * 0.025, 0.02, q.isUser ? 0.35 : 0.18))) {
              s.shooter.stats.fga--; // blockShot re-adds
              this.blockShot(q, s.shooter);
              return;
            }
          }
        }
      }
      if (s.t >= s.T) this.shotResult();
      return;
    }
    if (b.state === 'net') {
      b.netT += dt;
      b.vel.y -= G_BALL * dt * 0.5;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      if (b.pos.y < 0.4) { b.pos.y = 0.4; b.vel.y = Math.abs(b.vel.y) * 0.5; b.vel.x *= 0.7; b.vel.z *= 0.7; }
      return;
    }
    if (b.state === 'dead') {
      b.vel.y -= G_BALL * dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      if (b.pos.y < 0.4) { b.pos.y = 0.4; b.vel.y = Math.abs(b.vel.y) * 0.5; b.vel.x *= 0.7; b.vel.z *= 0.7; if (Math.abs(b.vel.y) < 1) b.vel.y = 0; }
      return;
    }
    if (b.state === 'pass') {
      const ps = b.pass;
      ps.t += dt;
      // Passes home in on the receiver so they don't sail out of bounds
      const rr = ps.to;
      if (rr && !ps.lob && !rr.benched) {
        const tr = Math.max(0.06, ps.T - ps.t);
        const tx = rr.pos.x + rr.vel.x * tr * 0.5, tz = rr.pos.z + rr.vel.z * tr * 0.5;
        const k = Math.min(1, dt * 9);
        b.vel.x += ((tx - b.pos.x) / tr - b.vel.x) * k;
        b.vel.z += ((tz - b.pos.z) / tr - b.vel.z) * k;
        const hs = len(b.vel.x, b.vel.z);
        if (hs > 75) { b.vel.x *= 75 / hs; b.vel.z *= 75 / hs; }
        if (ps.t > ps.T * 0.85 && b.pos.y < 4) b.vel.y = Math.max(b.vel.y, (4.2 - b.pos.y) * 5);
      }
      b.vel.y -= G_BALL * dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      // Interceptions
      if (!ps.noIntercept && ps.t > 0.08) {
        for (const q of this.players) {
          if (q.team === b.lastTouch || ps.checked.has(q) || q.benched || q.stun > 0) continue;
          const d = len(q.pos.x - b.pos.x, q.pos.z - b.pos.z);
          if (d < 2.2 && b.pos.y < q.heightFt * 1.25 + q.y) {
            ps.checked.add(q);
            let pi = 0.22 + (q.r.steal - 50) / 160 - (ps.from ? (ps.from.r.pass - 50) / 260 : 0);
            if (ps.lob) pi *= 0.4;
            if (q.isUser) pi += 0.12 + this.bt(q, 'interceptor') * 0.04;
            if (ps.from && ps.from.isUser) pi *= 1 - this.bt(ps.from, 'needle') * 0.15;
            if (ps.to && ps.to.isUser) pi *= 0.7;
            if (this.toIs(ps.from, 'playmaking')) pi *= 0.35;
            if (this.toIs(q, 'lockdown')) pi += 0.1;
            if (chance(clamp(pi, 0.03, 0.55))) {
              if (ps.from) { ps.from.stats.tov++; if (ps.from.isUser) this.addGrade(-3, 'Turnover'); }
              q.stats.stl++; this.bc(q, 'interceptor');
              this.toGain(q, 0.18, 'lockdown'); this.toGain(ps.from, -0.08); this.goatHit(q, 'defense');
              if (q.isUser) this.addGrade(2.5, 'Steal');
              this.emit('steal', { def: q, h: ps.from, intercept: true });
              this.giveBall(q, false);
              return;
            }
          }
        }
      }
      // Catch
      const r = ps.to;
      if (r && !r.benched) {
        const d = len(r.pos.x - b.pos.x, r.pos.z - b.pos.z);
        const reach = r.heightFt * 1.25 + r.y + 1;
        if (ps.lob && r.isUser || ps.lob && d < 3) {
          if (d < 3.2 && b.pos.y < RIM_Y + 2.5 && ps.t > ps.T * 0.6) { this.alleyOop(r, ps.from); return; }
        } else if ((d < 3.4 && b.pos.y < reach && ps.t > 0.06) || (d < 5 && ps.t > ps.T + 0.1)) {
          this.giveBall(r, true);
          r.lastPassFrom = ps.from; r.catchT = this.time;
          if (ps.from && ps.from.isUser) this.bc(ps.from, 'needle');
          if (r.lobPt) r.lobPt = null;
          return;
        }
      }
      if (ps.t > ps.T + 0.8 || b.pos.y < 0.5) { b.state = 'loose'; if (r) r.lobPt = null; }
      return;
    }
    if (b.state === 'loose') {
      b.vel.y -= G_BALL * dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      // Backboard
      for (const s of [-1, 1]) {
        if (Math.abs(b.pos.z) < 3 && b.pos.y > 9 && b.pos.y < 12.5 && s * b.pos.x > 42.6 && s * b.pos.x < 43.4 && s * b.vel.x > 0) {
          b.vel.x = -b.vel.x * 0.6; b.pos.x = s * 42.6;
        }
      }
      if (b.pos.y < 0.4) {
        b.pos.y = 0.4;
        b.vel.y = Math.abs(b.vel.y) > 3 ? -b.vel.y * 0.6 : 0;
        b.vel.x *= 0.8; b.vel.z *= 0.8;
        if (b.vel.y > 0) this.emit('bounce', {});
      }
      if (b.stealT > 0) b.stealT -= dt;
      // Out of bounds
      if (Math.abs(b.pos.x) > 47.5 || Math.abs(b.pos.z) > 25.5) {
        this.emit('whistle', { text: 'OUT OF BOUNDS' });
        const base = Math.abs(b.pos.x) > 47.5;
        this.inbound(1 - b.lastTouch, 1.2, base ? { x: Math.sign(b.pos.x) * 48.6, z: clamp(b.pos.z, -20, 20) } : this.sidelineSpot(b.pos));
        return;
      }
      // Pickup
      let cands = [];
      for (const p of this.players) {
        if (p.benched || p.stun > 0 || this.isDown(p)) continue;
        if (b.noGrab && (this.time < b.noGrab.all || (p === b.noGrab.p && this.time < b.noGrab.until))) continue;
        const d = len(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
        const reach = p.heightFt * 1.28 + p.y + 0.6;
        if (d < 2.6 && b.pos.y < reach) cands.push(p);
      }
      if (cands.length) {
        // Weighted by rebounding; defense gets box-out advantage
        let tot = 0;
        const shootingTeam = this.offense;
        const u = this.user;
        const boxed = u && u.boxing ? u.boxTarget : null;
        const w = cands.map(p => {
          let v = (p.r.reb + 20) * (p.team !== shootingTeam ? 1.4 : 1) * (p.isUser ? 1.2 : 1) * (b.stealer === p && b.stealT > 0 ? 6 : 1);
          if (p.boxing) v *= 1.8;
          v *= 1 + this.bt(p, 'rebound') * 0.15;
          if (this.toIs(p, 'glass')) v *= 2.2;
          if (p === boxed && len(u.pos.x - p.pos.x, u.pos.z - p.pos.z) < 4) v *= 0.4;
          tot += v; return v;
        });
        if (chance(Math.min(1, dt * 14))) {
          let r = Math.random() * tot, pick = cands[0];
          for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { pick = cands[i]; break; } }
          this.grab(pick);
        }
      }
    }
  }

  grab(p) {
    const b = this.ball;
    const wasShot = b.rimmed;
    const off = p.team === this.offense;
    if (wasShot) {
      p.stats.reb++; if (off) p.stats.oreb++; this.bc(p, 'rebound');
      this.toGain(p, off ? 0.1 : 0.07, 'glass'); this.goatHit(p, 'rebounding');
      if (p.isUser) this.addGrade(off ? 2 : 1.5, off ? 'Offensive rebound' : 'Rebound');
      this.emit('rebound', { p, off });
    }
    b.rimmed = false;
    b.stealer = null;
    this.giveBall(p, true);
    if (off && wasShot) this.shotClock = 14;
  }

  alleyOop(r, from) {
    // Receiver finishes at the rim in the air
    const b = this.ball;
    this.giveBall(r, true);
    r.lobPt = null;
    r.lastPassFrom = from; r.catchT = this.time;
    this.setAction(r, 'dunk', 0.6);
    r.actionT = 0.25; r.releaseAt = 0.32; r.jumped = true; r.released = false;
    r.dunkStyle = chance(0.5) ? 'two' : 'one'; r.post = false; r.jumpAtF = 0.2; r.extraHops = false;
    r.y = Math.max(r.y, RIM_Y + 0.6 - reachOf(r.heightFt));
    r.vy = 3;
    const h = this.hoopOf(r.team);
    r.finishPt = { x: h.x - this.dir(r.team) * 1.4, z: r.pos.z * 0.2 };
    this.emit('alleyoop', { p: r });
    void b;
  }

  // ---------- summary ----------
  boxScore() {
    return this.players.map(p => ({ name: p.name, team: p.team, pos: p.position, isUser: p.isUser, ...p.stats }));
  }
}
