// MyCareer state machine: showcase → draft → (G League) → NBA → playoffs → Finals.
import { GOAT_SKILLS, GOAT_TIERS, goatTier, NBA_COMPS, STYLE_ADJ, STYLE_NOUN, CAP_FLOOR, CAP_BUDGET, ANIMS, animFor, animAllowed, TEAMS, SHOWCASE_TEAMS, GLEAGUE_NICKS, POSITIONS, POS_ORDER, PLAYSTYLES, ATTRS, SKIN_TONES, HAIR, BUILDS, HEIGHT_MODS, BADGES, badgeTier, heightIn, HS_TEAMS, COLLEGES,
  buildRatings, overall, randName, clamp, gradeLetter, upgradeCost, attrCap } from './data.js';

const SAVE_KEY = 'hoops.career.v1';
const SETTINGS_KEY = 'hoops.settings.v1';

export const DEFAULT_SETTINGS = { qLen: 3, difficulty: 1, seasonLength: 16, seriesLen: 'short', quality: 'high', defAssist: false, camera: '2k', replays: true, sound: true, vibrate: true, maxed: false };

// Infinite AP + all badges (Hall of Fame) while on. Doesn't touch the save, so turning it off restores real progress.
let maxed = false;
export function setMaxed(v) { maxed = !!v; }
export function isMaxed() { return maxed; }

export function loadSettings() {
  try {
    const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) };
    // v3: back to the first 2K camera
    if (!s.v3) { s.camera = '2k'; s.v3 = true; saveSettings(s); }
    return s;
  }
  catch (e) { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
export function loadCareer() { try { const c = JSON.parse(localStorage.getItem(SAVE_KEY)); if (c) migrate(c); return c; } catch (e) { return null; } }
// Older saves: give them VC, an animation locker that matches what they had picked, and tasks
function migrate(c) {
  if (c.vc == null) c.vc = 0;
  if (!c.anims) initAnims(c);
}
export function saveCareer(c) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ } }
export function deleteCareer() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function teamById(id, c) {
  if (id >= 100 && id < 200) return SHOWCASE_TEAMS.find(t => t.id === id);
  if (id >= 200) return c.gleague.teams.find(t => t.id === id);
  return TEAMS[id];
}

function tuneToOverall(r, pos, target) {
  for (let i = 0; i < 4; i++) {
    const diff = target - overall(r, pos);
    if (Math.abs(diff) < 1) break;
    for (const k in r) r[k] = clamp(Math.round(r[k] + diff), 25, 99);
  }
  return r;
}

export function generateRoster(teamId, teamOvr, seed) {
  const rng = mulberry(teamId * 7919 + seed * 104729);
  const styles = Object.keys(PLAYSTYLES);
  return POS_ORDER.map((pos, i) => {
    const style = styles[Math.floor(rng() * styles.length)];
    const ovr = Math.round(teamOvr + (i === 0 || i === 2 ? 2 : 0) + (rng() - 0.5) * 6);
    const r = tuneToOverall(buildRatings(pos, style, 60, rng, 5), pos, ovr);
    return {
      name: randName(rng), num: Math.floor(rng() * 45) + 0, position: pos, ratings: r, ovr,
      heightFt: POSITIONS[pos].height + (rng() - 0.5) * 0.6,
      build: rng() < 0.25 ? 'slim' : rng() < 0.7 ? 'athletic' : 'strong',
      skin: SKIN_TONES[Math.floor(rng() * SKIN_TONES.length)], hair: HAIR[Math.floor(rng() * HAIR.length)],
      shoe: rng() < 0.5 ? '#f2f2f2' : '#1a1a1a',
    };
  });
}

export const START_OVR = 40;

export function startingRatings(pos, style, rng = Math.random, inches = null, build = 'athletic', target = START_OVR, caps = null) {
  const r = buildRatings(pos, style, 40, rng, 2);
  const dIn = inches == null ? 0 : inches - heightIn(POSITIONS[pos].height);
  for (const k in HEIGHT_MODS) r[k] = clamp(Math.round(r[k] + HEIGHT_MODS[k] * dIn), 25, 99);
  const bm = (BUILDS[build] || BUILDS.athletic).mods;
  for (const k in bm) r[k] = clamp(r[k] + bm[k], 25, 99);
  const inch = inches == null ? heightIn(POSITIONS[pos].height) : inches;
  if (caps) {
    // Your potential shapes where you start: high-potential attributes start ahead of the rest
    const mean = Object.values(caps).reduce((a, b) => a + b, 0) / Object.keys(caps).length;
    for (const k in r) if (caps[k] != null) r[k] = clamp(Math.round(r[k] + (caps[k] - mean) * 0.5), 25, 99);
  }
  const out = tuneToOverall(r, pos, target);
  for (const k in out) out[k] = Math.min(out[k], attrCap(k, inch, build), caps && caps[k] != null ? caps[k] : 99);
  return out;
}

// ---------- Builds: attribute potential ----------
// The most each attribute can reach for this body
export function capMaxes(inches, build) {
  const m = {};
  for (const a of ATTRS) m[a.key] = attrCap(a.key, inches, build);
  return m;
}
export function capsSpent(caps) { return ATTRS.reduce((t, a) => t + Math.max(0, (caps[a.key] ?? CAP_FLOOR) - CAP_FLOOR), 0); }
// An archetype's potential: the budget spread by what the position and playstyle lean on
export function capsForStyle(pos, style, inches, build) {
  const pm = POSITIONS[pos].mods, sm = PLAYSTYLES[style].mods, mx = capMaxes(inches, build);
  const w = {};
  for (const a of ATTRS) w[a.key] = Math.max(0.2, 1 + ((pm[a.key] || 0) + (sm[a.key] || 0) * 1.6) / 10);
  const caps = {};
  for (const a of ATTRS) caps[a.key] = CAP_FLOOR;
  let left = CAP_BUDGET;
  for (let it = 0; it < 8 && left > 0.5; it++) {
    const open = ATTRS.filter(a => caps[a.key] < mx[a.key]);
    const tw = open.reduce((t, a) => t + w[a.key], 0);
    if (!tw) break;
    let used = 0;
    for (const a of open) { const add = Math.min(mx[a.key] - caps[a.key], left * w[a.key] / tw); caps[a.key] += add; used += add; }
    left -= used;
  }
  for (const a of ATTRS) caps[a.key] = Math.min(mx[a.key], Math.floor(caps[a.key]));
  return caps;
}
// What a set of potentials plays like: main archetype, secondary, a build name and an NBA comparison
export function describeBuild(pos, caps) {
  const vals = ATTRS.map(a => caps[a.key] ?? CAP_FLOOR);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const score = {};
  for (const [k, s] of Object.entries(PLAYSTYLES)) {
    let t = 0, n = 0;
    for (const [attr, m] of Object.entries(s.mods)) { t += ((caps[attr] ?? CAP_FLOOR) - mean) * m; n += m; }
    score[k] = t / n;
  }
  const order = Object.keys(score).sort((a, b) => score[b] - score[a]);
  const [primary, secondary] = order;
  const name = `${STYLE_ADJ[secondary]} ${STYLE_NOUN[primary]}`;
  return { style: primary, secondary, name, comp: NBA_COMPS[pos][primary] };
}

// ---------- Animations + VC ----------
const ANIM_CAT_KEYS = { jumpshot: 'jumpshot', dribble: 'dribble', dunk: 'dunkPkg', defense: 'defStance' };
export function initAnims(c) {
  const P = c.player;
  const owned = ANIMS.filter(a => !a.vc || (a.base && a.base.includes(P.position))).map(a => a.id);
  const pick = (cat, key) => (ANIMS.find(a => a.cat === cat && a.key === key && owned.includes(a.id)) || ANIMS.find(a => a.cat === cat && !a.vc)).id;
  // Old saves picked a dribble style and jumpshot directly: keep them owned and equipped
  for (const [cat, key] of [['dribble', P.dribble], ['jumpshot', P.jumpshot]]) {
    const a = ANIMS.find(x => x.cat === cat && x.key === key);
    if (a && !owned.includes(a.id)) owned.push(a.id);
  }
  c.anims = {
    owned,
    equipped: { jumpshot: pick('jumpshot', P.jumpshot || 'standard'), dribble: pick('dribble', P.dribble || (['PF', 'C'].includes(P.position) ? 'power' : 'quick')), dunk: 'dk_standard', defense: 'df_standard' },
    recent: [],
  };
  if (c.vc == null) c.vc = 0;
  checkAnimUnlocks(c);
  for (const r of c.anims.recent) r.seen = true; // nothing is "new" on day one
}
export function animMet(c, a) { return Object.entries(a.req || {}).every(([k, v]) => (c.player.ratings[k] || 0) >= v); }
// Unlock everything whose attribute requirements you now meet; returns the newly unlocked animations
export function checkAnimUnlocks(c) {
  const A = c.anims, pos = c.player.position, out = [];
  for (const a of ANIMS) {
    if (A.owned.includes(a.id) || !animAllowed(a, pos) || !animMet(c, a)) continue;
    A.owned.push(a.id); out.push(a);
    A.recent.unshift({ id: a.id, how: 'stat', seen: false });
  }
  A.recent = A.recent.slice(0, 12);
  return out;
}
export function buyAnim(c, id) {
  const a = animFor(id), A = c.anims;
  if (!a || A.owned.includes(id) || !animAllowed(a, c.player.position) || c.vc < a.vc) return false;
  c.vc -= a.vc; A.owned.push(id);
  A.recent.unshift({ id, how: 'vc', seen: false }); A.recent = A.recent.slice(0, 12);
  return true;
}
export function equipAnim(c, id) {
  const a = animFor(id);
  if (!a || !c.anims.owned.includes(id) || !animAllowed(a, c.player.position)) return false;
  c.anims.equipped[a.cat] = id;
  if (a.cat === 'dribble') c.player.dribble = a.key;
  if (a.cat === 'jumpshot') c.player.jumpshot = a.key;
  return true;
}
// Equipped animations as game options
export function animOpts(c) {
  const out = {};
  for (const [cat, opt] of Object.entries(ANIM_CAT_KEYS)) { const a = animFor(c.anims.equipped[cat]); if (a) out[opt] = a.key; }
  return { dribbleStyle: out.dribble, jumpshot: out.jumpshot, dunkPkg: out.dunkPkg, defStance: out.defStance };
}
export function goatTierOf(c) { const k = c.player.goat; return k ? (maxed ? GOAT_TIERS.length - 1 : goatTier((c.goatProg || {})[k])) : 0; }
export function newAnimCount(c) { return c.anims ? c.anims.recent.filter(r => !r.seen).length : 0; }

// ---------- Lifetime goals ----------
// Your games are shorter than real ones, so stats are scaled to full NBA games (12-minute quarters) and, for
// career totals, full 82-game seasons before they're compared with the legends. Career totals count NBA games.
export const LIFE_GOALS = [
  { id: 'g_pts', label: 'Points in a game', kind: 'game', stat: 'pts', tiers: [[40], [60], [81, 'Kobe Bryant'], [100, 'Wilt Chamberlain']] },
  { id: 'g_reb', label: 'Rebounds in a game', kind: 'game', stat: 'reb', tiers: [[20], [30], [55, 'Wilt Chamberlain']] },
  { id: 'g_ast', label: 'Assists in a game', kind: 'game', stat: 'ast', tiers: [[15], [20], [30, 'Scott Skiles']] },
  { id: 'g_tpm', label: 'Threes in a game', kind: 'game', stat: 'tpm', tiers: [[7], [10], [14, 'Klay Thompson']] },
  { id: 'g_blk', label: 'Blocks in a game', kind: 'game', stat: 'blk', tiers: [[6], [10], [17, 'Elmore Smith']] },
  { id: 'c_pts', label: 'Career points', kind: 'career', stat: 'pts', tiers: [[5000], [15000], [32292, 'Michael Jordan'], [38387, 'Kareem Abdul-Jabbar']] },
  { id: 'c_reb', label: 'Career rebounds', kind: 'career', stat: 'reb', tiers: [[3000], [10000], [23924, 'Wilt Chamberlain']] },
  { id: 'c_ast', label: 'Career assists', kind: 'career', stat: 'ast', tiers: [[2000], [8000], [15806, 'John Stockton']] },
  { id: 'c_tpm', label: 'Career threes', kind: 'career', stat: 'tpm', tiers: [[500], [2000], [3747, 'Ray Allen → Stephen Curry']] },
  { id: 'c_blk', label: 'Career blocks', kind: 'career', stat: 'blk', tiers: [[500], [2000], [3830, 'Hakeem Olajuwon']] },
  { id: 'c_stl', label: 'Career steals', kind: 'career', stat: 'stl', tiers: [[500], [1500], [3265, 'John Stockton']] },
  { id: 'rings', label: 'Championship rings', kind: 'count', stat: 'rings', tiers: [[1], [3], [6, 'Michael Jordan'], [11, 'Bill Russell']] },
  { id: 'fmvp', label: 'Finals MVPs', kind: 'count', stat: 'fmvp', tiers: [[1], [3, 'Kevin Durant'], [6, 'Michael Jordan']] },
];
function lifeValue(c, g) {
  const L = c.life || {};
  if (g.kind === 'game') return Math.round((L.best || {})[g.stat] || 0);
  if (g.kind === 'career') return Math.round((L.career || {})[g.stat] || 0);
  if (g.stat === 'rings') return c.awards.filter(a => /NBA Champion$/.test(a)).length;
  return c.awards.filter(a => /Finals MVP/.test(a)).length;
}
export function lifeGoals(c) {
  return LIFE_GOALS.map(g => {
    const v = lifeValue(c, g), done = (c.life && c.life.done && c.life.done[g.id]) || 0;
    return { ...g, value: v, done, next: g.tiers[done] || null };
  });
}
// Record a game and pay out any goal tiers just reached. Returns [{label, n, who, ap, vc}]
function updateLifeGoals(c, s, scale) {
  if (!c.life || c.life.v !== 2) c.life = { v: 2, best: {}, career: {}, done: {} }; // (pre-NBA records from older builds are wiped)
  const L = c.life, perGame = 12 / Math.max(1, scale.q || 3), perSeason = 82 / Math.max(1, scale.season || 29);
  // Lifetime goals are an NBA thing: high school, college and G League games don't count
  if (!(c.nba && (c.phase === 'nba' || c.phase === 'playoffs'))) return [];
  for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm']) {
    L.best[k] = Math.max(L.best[k] || 0, (s[k] || 0) * perGame);
    L.career[k] = (L.career[k] || 0) + (s[k] || 0) * perGame * perSeason;
  }
  const out = [];
  for (const g of LIFE_GOALS) {
    const v = lifeValue(c, g);
    while ((L.done[g.id] || 0) < g.tiers.length && v >= g.tiers[L.done[g.id] || 0][0]) {
      const t = L.done[g.id] || 0, [n, who] = g.tiers[t];
      const legend = !!who, ap = legend ? 25 : 8 + t * 4, vc = legend ? 5000 : 800 + t * 600;
      c.ap += ap; c.vc = (c.vc || 0) + vc;
      out.push({ label: g.label, n, who, ap, vc });
      L.done[g.id] = t + 1;
    }
  }
  return out;
}

// ---------- Media: interviews, fans, chemistry, endorsements ----------
// Every interview is a few questions with a "brand" answer (grows fans) and a "team" answer (grows chemistry).
// Fans bring endorsement deals (VC every game); chemistry makes your teammates better.
export const DEALS = [
  { fans: 15000, name: 'Local sneaker shop', vc: 100 },
  { fans: 60000, name: 'Sports drink sponsor', vc: 250 },
  { fans: 200000, name: 'Signature shoe deal', vc: 600 },
  { fans: 600000, name: 'Global brand ambassador', vc: 1200 },
];
const INTERVIEWS = {
  college: { who: 'Dre Banks', outlet: 'Hoop Central (YouTube, 2.1M subs)', intro: 'A camera crew catches you outside the gym on your first day on campus.', qs: [
    ['Everybody\'s calling you the best freshman in the country. You agree?', ['Put it this way: they\'re going to need a bigger word than "best".', 'I haven\'t done anything yet. My teammates and I have a lot of work to do.']],
    ['What\'s the one thing people don\'t know about your game?', ['That I\'m the most exciting player they\'ll ever pay to watch.', 'How much I like making the extra pass. Winning is what gets you noticed.']],
    ['Message to your future rival?', ['Tell him to watch my channel. He might learn something.', 'Respect. We\'ll handle it on the court.']],
  ] },
  draft: { who: 'Press room', outlet: 'Draft night press conference', intro: 'Cameras flash as you sit down at the podium in your new hat.', qs: [
    ['How does it feel to be a pro?', ['Feels like the start of my brand. This city just got a superstar.', 'Grateful. I just want to earn my teammates\' trust.']],
    ['What do you bring to this team on day one?', ['Highlights. Sell-outs. A jersey everybody\'s buying.', 'Whatever the coach needs. Defense, energy, the dirty work.']],
  ] },
  postgame: { who: 'Courtside reporter', outlet: 'Postgame interview', intro: 'A reporter grabs you on the way to the locker room.', qs: [
    ['Big night for you. What was working?', ['Everything. When I\'m like this nobody can guard me.', 'My guys found me in the right spots. Credit to them.']],
    ['Fans were chanting your name. How did that feel?', ['That\'s my house now. Get used to it.', 'Love our fans. Let\'s keep stacking wins for them.']],
  ] },
  slump: { who: 'Beat writer', outlet: 'Media availability', intro: 'After a rough stretch, the beat writers want answers.', qs: [
    ['You\'ve been off lately. What\'s going on?', ['Nothing. Bad nights happen. I\'m still the best player on the floor.', 'That\'s on me. I\'ll be in the gym and I\'ll be better for this team.']],
    ['Any frustration with your role?', ['I want the ball more. I\'m the one people pay to see.', 'No. We win together. I trust what the coach is doing.']],
  ] },
  playoffs: { who: 'National TV', outlet: 'Playoff press conference', intro: 'The lights are brighter now. The whole country is listening.', qs: [
    ['Is this the moment you become a household name?', ['I already am. After this series, everybody\'s wearing my shoe.', 'Only thing I\'m thinking about is getting four wins with these guys.']],
    ['Any words for the other team?', ['They know what\'s coming. They\'ve seen the highlights.', 'Great team. We respect them. We\'ll be ready.']],
  ] },
};
export function interviewFor(key) { return INTERVIEWS[key]; }
// Pick answer i (0 = brand, 1 = team) on question q: returns what changed
export function answerInterview(c, key, q, i) {
  c.fans = c.fans || 0; c.chem = c.chem || 0;
  const scale = c.nba ? 3 : 1;
  const before = c.chem;
  if (i === 0) { const f = Math.round((3000 + Math.random() * 4000) * scale * (key === 'playoffs' ? 2 : 1)); c.fans += f; c.chem = Math.max(0, c.chem - 2); return { fans: f, chem: c.chem - before }; }
  c.chem = Math.min(100, c.chem + (key === 'playoffs' ? 8 : 5)); const f = Math.round(600 * scale); c.fans += f; return { fans: f, chem: c.chem - before };
}
export function activeDeals(c) { return DEALS.filter(d => (c.fans || 0) >= d.fans); }
// Teammate buffs from chemistry: small rating bumps, and at high chemistry they start games with a head start
// on their takeover
export function chemBuff(c) {
  const ch = c.chem || 0;
  return { shoot: Math.round(ch / 100 * 5), def: ch >= 40 ? Math.round((ch - 40) / 60 * 5) : 0, takeover: ch >= 75 ? 0.5 : 0 };
}

// ---------- Game tasks ----------
const TASK_POOL = {
  pts: { text: n => `Score ${n}+ points`, stat: s => s.pts, base: m => Math.max(4, Math.round(m * 0.22)) },
  ast: { text: n => `Dish ${n}+ assists`, stat: s => s.ast, base: m => Math.max(2, Math.round(m * 0.08)) },
  reb: { text: n => `Grab ${n}+ rebounds`, stat: s => s.reb, base: m => Math.max(2, Math.round(m * 0.1)) },
  stocks: { text: n => `Get ${n}+ steals + blocks`, stat: s => s.stl + s.blk, base: m => Math.max(1, Math.round(m * 0.05)) },
  threes: { text: n => `Hit ${n}+ three${n > 1 ? 's' : ''}`, stat: s => s.tpm, base: m => Math.max(1, Math.round(m * 0.04)) },
  greens: { text: n => `Green ${n} jumper${n > 1 ? 's' : ''}`, stat: (s, x) => x.greens || 0, base: m => Math.max(1, Math.round(m * 0.04)), playOnly: true },
  dunks: { text: n => `Throw down ${n} dunk${n > 1 ? 's' : ''}`, stat: s => s.dnk || 0, base: m => Math.max(1, Math.round(m * 0.05)), playOnly: true },
  eff: { text: () => 'Shoot 50% or better (3+ shots)', stat: s => (s.fga >= 3 && s.fgm / s.fga >= 0.5 ? 1 : 0), base: () => 1 },
  grade: { text: () => 'Earn a B or better teammate grade', stat: (s, x) => (x.gradeScore >= 75 ? 1 : 0), base: () => 1 },
  win: { text: () => 'Win the game', stat: (s, x) => (x.win ? 1 : 0), base: () => 1 },
};
const STYLE_TASKS = { playmaker: ['ast'], sharpshooter: ['threes', 'greens'], slasher: ['dunks', 'pts'], lockdown: ['stocks'], twoway: ['stocks', 'pts'], post: ['pts', 'eff'], glass: ['reb', 'stocks'] };
// Three tasks for the next game (kept until it's played), each worth AP and VC
export function gameTasks(c, settings) {
  const key = c.history.length + ':' + c.phase;
  if (c.tasks && c.tasks.key === key) return c.tasks.list;
  const P = c.player, mins = 4 * ((settings && settings.qLen) || 3);
  const pool = [...(STYLE_TASKS[P.style] || ['pts'])];
  if (P.ratings.dunk < 60) { const i = pool.indexOf('dunks'); if (i >= 0) pool.splice(i, 1, 'pts'); }
  const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
  const ids = [pickOne(pool)];
  const rest = ['pts', 'ast', 'reb', 'stocks', 'threes', 'greens', 'eff', 'grade', 'win'].filter(k => !ids.includes(k) && !(k === 'threes' && P.ratings.three < 55));
  while (ids.length < 3) { const k = pickOne(rest); if (!ids.includes(k)) ids.push(k); }
  const list = ids.map(id => {
    const T = TASK_POOL[id], n = T.base(mins);
    return { id, n, text: T.text(n), ap: 3, vc: id === 'win' || id === 'grade' ? 200 : 250 + n * 15 };
  });
  c.tasks = { key, list };
  return list;
}
export function taskProgress(t, stats, extra) { return TASK_POOL[t.id].stat(stats, extra || {}); }

export function badgeTiers(c) {
  const out = {};
  for (const k in BADGES) out[k] = maxed ? BADGES[k].need.length : badgeTier(k, (c.badges || {})[k] || 0);
  return out;
}

// Add badge progress; returns newly reached tiers [{key, tier}]
export function addBadgeProgress(c, counts) {
  c.badges = c.badges || {};
  const ups = [];
  for (const k in counts) {
    if (!BADGES[k] || !counts[k]) continue;
    const before = badgeTier(k, c.badges[k] || 0);
    let v = Math.round(((c.badges[k] || 0) + counts[k]) * 10) / 10;
    // One tier per badge per game at most: progress stops at the next tier until your next game
    const next = BADGES[k].need[before];
    if (next != null && v > next) v = next;
    c.badges[k] = v;
    const after = badgeTier(k, c.badges[k]);
    if (after > before) ups.push({ key: k, tier: after });
  }
  return ups;
}

export function newCareer(p) {
  const inches = p.heightIn || heightIn(POSITIONS[p.position].height);
  const caps = p.caps || capsForStyle(p.position, p.style, inches, p.build || 'athletic');
  const ratings = startingRatings(p.position, p.style, Math.random, inches, p.build || 'athletic', START_OVR, caps);
  const teamOvr = {};
  const rng = mulberry(Date.now() & 0xffff);
  for (const t of TEAMS) teamOvr[t.id] = Math.round(73 + rng() * 11);
  const c = {
    version: 1,
    storyV: 2,
    seed: Math.floor(Math.random() * 1e6),
    player: { ...p, caps, ratings, heightFt: inches / 12, build: p.build || 'athletic' },
    vc: 500,
    badges: {},
    ap: 0,
    phase: 'hs',
    season: 1,
    age: 18,
    scout: 0,
    hs: { team: HS_TEAMS[0], opps: shuffle(HS_TEAMS.slice(1)).slice(0, 3), round: 0, games: [], title: false },
    college: null,
    collegeTitles: 0,
    teamOvr,
    showcase: { games: [], total: 3 },
    draft: null,
    gleague: null,
    nba: null,
    playoffs: null,
    history: [],
    totals: { gp: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0 },
    awards: [],
    pendingStory: 'intro',
  };
  initAnims(c);
  return c;
}

function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function teamOf(c, id) {
  return HS_TEAMS.find(t => t.id === id) || COLLEGES.find(t => t.id === id) || TEAMS[id];
}

// ---------- High school -> college ----------
const ROUND_HS = ['State Quarterfinal', 'State Semifinal', 'State Championship'];
const ROUND_COLLEGE = ['Elite Eight', 'Final Four', 'National Championship'];

// Three college offers; a better scouting score brings better programs.
export function collegeOffers(c) {
  if (c.offers) return c.offers;
  const sorted = COLLEGES.slice().sort((a, b) => b.ovr - a.ovr);
  const s = clamp(c.scout / 100, 0, 1);
  const start = Math.round((1 - s) * (sorted.length - 3));
  const roles = ['Starter from day one', 'Sixth man on a contender', 'Featured scorer'];
  c.offers = sorted.slice(start, start + 3).map((t, i) => ({ id: t.id, role: roles[i % 3] }));
  return c.offers;
}

export function chooseCollege(c, id) {
  const team = COLLEGES.find(t => t.id === id);
  c.college = { team: { ...team }, year: 1, games: [], record: [0, 0], schedule: shuffle(COLLEGES.filter(t => t.id !== id)).slice(0, 4).map(t => t.id), idx: 0, tourney: null };
  // Your rival: same position, another top program, a little better than you on paper. You play them twice.
  const rt = c.college.schedule[1];
  c.college.schedule.push(rt);
  c.rival = { name: randName(), num: Math.floor(Math.random() * 45), position: c.player.position, college: rt, nbaTeam: null,
    ovrEdge: 3, stats: { gp: 0, pts: 0, reb: 0, ast: 0 }, me: { gp: 0, pts: 0, reb: 0, ast: 0 }, h2h: [0, 0], met: 0 };
  c.phase = 'college';
  c.pendingStory = 'college';
  c.pendingInterview = 'college';
  c.offers = null;
}

export function returnToCollege(c) {
  const k = c.college;
  k.year++;
  k.team.ovr = Math.min(66, k.team.ovr + 2);
  k.games = []; k.record = [0, 0]; k.idx = 0; k.tourney = null;
  k.schedule = shuffle(COLLEGES.filter(t => t.id !== k.team.id)).slice(0, 4).map(t => t.id);
  c.age++;
  c.ap += 10;
  c.phase = 'college';
  c.pendingStory = 'returnCollege';
}

export function declareForDraft(c) {
  c.phase = 'showcase';
  c.showcase = { games: [], total: 3 };
  c.age++;
  c.pendingStory = 'combine';
}

// ---------- After a title: re-sign or test free agency ----------
const FA_PERKS = [
  { key: 'max', label: 'Max contract', desc: '+30 AP signing bonus' },
  { key: 'contender', label: 'Contender', desc: 'Team OVR +3 next season' },
  { key: 'star', label: 'Franchise star', desc: '+2 to your three best attributes' },
];
export function faOffers(c) {
  if (c.faOffers) return c.faOffers;
  const others = shuffle(TEAMS.filter(t => t.id !== c.nba.teamId)).slice(0, 3);
  c.faOffers = others.map((t, i) => ({ id: t.id, perk: FA_PERKS[i] }));
  return c.faOffers;
}
function boostTop(c, n, amt) {
  const r = c.player.ratings;
  Object.keys(r).sort((a, b) => r[b] - r[a]).slice(0, n).forEach(k => { r[k] = Math.max(r[k], Math.min(capOf(c, k), r[k] + amt)); });
}
// This player's cap for an attribute (height + build)
export function capOf(c, key) {
  const P = c.player;
  const hard = attrCap(key, Math.round(P.heightFt * 12), P.build || 'athletic');
  return P.caps && P.caps[key] != null ? Math.min(hard, P.caps[key]) : hard;
}
export function resignTeam(c) {
  c.ap += 15;
  boostTop(c, 3, 2);
  c.teamOvr[c.nba.teamId] = Math.min(88, c.teamOvr[c.nba.teamId] + 2);
  c.faOffers = null;
  startNextSeason(c);
  c.pendingStory = 'resigned';
}
export function signWith(c, offer) {
  c.nba.teamId = offer.id;
  c.nba.starter = true;
  if (offer.perk.key === 'max') c.ap += 30;
  if (offer.perk.key === 'contender') c.teamOvr[offer.id] = Math.min(88, c.teamOvr[offer.id] + 3);
  if (offer.perk.key === 'star') boostTop(c, 3, 2);
  c.faOffers = null;
  startNextSeason(c);
  c.pendingStory = 'newteam';
}

export function userOverall(c) { return overall(c.player.ratings, c.player.position); }

export function draftStock(c) {
  const g = c.showcase.games;
  if (!g.length) return { label: 'Unranked', score: 0 };
  const avgGrade = g.reduce((s, x) => s + x.gradeScore, 0) / g.length;
  const avgPts = g.reduce((s, x) => s + x.pts, 0) / g.length;
  const avgOther = g.reduce((s, x) => s + x.reb + x.ast + x.stl + x.blk, 0) / g.length;
  const score = avgGrade + Math.min(avgPts, 30) * 0.4 + Math.min(avgOther, 20) * 0.25 + (g.filter(x => x.win).length / g.length) * 3
    + (c.collegeTitles || 0) * 3 + (c.hs && c.hs.title ? 2 : 0);
  let label = 'Undrafted';
  if (score >= 90) label = 'Top 3 Pick';
  else if (score >= 80) label = 'Lottery';
  else if (score >= 72) label = 'First Round';
  else if (score >= 64) label = 'Second Round';
  return { label, score };
}

export function runDraft(c) {
  const { score } = draftStock(c);
  let d;
  if (score >= 90) d = { result: 'choose', pick: 1 + Math.floor(Math.random() * 3), round: 1 };
  else if (score >= 72) d = { result: 'auto', pick: Math.round(clamp(4 + (90 - score) / 18 * 26, 4, 30)), round: 1 };
  else if (score >= 64) d = { result: 'auto', pick: Math.round(clamp(31 + (72 - score) / 8 * 29, 31, 60)), round: 2 };
  else d = { result: 'undrafted' };
  if (d.result === 'auto') d.teamId = Math.floor(Math.random() * 30);
  c.draft = d;
  return d;
}

export function joinNBA(c, teamId, via) {
  c.pendingInterview = 'draft';
  if (c.rival && c.rival.nbaTeam == null) c.rival.nbaTeam = TEAMS.filter(t => t.id !== teamId)[Math.floor(Math.random() * (TEAMS.length - 1))].id;
  c.nba = {
    rivalry: {}, teamId, starter: false, trust: 0, rookieBoost: 5, gp: 0, record: [0, 0],
    schedule: makeSchedule(teamId, c), gameIdx: 0, standings: Object.fromEntries(TEAMS.map(t => [t.id, [0, 0]])), via,
  };
  c.phase = 'nba';
  c.pendingStory = via === 'gleague' ? 'callup' : 'draftday';
}

function makeSchedule(teamId, c) {
  const others = TEAMS.filter(t => t.id !== teamId).map(t => t.id);
  const out = [];
  const n = c.settingsSeasonLength || 16;
  for (let i = 0; i < n; i++) out.push(others[Math.floor(Math.random() * others.length)]);
  return out;
}

export function startGLeague(c) {
  const parent = Math.floor(Math.random() * 30);
  const pt = TEAMS[parent];
  const nicks = [...GLEAGUE_NICKS].sort(() => Math.random() - 0.5);
  const teams = [{ id: 200, abbr: pt.abbr + 'G', city: pt.city, nick: nicks[0], name: `${pt.city} ${nicks[0]}`, c1: pt.c1, c2: pt.c2 }];
  for (let i = 1; i < 8; i++) {
    const t = TEAMS[(parent + i * 3) % 30];
    teams.push({ id: 200 + i, abbr: t.abbr + 'G', city: t.city, nick: nicks[i % nicks.length], name: `${t.city} ${nicks[i % nicks.length]}`, c1: t.c2 === '#ffffff' ? t.c1 : t.c2, c2: t.c1 });
  }
  c.gleague = { parent, teams, games: [], callUp: 0, record: [0, 0] };
  c.phase = 'gleague';
  c.pendingStory = 'gleague';
}

// Everything the match needs for the next game.
export function nextGame(c, settings) {
  const P = c.player;
  let myTeam, opp, myOvr, oppOvr, label, benchStart = false, boost = 0, passBias = 0.3, apMult = 1, tag = '', greenBoost = 1;
  if (c.phase === 'hs') {
    const h = c.hs;
    myTeam = h.team; opp = h.opps[h.round];
    myOvr = 45; oppOvr = 42 + h.round * 3;
    label = `Senior Year · ${ROUND_HS[h.round]}`;
    passBias = 0.45; apMult = 1.5; greenBoost = 1.8;
    tag = 'College scouts are in the gym. Win the state title to boost your scouting.';
  } else if (c.phase === 'college') {
    const k = c.college;
    myTeam = k.team; myOvr = k.team.ovr;
    if (k.tourney) {
      opp = COLLEGES.find(t => t.id === k.tourney.opps[k.tourney.round]);
      oppOvr = Math.min(66, opp.ovr + k.tourney.round * 2);
      label = `College Year ${k.year} · ${ROUND_COLLEGE[k.tourney.round]}`;
      tag = 'Lose and the season is over.';
    } else {
      opp = COLLEGES.find(t => t.id === k.schedule[k.idx]);
      oppOvr = opp.ovr;
      label = `College Year ${k.year} · Game ${k.idx + 1} of ${k.schedule.length}`;
      tag = 'Win games to make the national tournament run. NBA scouts are watching.';
    }
    passBias = 0.4; apMult = 1.3; greenBoost = 1.5;
  } else if (c.phase === 'showcase') {
    const i = c.showcase.games.length;
    myTeam = SHOWCASE_TEAMS[3]; opp = SHOWCASE_TEAMS[i % 3];
    myOvr = 62; oppOvr = 61 + i * 2;
    label = `${c.storyV === 2 ? 'Draft Combine' : 'Prospect Showcase'} · Game ${i + 1} of ${c.showcase.total}`;
    passBias = 0.4;
    tag = c.storyV === 2 ? 'You are a prodigy now. These games decide if you pick your team, get drafted, or go to the G League.' : 'Scouts are watching. Every play counts for your draft stock.';
  } else if (c.phase === 'gleague') {
    const g = c.gleague;
    myTeam = g.teams[0];
    opp = g.teams[1 + (g.games.length % 7)];
    myOvr = 66; oppOvr = 66 + Math.min(4, g.games.length);
    label = `G League · Game ${g.games.length + 1}`;
    boost = 4; passBias = 0.55; apMult = 1.5;
    tag = 'G League Boost active: +4 to all attributes and 1.5× AP. The offense runs through you.';
  } else {
    const n = c.nba;
    myTeam = TEAMS[n.teamId];
    if (c.phase === 'playoffs') {
      const s = c.playoffs.series;
      opp = TEAMS[s.opp];
      label = `${c.playoffs.roundName} · Game ${s.wins[0] + s.wins[1] + 1} (Series ${s.wins[0]}-${s.wins[1]})`;
    } else {
      opp = TEAMS[n.schedule[n.gameIdx]];
      label = `Season ${c.season} · Game ${n.gameIdx + 1} of ${n.schedule.length}`;
    }
    myOvr = c.teamOvr[myTeam.id]; oppOvr = c.teamOvr[opp.id];
    benchStart = !n.starter;
    if (n.rookieBoost > 0) { apMult = 1.5; tag = `Rookie Boost: 1.5× AP for ${n.rookieBoost} more game${n.rookieBoost > 1 ? 's' : ''}.`; }
    if (benchStart) tag = (tag ? tag + ' ' : '') + 'You come off the bench. Earn the coach\'s trust to start.';
  }
  // Opponents keep up with you: once you outgrow your level they close most of the gap
  const uo = userOverall(c);
  if (uo > oppOvr + 4) oppOvr = Math.min(92, Math.round(oppOvr + (uo - oppOvr - 4) * 0.6));
  const seed = c.seed + c.season;
  const myRoster = generateRoster(myTeam.id, myOvr, seed);
  const oppRoster = generateRoster(opp.id, oppOvr, seed);
  const slot = POS_ORDER.indexOf(P.position);
  myRoster[slot] = {
    name: P.name, num: P.num, position: P.position, ratings: { ...P.ratings }, heightFt: P.heightFt,
    skin: P.skin, hair: P.hair, shoe: '#ffffff', headband: P.headband, sleeve: P.sleeve, ovr: userOverall(c), build: P.build || 'athletic',
  };
  // Rivalry game: your rival suits up for them (at your position), and in the NBA every team has a rivalry meter
  const R = c.rival;
  let rival = null, intensity = 0;
  if (R && ((c.phase === 'college' && opp.id === R.college) || (c.nba && R.nbaTeam === opp.id))) {
    const rr = generateRoster(opp.id, oppOvr + R.ovrEdge, seed + 7)[slot];
    oppRoster[slot] = { ...rr, name: R.name, num: R.num, position: P.position, ovr: Math.max(rr.ovr || 0, userOverall(c) + R.ovrEdge), isRival: true };
    rival = { name: R.name, num: R.num };
    tag = `RIVALRY GAME: ${R.name} and ${opp.name}. He starts the game heated up.` + (tag ? ' ' + tag : '');
    intensity = 0.5;
  }
  if (c.nba) {
    const rv = (c.nba.rivalry || {})[opp.id] || 0;
    intensity = Math.max(intensity, rv / 100);
    if (c.phase === 'playoffs' && /Finals/.test(c.playoffs.roundName)) intensity = Math.min(1, intensity + 0.5);
    if (rv >= 40 && !rival) tag = `Rivalry: ${rv}% · Things are getting heated with ${opp.name}.` + (tag ? ' ' + tag : '');
  }
  const cb = chemBuff(c);
  if (cb.shoot || cb.def) myRoster.forEach((pl, i) => { if (i === slot) return; const r2 = pl.ratings = { ...pl.ratings }; for (const k of ['three', 'mid', 'close']) r2[k] = Math.min(99, r2[k] + cb.shoot); for (const k of ['perD', 'intD', 'steal']) r2[k] = Math.min(99, r2[k] + cb.def); });
  const home = Math.random() < 0.5;
  return {
    rival, intensity, chemTakeover: cb.takeover,
    myTeam, opp, label, tag, benchStart, boost, passBias, apMult, slot, greenBoost,
    teams: home ? [myTeam, opp] : [opp, myTeam],
    rosters: home ? [myRoster, oppRoster] : [oppRoster, myRoster],
    userTeam: home ? 0 : 1, homeTeam: home ? myTeam : opp,
    myOvr, oppOvr, badges: badgeTiers(c),
  };
}

// Apply a finished (or simulated) game to the career. Returns a post-game summary.
export function applyResult(c, info, res) {
  const s = res.stats;
  const gradeScore = res.grade;
  const letter = gradeLetter(gradeScore);
  const win = res.myScore > res.oppScore;
  const gradeAP = { 'A+': 12, A: 10, 'A-': 9, 'B+': 8, 'B': 7, 'B-': 6, 'C+': 5, C: 4, 'C-': 3, 'D+': 2, D: 2, 'D-': 1, F: 1 }[letter];
  let ap = 4 + gradeAP + Math.floor(s.pts / 4) + Math.floor((s.reb + s.ast + s.stl * 2 + s.blk * 2) / 3) + (win ? 3 : 0);
  ap = Math.round(ap * info.apMult * (res.simmed ? 0.6 : 1));
  c.ap += ap;
  const out = { ap, letter, gradeScore, win, notes: [], boosts: [], badgeUps: [], tasks: [], vc: 0, newAnims: [] };
  // Game tasks: each one done is worth AP and VC (played games only for greens/dunks)
  const extra = { greens: (res.badgeCounts || {}).greenMachine || 0, gradeScore, win };
  for (const t of (c.tasks && c.tasks.list) || []) {
    const n = taskProgress(t, s, extra), done = n >= t.n && !(res.simmed && (t.id === 'greens' || t.id === 'dunks'));
    out.tasks.push({ text: t.text, done, ap: t.ap, vc: t.vc, n });
    if (done) { c.ap += t.ap; out.ap += t.ap; out.vc += t.vc; }
  }
  c.tasks = null;
  // VC for playing: more for a good grade and a win, less when simmed
  const gradeVC = { A: 260, B: 180, C: 120, D: 70, F: 40 }[letter[0]] || 40;
  out.vc += Math.round((150 + gradeVC + (win ? 100 : 0)) * (res.simmed ? 0.5 : 1));
  c.vc = (c.vc || 0) + out.vc;
  const bc = res.badgeCounts || { dimer: s.ast, interceptor: s.stl, rimProtector: s.blk, rebound: s.reb };
  out.badgeUps = addBadgeProgress(c, bc);
  c.totals.gp++; for (const k of ['pts', 'reb', 'ast', 'stl', 'blk']) c.totals[k] += s[k];
  c.history.push({ phase: c.phase, opp: info.opp.abbr, my: res.myScore, them: res.oppScore, win, grade: letter, ...s, season: c.season });
  if (c.history.length > 200) c.history.shift();
  const rec = { gradeScore, pts: s.pts, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk, win };

  if (c.phase === 'hs') {
    const h = c.hs;
    h.games.push(rec);
    c.scout = Math.round(c.scout + Math.max(2, (gradeScore - 45) * 0.4 + s.pts * 0.5 + (win ? 5 : 0)));
    if (win) {
      h.round++;
      if (h.round >= ROUND_HS.length) { h.title = true; c.scout += 15; c.awards.push('State Champion'); c.phase = 'recruit'; c.pendingStory = 'hsChamp'; }
      else out.notes.push(`On to the ${ROUND_HS[h.round]}!`);
    } else { c.phase = 'recruit'; c.pendingStory = 'hsOut'; }
    out.notes.push(`Scouting: ${Math.min(100, c.scout)}`);
  } else if (c.phase === 'college') {
    const k = c.college;
    k.games.push(rec); k.record[win ? 0 : 1]++;
    c.scout = Math.round(c.scout + Math.max(1, (gradeScore - 50) * 0.3 + s.pts * 0.3 + (win ? 3 : 0)));
    if (!k.tourney) {
      k.idx++;
      if (k.idx >= k.schedule.length) {
        k.tourney = { round: 0, opps: shuffle(COLLEGES.filter(t => t.id !== k.team.id)).slice(0, 3).map(t => t.id) };
        c.pendingStory = 'collegeTourney';
        out.notes.push(`Regular season over (${k.record[0]}-${k.record[1]}). Tournament time.`);
      }
    } else if (win) {
      k.tourney.round++;
      if (k.tourney.round >= ROUND_COLLEGE.length) {
        c.collegeTitles++; c.awards.push(`National Champion (Year ${k.year})`);
        c.phase = 'collegeDecision'; c.pendingStory = 'collegeChamp';
      } else out.notes.push(`On to the ${ROUND_COLLEGE[k.tourney.round]}!`);
    } else { c.phase = 'collegeDecision'; c.pendingStory = 'collegeOut'; }
  } else if (c.phase === 'showcase') {
    c.showcase.games.push(rec);
    const st = draftStock(c);
    out.notes.push(`Draft stock: ${st.label}`);
    if (c.showcase.games.length >= c.showcase.total) { c.phase = 'draft'; c.pendingStory = 'draftnight'; }
  } else if (c.phase === 'gleague') {
    const g = c.gleague;
    g.games.push(rec);
    g.record[win ? 0 : 1]++;
    // Permanent skill boosts based on how you played
    const r = c.player.ratings;
    const picks = [];
    if (s.tpm >= 3) picks.push('three');
    if (s.pts >= 18 && s.tpm < 3) picks.push(r.layup < r.mid ? 'layup' : 'mid');
    if (s.ast >= 5) picks.push('pass');
    if (s.reb >= 8) picks.push('reb');
    if (s.stl >= 2) picks.push('steal');
    if (s.blk >= 2) picks.push('block');
    if (!picks.length) picks.push(Object.keys(PLAYSTYLES[c.player.style].mods)[0]);
    for (const k of picks.slice(0, 3)) { const n = gradeScore >= 80 ? 2 : 1; r[k] = Math.max(r[k], Math.min(capOf(c, k), r[k] + n)); out.boosts.push(`+${n} ${ATTRS.find(a => a.key === k).name}`); }
    const gain = Math.max(8, Math.round((gradeScore - 50) * 1.2 + s.pts * 0.8 + (win ? 6 : 0)));
    g.callUp = Math.min(100, g.callUp + gain);
    out.notes.push(`Call-up meter: ${g.callUp}%`);
    if (g.callUp >= 100 && g.games.length >= 2) {
      joinNBA(c, g.parent, 'gleague');
      out.notes.push(`You've been called up by the ${TEAMS[g.parent].name}!`);
    }
  } else if (c.phase === 'nba') {
    const n = c.nba;
    n.gp++; n.record[win ? 0 : 1]++;
    n.standings[n.teamId][win ? 0 : 1]++;
    n.standings[info.opp.id][win ? 1 : 0]++;
    simLeagueDay(c, [n.teamId, info.opp.id]);
    n.gameIdx++;
    if (n.rookieBoost > 0) n.rookieBoost--;
    if (!n.starter) {
      const gain = Math.round((gradeScore - 58) * 1.1 + s.pts * 0.5 + (win ? 5 : 0));
      n.trust = clamp(n.trust + gain, 0, 100);
      out.notes.push(`Coach trust: ${n.trust}%`);
      if (n.trust >= 100) { n.starter = true; c.pendingStory = 'starter'; out.notes.push('You earned a spot in the starting five!'); }
    }
    if (n.gameIdx >= n.schedule.length) endRegularSeason(c, out);
  } else if (c.phase === 'playoffs') {
    const pl = c.playoffs, sr = pl.series;
    sr.wins[win ? 0 : 1]++;
    const need = Math.ceil(sr.bestOf / 2);
    if (c.nba && !c.nba.starter) {
      c.nba.trust = clamp(c.nba.trust + Math.round((gradeScore - 58) * 1.1 + s.pts * 0.5), 0, 100);
      if (c.nba.trust >= 100) { c.nba.starter = true; c.pendingStory = 'starter'; }
    }
    if (sr.wins[0] >= need) advancePlayoffs(c, out, true);
    else if (sr.wins[1] >= need) advancePlayoffs(c, out, false);
    else out.notes.push(`Series: ${sr.wins[0]}-${sr.wins[1]}`);
  }
  if (c.rival && (c.phase === 'college' || c.nba)) {
    // Your rival keeps putting up numbers every week too
    // (simulated lines are scaled to your quarter length so the comparison is fair)
    const sc = ((res.scale && res.scale.q) || 3) / 12 * (res.simmed ? 1 : 1);
    const R = c.rival, rs = res.rivalStats || { pts: Math.round((14 + Math.random() * 14) * sc), reb: Math.round((3 + Math.random() * 6) * sc), ast: Math.round((2 + Math.random() * 6) * sc) };
    R.stats.gp++; for (const k of ['pts', 'reb', 'ast']) R.stats[k] += rs[k];
    R.me.gp++; for (const k of ['pts', 'reb', 'ast']) R.me[k] += s[k];
    if (info.rival) { R.met++; R.h2h[win ? 0 : 1]++; out.notes.push(win ? `You beat ${R.name} head to head (${R.h2h[0]}-${R.h2h[1]}).` : `${R.name} got this one (${R.h2h[0]}-${R.h2h[1]}).`); }
  }
  if (c.nba) {
    const rv = c.nba.rivalry = c.nba.rivalry || {};
    const close = Math.abs(res.myScore - res.oppScore) <= 6;
    rv[info.opp.id] = Math.min(100, (rv[info.opp.id] || 0) + 6 + (close ? 6 : 0) + (c.phase === 'playoffs' ? 12 : 0) + (info.rival ? 8 : 0));
    if (rv[info.opp.id] >= 60) out.notes.push(`Rivalry with ${info.opp.name}: ${rv[info.opp.id]}%`);
  }
  // Endorsements pay every game; the press wants to talk after big nights, slumps and in the playoffs
  const deals = activeDeals(c);
  if (deals.length) { const dv = deals.reduce((t, d) => t + d.vc, 0); c.vc += dv; out.vc += dv; out.notes.push(`Endorsements: +${dv} VC (${deals.map(d => d.name).join(', ')})`); }
  const prevDeals = c.dealsSeen || 0;
  if (deals.length > prevDeals) { out.newDeal = deals[deals.length - 1]; c.dealsSeen = deals.length; }
  if (c.nba && !c.pendingInterview) {
    c.media = (c.media || 0) + 1;
    const big = s.pts >= Math.max(8, ((res.scale && res.scale.q) || 3) * 3.5);
    if (c.phase === 'playoffs' && c.media >= 2) { c.pendingInterview = 'playoffs'; c.media = 0; }
    else if (big && c.media >= 3) { c.pendingInterview = 'postgame'; c.media = 0; }
    else if (!win && c.media >= 6) { c.pendingInterview = 'slump'; c.media = 0; }
  }
  // GOAT skill: every activation counts toward its next tier
  if (res.goatActs && c.player.goat) {
    c.goatProg = c.goatProg || {};
    const k = c.player.goat, before = goatTier(c.goatProg[k]);
    c.goatProg[k] = (c.goatProg[k] || 0) + res.goatActs;
    const after = goatTier(c.goatProg[k]);
    if (after > before) out.notes.push(`${GOAT_SKILLS[k].name} upgraded to ${GOAT_TIERS[after].name}!`);
  }
  out.goals = updateLifeGoals(c, s, res.scale || {});
  if (c.anims) out.newAnims = checkAnimUnlocks(c);
  return out;
}

function simGameResult(aOvr, bOvr) {
  const p = clamp(0.5 + (aOvr - bOvr) * 0.035, 0.12, 0.88);
  return Math.random() < p;
}

function simLeagueDay(c, exclude) {
  const n = c.nba;
  const ids = TEAMS.map(t => t.id).filter(id => !exclude.includes(id)).sort(() => Math.random() - 0.5);
  for (let i = 0; i + 1 < ids.length; i += 2) {
    const a = ids[i], b = ids[i + 1];
    const aw = simGameResult(c.teamOvr[a], c.teamOvr[b]);
    n.standings[a][aw ? 0 : 1]++; n.standings[b][aw ? 1 : 0]++;
  }
  // Odd team out plays a random team already on the board (keeps game counts close)
  if (ids.length % 2) {
    const a = ids[ids.length - 1], b = ids[0];
    const aw = simGameResult(c.teamOvr[a], c.teamOvr[b]);
    n.standings[a][aw ? 0 : 1]++;
  }
}

export function standingsList(c) {
  const st = c.nba.standings;
  return TEAMS.map(t => ({ team: t, w: st[t.id][0], l: st[t.id][1], pct: st[t.id][0] / Math.max(1, st[t.id][0] + st[t.id][1]) }))
    .sort((a, b) => b.pct - a.pct || b.w - a.w || c.teamOvr[b.team.id] - c.teamOvr[a.team.id]);
}

const ROUND_NAMES = ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals'];

function bestOf(c, round) {
  const long = c.seriesLen === 'long';
  if (round === 3) return long ? 7 : 5;
  return long ? 7 : 3;
}

function endRegularSeason(c, out) {
  const list = standingsList(c);
  const seed = list.findIndex(x => x.team.id === c.nba.teamId) + 1;
  out.notes.push(`Regular season over: ${c.nba.record[0]}-${c.nba.record[1]}, #${seed} in the league.`);
  if (seed <= 16) {
    const bracket = list.slice(0, 16).map(x => x.team.id); // index = seed-1
    c.playoffs = { round: 0, seed, bracket, alive: bracket.slice(), roundName: ROUND_NAMES[0] };
    setupSeries(c);
    c.phase = 'playoffs';
    c.pendingStory = 'playoffs';
  } else {
    c.pendingStory = 'missed';
    c.phase = 'offseason';
  }
}

function setupSeries(c) {
  const pl = c.playoffs;
  // alive is ordered so that pairs are (0,last), (1,last-1)...
  const a = pl.alive;
  const me = a.indexOf(c.nba.teamId);
  const opp = a[a.length - 1 - me];
  pl.series = { opp, wins: [0, 0], bestOf: bestOf(c, pl.round) };
  pl.roundName = ROUND_NAMES[pl.round];
}

function advancePlayoffs(c, out, won) {
  const pl = c.playoffs;
  if (!won) {
    out.notes.push(`Eliminated in the ${pl.roundName}.`);
    c.pendingStory = 'eliminated';
    c.phase = 'offseason';
    return;
  }
  if (pl.round === 3) {
    c.awards.push(`Season ${c.season} NBA Champion`);
    if (c.history.slice(-pl.series.bestOf).reduce((s, h) => s + h.pts, 0) / pl.series.bestOf > 18) c.awards.push(`Season ${c.season} Finals MVP`);
    out.notes.push('NBA CHAMPIONS!');
    c.pendingStory = 'champion';
    c.phase = 'resign';
    c.ap += 25;
    return;
  }
  out.notes.push(`Won the ${pl.roundName}!`);
  // Sim the other series
  const a = pl.alive, next = [];
  const n = a.length;
  for (let i = 0; i < n / 2; i++) {
    const x = a[i], y = a[n - 1 - i];
    if (x === c.nba.teamId || y === c.nba.teamId) next.push(c.nba.teamId);
    else next.push(simGameResult(c.teamOvr[x], c.teamOvr[y]) ? x : y);
  }
  pl.alive = next;
  pl.round++;
  setupSeries(c);
  c.pendingStory = pl.round === 3 ? 'finals' : null;
}

export function startNextSeason(c) {
  c.season++;
  c.age++;
  c.ap += 8;
  for (const id in c.teamOvr) c.teamOvr[id] = clamp(c.teamOvr[id] + Math.round((Math.random() - 0.5) * 4), 71, 87);
  const n = c.nba;
  n.record = [0, 0]; n.gameIdx = 0; n.gp = 0;
  n.schedule = makeSchedule(n.teamId, c);
  n.standings = Object.fromEntries(TEAMS.map(t => [t.id, [0, 0]]));
  c.playoffs = null;
  c.phase = 'nba';
  c.pendingStory = 'newseason';
}

// Quick sim based on ratings.
export function simulateGame(c, info) {
  const ovr = userOverall(c);
  const r = c.player.ratings;
  const mins = info.benchStart ? 0.6 : 1;
  const pts = Math.max(0, Math.round((ovr - 45) * 0.45 * mins + (Math.random() - 0.4) * 10));
  const stats = {
    pts, reb: Math.round(r.reb / 14 * mins * Math.random() + 1), ast: Math.round(r.pass / 16 * mins * Math.random() + 1),
    stl: Math.round(Math.random() * 2), blk: Math.round(Math.random() * (r.block / 50)), tov: Math.round(Math.random() * 3),
    fgm: Math.round(pts / 2.3), fga: Math.round(pts / 2.3 / 0.46), tpm: Math.round(pts * r.three / 99 / 6), tpa: 0, ftm: 0, fta: 0,
  };
  stats.tpa = Math.round(stats.tpm / 0.36);
  const winP = clamp(0.5 + (info.myOvr - info.oppOvr) * 0.03 + (ovr - 70) * 0.006, 0.15, 0.85);
  const win = Math.random() < winP;
  const base = Math.round(info.myOvr * 0.35 + 70 + Math.random() * 10);
  const diff = 2 + Math.floor(Math.random() * 14);
  return {
    simmed: true, stats, grade: clamp(55 + (ovr - 60) * 0.5 + Math.random() * 14, 40, 90),
    myScore: win ? base : base - diff, oppScore: win ? base - diff : base,
  };
}

export function upgrade(c, key) {
  const v = c.player.ratings[key];
  if (v >= capOf(c, key)) return false;
  const cost = upgradeCost(v);
  if (!maxed && c.ap < cost) return false;
  if (!maxed) c.ap -= cost;
  c.player.ratings[key] = v + 1;
  return true;
}

// ---------- Story ----------
export function story(c, key) {
  const P = c.player, nm = P.name.split(' ')[0];
  const pos = POSITIONS[P.position].name;
  const team = c.nba ? TEAMS[c.nba.teamId] : null;
  switch (key) {
    case 'intro': if (c.storyV === 2) return { title: 'SENIOR YEAR', speaker: 'Coach', lines: [
      `${nm}, this is it. Your last high school tournament, playing for ${c.hs.team.name}.`,
      `Three college programs will make you an offer. Win the state title and the offers get better.`,
      `You're a ${PLAYSTYLES[P.style].name.toLowerCase()} ${pos.toLowerCase()} who's still raw. Earn your upgrades and show the scouts you belong.`] };
      return { title: 'THE PRODIGY', speaker: 'Your Agent', lines: [
      `${nm}, everybody back home has been talking about you since you were twelve. Now the whole league is about to.`,
      `You're a ${PLAYSTYLES[P.style].name.toLowerCase()} ${pos.toLowerCase()} with real upside, but potential doesn't get you drafted. Production does.`,
      `The Prospect Showcase is three games in front of every NBA scout. Play well and teams will fight over you. Play like a top-3 pick and you'll choose where you go.`,
      `Play badly and nobody calls your name. Let's make sure that doesn't happen.`] };
    case 'hsChamp': return { title: 'STATE CHAMPIONS', speaker: 'Coach', lines: [
      `State champs! You did it, ${nm}. That title is going to open a lot of doors.`, `The college offers are coming in. Choose wisely.`] };
    case 'hsOut': return { title: 'SEASON OVER', speaker: 'Coach', lines: [
      `We came up short. It hurts, but the scouts still saw what you can do.`, `Three college programs want you. Let's look at the offers.`] };
    case 'college': return { title: c.college.team.name.toUpperCase(), speaker: 'Head Coach', lines: [
      `Welcome to ${c.college.team.city}, ${nm}. Four games, then the national tournament.`, `Win the title and NBA teams will be lining up for you.`] };
    case 'collegeTourney': return { title: 'TOURNAMENT TIME', speaker: 'Head Coach', lines: [
      `${c.college.record[0]}-${c.college.record[1]} in the regular season. Now it's win or go home: Elite Eight, Final Four, Championship.`] };
    case 'collegeChamp': return { title: 'NATIONAL CHAMPIONS', speaker: 'Head Coach', lines: [
      `National champions! ${nm}, you just put your name on the draft board.`, `Now the big decision: come back for another year or declare for the draft.`] };
    case 'collegeOut': return { title: 'SEASON OVER', speaker: 'Head Coach', lines: [
      `Our run is over. You had a great year, ${nm}.`, `Come back and get better, or declare for the draft. It's your call.`] };
    case 'returnCollege': return { title: `YEAR ${c.college.year}`, speaker: 'Head Coach', lines: [
      `You came back. Good. Another year of reps: +10 AP, and the team got better too.`] };
    case 'combine': return { title: 'THE PRODIGY', speaker: 'Your Agent', lines: [
      `You declared, ${nm}. Every NBA front office knows your name now. You're a prodigy.`,
      `The Draft Combine is three games. Dominate and you choose your team. Play well and you get drafted. Struggle and it's the G League.`] };
    case 'resigned': return { title: 'RUN IT BACK', speaker: 'Front Office', lines: [
      `You re-signed with the ${team.name}. Loyalty pays: +15 AP, +2 to your three best attributes, and the team got better.`] };
    case 'newteam': return { title: `WELCOME TO ${team.city.toUpperCase()}`, speaker: 'Your Agent', lines: [
      `New city, new deal. You're the ${team.name}' new starter. Let's go win another one.`] };
    case 'draftnight': return { title: 'DRAFT NIGHT', speaker: 'Commissioner', lines: [`The draft is about to begin. Your showcase grade: ${draftStock(c).label}.`] };
    case 'gleague': return { title: 'UNDRAFTED', speaker: 'Your Agent', lines: [
      `Sixty names were called tonight. Yours wasn't one of them.`,
      `The ${TEAMS[c.gleague.parent].name} still want to see you, so they've signed you to their G League team, the ${c.gleague.teams[0].name}.`,
      `Here you're the guy. The offense runs through you, you get a G League Boost every game, and you earn extra AP while you sharpen your skills.`,
      `Fill up the call-up meter and the parent team brings you up. Make them regret passing on you.`] };
    case 'callup': return { title: 'THE CALL', speaker: 'G League Coach', lines: [
      `Pack your bags, ${nm}. ${team.name} want you on the plane tonight.`,
      `You earned this. Up there you start at the end of the bench, so make every minute count.`,
      `Rookie Boost: you get 1.5× attribute points for your first 5 NBA games.`] };
    case 'draftday': return { title: `WELCOME TO ${team.city.toUpperCase()}`, speaker: 'Head Coach', lines: [
      `${c.draft.round === 1 ? `Pick #${c.draft.pick}` : `Second round, pick #${c.draft.pick}`}. Welcome to the ${team.name}, ${nm}.`,
      `I'm not handing you anything. You'll come off the bench until you show me you belong with the starters.`,
      `Rookie Boost: you get 1.5× attribute points for your first 5 games. Use them.`] };
    case 'starter': return { title: 'STARTING FIVE', speaker: 'Head Coach', lines: [
      `I've seen enough. Starting next game, you're in the starting lineup.`,
      `Now let's go win something. The Finals are the only goal in this building.`] };
    case 'playoffs': return { title: 'PLAYOFFS', speaker: 'Head Coach', lines: [
      `We're in, seeded #${c.playoffs.seed}. A whole season of work comes down to four series.`,
      `First up: ${TEAMS[c.playoffs.series.opp].name}. Win ${Math.ceil(c.playoffs.series.bestOf / 2)} games and we move on.`] };
    case 'finals': return { title: 'THE FINALS', speaker: 'Your Agent', lines: [
      `${nm}, you made it. The NBA Finals against the ${TEAMS[c.playoffs.series.opp].name}.`,
      `Kids back home who used to watch you in the gym will be watching you on TV tonight. Go get a ring.`] };
    case 'champion': return { title: 'CHAMPIONS', speaker: 'Everyone', lines: [
      `Confetti everywhere. The ${team.name} are NBA CHAMPIONS!`,
      `From a prodigy trying to get noticed to a champion. You earned it. +25 AP bonus.`,
      `Now decide: stay and run it back, or test free agency.`] };
    case 'eliminated': return { title: 'SEASON OVER', speaker: 'Head Coach', lines: [
      `It hurts. Remember how it feels and use it this summer.`, `We'll be back stronger next season.`] };
    case 'missed': return { title: 'NO PLAYOFFS', speaker: 'Head Coach', lines: [
      `${c.nba.record[0]}-${c.nba.record[1]} wasn't good enough. We missed the playoffs.`, `Put in the work this offseason. Next year is ours.`] };
    case 'newseason': return { title: `SEASON ${c.season}`, speaker: 'Head Coach', lines: [
      `New season. ${c.nba.starter ? 'You\'re a starter now, so play like it.' : 'Earn your way into the starting five.'}`, `Offseason training: +8 AP.`] };
  }
  return null;
}
