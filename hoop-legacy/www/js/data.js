// Static game data: attributes, positions, playstyles, teams, names.

export const ATTRS = [
  { key: 'close', name: 'Close Shot', group: 'Finishing' },
  { key: 'layup', name: 'Driving Layup', group: 'Finishing' },
  { key: 'dunk', name: 'Driving Dunk', group: 'Finishing' },
  { key: 'mid', name: 'Mid-Range Shot', group: 'Shooting' },
  { key: 'three', name: 'Three-Point Shot', group: 'Shooting' },
  { key: 'ft', name: 'Free Throw', group: 'Shooting' },
  { key: 'pass', name: 'Pass Accuracy', group: 'Playmaking' },
  { key: 'handle', name: 'Ball Handle', group: 'Playmaking' },
  { key: 'perD', name: 'Perimeter Defense', group: 'Defense' },
  { key: 'intD', name: 'Interior Defense', group: 'Defense' },
  { key: 'steal', name: 'Steal', group: 'Defense' },
  { key: 'block', name: 'Block', group: 'Defense' },
  { key: 'reb', name: 'Rebounding', group: 'Defense' },
  { key: 'speed', name: 'Speed', group: 'Athleticism' },
  { key: 'vert', name: 'Vertical', group: 'Athleticism' },
  { key: 'strength', name: 'Strength', group: 'Athleticism' },
  { key: 'stamina', name: 'Stamina', group: 'Athleticism' },
];

export const POSITIONS = {
  PG: { name: 'Point Guard', height: 6.25, mods: { pass: 10, handle: 12, speed: 10, three: 4, perD: 4, steal: 5, reb: -12, block: -12, strength: -8, intD: -10, dunk: -4 },
    weights: { pass: 3, handle: 3, three: 2, mid: 1.5, layup: 2, speed: 2, perD: 1.5, steal: 1 } },
  SG: { name: 'Shooting Guard', height: 6.5, mods: { three: 10, mid: 8, handle: 5, speed: 6, perD: 5, steal: 3, reb: -8, block: -8, intD: -6 },
    weights: { three: 3, mid: 2, layup: 2, handle: 1.5, perD: 1.5, speed: 1.5, ft: 1 } },
  SF: { name: 'Small Forward', height: 6.75, mods: { layup: 6, dunk: 6, mid: 4, perD: 4, vert: 5, reb: 0 },
    weights: { layup: 2, dunk: 1.5, mid: 2, three: 2, perD: 2, reb: 1, vert: 1 } },
  PF: { name: 'Power Forward', height: 6.9, mods: { close: 8, dunk: 6, reb: 10, strength: 10, intD: 8, block: 6, handle: -8, speed: -4, three: -4, pass: -4 },
    weights: { close: 2.5, dunk: 2, reb: 2.5, intD: 2, strength: 1.5, block: 1.5, mid: 1 } },
  C: { name: 'Center', height: 7.0, mods: { close: 12, reb: 14, block: 12, intD: 12, strength: 14, handle: -14, speed: -8, three: -10, pass: -6, perD: -6, steal: -4 },
    weights: { close: 3, reb: 3, block: 2.5, intD: 2.5, strength: 2, dunk: 1.5 } },
};

export const PLAYSTYLES = {
  playmaker:   { name: 'Playmaker', desc: 'Elite passing and handles. Run the show.', mods: { pass: 16, handle: 14, speed: 6, mid: 2 } },
  sharpshooter:{ name: 'Sharpshooter', desc: 'Deadly from deep. Space the floor.', mods: { three: 18, mid: 14, ft: 14 } },
  slasher:     { name: 'Slasher', desc: 'Attack the rim with speed and power.', mods: { layup: 16, dunk: 16, vert: 12, speed: 6 } },
  lockdown:    { name: 'Lockdown Defender', desc: 'Shut down the other team\'s best scorer.', mods: { perD: 18, steal: 14, intD: 6, speed: 4, stamina: 6 } },
  twoway:      { name: 'Two-Way Threat', desc: 'Balanced scorer who defends.', mods: { mid: 8, three: 6, layup: 6, perD: 8, steal: 4, intD: 4 } },
  post:        { name: 'Post Scorer', desc: 'Bully ball. Finish through contact.', mods: { close: 18, strength: 12, dunk: 8, mid: 4, ft: 4 } },
  glass:       { name: 'Glass Cleaner', desc: 'Own the paint. Rebound and protect the rim.', mods: { reb: 18, block: 16, intD: 12, vert: 4 } },
};

export const DRIBBLE_STYLES = {
  quick:  { name: 'Quick', desc: 'Fast, tight moves with short cooldowns.', cooldown: 0.28, burst: 1.0, ankle: 1.0, risk: 0.00 },
  shifty: { name: 'Shifty', desc: 'Big lateral moves that freeze defenders.', cooldown: 0.40, burst: 1.3, ankle: 1.3, risk: 0.01 },
  power:  { name: 'Power', desc: 'Bump through contact, strong drives.', cooldown: 0.42, burst: 0.9, ankle: 0.8, risk: 0.00, power: true },
  flashy: { name: 'Flashy', desc: 'Spins and behind-the-backs. High risk, high reward.', cooldown: 0.36, burst: 1.15, ankle: 1.7, risk: 0.03 },
};

// Takeovers: fill the meter with good plays, and when it's full you take over for a stretch
export const TAKEOVERS = {
  shooting:   { name: 'Shooting', color: '#3ddc84', desc: 'Bigger green window, contests matter less, deeper range' },
  finishing:  { name: 'Finishing', color: '#ff5a1f', desc: 'Finish through contact, harder to block, flashier dunks' },
  playmaking: { name: 'Playmaking', color: '#36a3ff', desc: 'Ankle breakers, blow-bys and passes that can\'t be picked off' },
  lockdown:   { name: 'Lockdown', color: '#b46bff', desc: 'Steals, blocks and tighter contests' },
  glass:      { name: 'Glass', color: '#ffd23f', desc: 'Win the boards and box out anyone' },
};
const STYLE_TAKEOVER = { sharpshooter: 'shooting', slasher: 'finishing', post: 'finishing', playmaker: 'playmaking', lockdown: 'lockdown', twoway: 'lockdown', glass: 'glass' };
// Your playstyle picks your takeover; everyone else gets the one that fits their best skill
export function takeoverType(r, playstyle) {
  if (playstyle && STYLE_TAKEOVER[playstyle]) return STYLE_TAKEOVER[playstyle];
  const g = k => r[k] ?? 50;
  const score = {
    shooting: Math.max(g('three'), g('mid')), finishing: (g('dunk') + g('layup')) / 2 + 2,
    playmaking: (g('pass') + g('handle')) / 2, lockdown: (g('perD') + g('steal')) / 2, glass: (g('reb') + g('block')) / 2,
  };
  return Object.keys(score).reduce((a, b) => (score[b] > score[a] ? b : a));
}

// Dunks that need extra hang time (and start the reach for the rim later)
export const FLASHY_DUNKS = ['windmill', '360', 'btl', 'windmill2', '360wm', 'cradle'];
// Dunks finished with one hand (the ball rides in the right palm)
export const ONE_HAND_DUNKS = ['one', 'tomahawk', 'contact', 'windmill', 'leaner', 'backscratch', 'cradle', '360wm'];

// How a player moves, built once per game from their size, build, ratings and playstyle, plus the dribble
// style and jumpshot you picked for your own player (AI players get styles that fit their game).
export function animProfile(p, picks = {}) {
  const r = p.r || p.ratings || {};
  const g = k => r[k] ?? 60;
  const H = p.heightFt || 6.5, build = p.build || 'athletic';
  let seed = 7;
  for (const ch of String(p.name || '') + (p.num ?? '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = k => (Math.imul(seed ^ Math.imul(k, 2654435761), 2654435761) >>> 0) / 4294967296;
  const c01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const big = c01((H - 6.55) / 0.75), guard = c01((6.45 - H) / 0.5);
  const handle = c01((g('handle') - 45) / 45);
  const strong = build === 'strong' ? 1 : build === 'slim' ? 0 : 0.5;
  const dribble = picks.dribble || (
    g('handle') >= 82 && rnd(1) < 0.45 ? 'flashy'
      : (strong >= 1 || big > 0.4) && g('strength') >= 65 ? 'power'
      : g('speed') >= 80 && rnd(2) < 0.6 ? 'shifty' : 'quick');
  const shot = Math.max(g('three'), g('mid'));
  const jumpshot = picks.jumpshot || (big > 0.5 ? 'higharc' : g('three') >= 82 && rnd(3) < 0.5 ? 'quick' : rnd(3) < 0.25 ? 'higharc' : 'standard');
  const dunkFlair = c01((g('dunk') - 70) / 25) * c01((g('vert') - 50) / 40) * (1 - 0.9 * big) * (1 - 0.3 * strong);
  const D = c01((Math.max(g('perD'), g('intD')) - 45) / 45);
  return {
    big, guard, handle, strong, dribble, jumpshot,
    // Dribbling: low athletic stance for good handlers (upright for poor ones); style sets rhythm and look
    dribRate: { quick: 1.22, shifty: 1.08, power: 0.9, flashy: 1.0 }[dribble] * (0.85 + 0.15 * handle),
    dribLow: handle * (dribble === 'flashy' ? 0.75 : 1),
    dribWide: dribble === 'flashy' ? 0.35 : dribble === 'shifty' ? 0.2 : 0,
    // Shooting: set point height, form (poor shooters flare the elbow), leg kick, follow-through
    setHi: (jumpshot === 'higharc' ? 0.3 : jumpshot === 'quick' ? -0.25 : 0) + big * 0.15,
    form: c01((shot - 45) / 45),
    kick: rnd(4) < 0.22 ? (rnd(5) < 0.5 ? 1 : -1) : 0,
    dunkFlair, power: c01(strong * 0.6 + big * 0.6),
    // Defense: stance depth and activity; bigs keep their hands high
    D, defHigh: big,
    // Running: bigs stride long and slow with less arm pump, guards are quick and lean in
    cadence: 1 + guard * 0.1 - big * 0.12, stride: 1 + big * 0.12 - guard * 0.05, pump: 1 + guard * 0.15 - big * 0.2,
    heavy: 0.8 + strong * 0.4 + big * 0.2,
  };
}

export const JUMPSHOTS = {
  standard: { name: 'Standard', fill: 0.62, window: 1.0 },
  quick:    { name: 'Quick Release', fill: 0.50, window: 0.85 },
  higharc:  { name: 'High Arc', fill: 0.74, window: 1.2 },
};

export const SKIN_TONES = ['#f1c9a5', '#e0ac69', '#c68642', '#a0663a', '#8d5524', '#5c3a1e'];
export const HAIR = ['Bald', 'Buzz', 'Fade', 'Afro', 'Swoop'];

// Fictional league, real cities.
export const TEAMS = [
  ['ATL', 'Atlanta', 'Firebirds', '#c8102e', '#fdb927'],
  ['BOS', 'Boston', 'Harbor', '#007a33', '#ffffff'],
  ['BKN', 'Brooklyn', 'Bridges', '#111111', '#e5e5e5'],
  ['CHA', 'Charlotte', 'Stingers', '#00788c', '#1d1160'],
  ['CHI', 'Chicago', 'Wind', '#ce1141', '#111111'],
  ['CLE', 'Cleveland', 'Ironmen', '#6f263d', '#ffb81c'],
  ['DAL', 'Dallas', 'Outlaws', '#0064b1', '#bbc4ca'],
  ['DEN', 'Denver', 'Peaks', '#0e2240', '#fec524'],
  ['DET', 'Detroit', 'Motors', '#1d42ba', '#c8102e'],
  ['GSW', 'Golden State', 'Surge', '#1d428a', '#ffc72c'],
  ['HOU', 'Houston', 'Orbit', '#ba0c2f', '#c4ced4'],
  ['IND', 'Indiana', 'Racers', '#002d62', '#fdbb30'],
  ['LAC', 'Los Angeles', 'Waves', '#1d428a', '#c8102e'],
  ['LAL', 'Hollywood', 'Stars', '#552583', '#fdb927'],
  ['MEM', 'Memphis', 'Blues', '#5d76a9', '#12173f'],
  ['MIA', 'Miami', 'Heatwave', '#98002e', '#f9a01b'],
  ['MIL', 'Milwaukee', 'Stags', '#00471b', '#eee1c6'],
  ['MIN', 'Minnesota', 'Howlers', '#0c2340', '#78be20'],
  ['NOP', 'New Orleans', 'Krewe', '#0c2340', '#c8102e'],
  ['NYK', 'New York', 'Empire', '#006bb6', '#f58426'],
  ['OKC', 'Oklahoma City', 'Storm', '#007ac1', '#ef3b24'],
  ['ORL', 'Orlando', 'Comets', '#0077c0', '#c4ced4'],
  ['PHI', 'Philadelphia', 'Liberty', '#006bb6', '#ed174c'],
  ['PHX', 'Phoenix', 'Scorch', '#1d1160', '#e56020'],
  ['POR', 'Portland', 'Timber', '#e03a3e', '#111111'],
  ['SAC', 'Sacramento', 'Monarchs', '#5a2d81', '#63727a'],
  ['SAS', 'San Antonio', 'Spurs Club', '#111111', '#c4ced4'],
  ['TOR', 'Toronto', 'Huskies', '#ce1141', '#111111'],
  ['UTA', 'Utah', 'Summit', '#002b5c', '#f9a01b'],
  ['WAS', 'Washington', 'Monuments', '#002b5c', '#e31837'],
].map(([abbr, city, nick, c1, c2], i) => ({ id: i, abbr, city, nick, name: `${city} ${nick}`, c1, c2 }));

export const GLEAGUE_NICKS = ['Cruise', 'Herd', 'Vipers', 'Swarm', 'Skyforce', 'Legends', 'Blue', 'Hustle', 'Gold', 'Charge', 'Squadron', 'Wolves'];

export const SHOWCASE_TEAMS = [
  { id: 100, abbr: 'EAST', city: 'East', nick: 'Elite', name: 'East Elite', c1: '#1b3a8a', c2: '#ffffff' },
  { id: 101, abbr: 'WEST', city: 'West', nick: 'Select', name: 'West Select', c1: '#b31b1b', c2: '#ffffff' },
  { id: 102, abbr: 'WRLD', city: 'World', nick: 'Team', name: 'World Team', c1: '#0b6e4f', c2: '#f2c14e' },
  { id: 103, abbr: 'USA', city: 'USA', nick: 'Juniors', name: 'USA Juniors', c1: '#0a2342', c2: '#e63946' },
];

const FIRST = ['Marcus', 'Jalen', 'Tyrese', 'Darius', 'Andre', 'Malik', 'Jordan', 'Isaiah', 'Kevin', 'Devin', 'Trey', 'Chris', 'Luka', 'Nikola', 'Josh', 'Zion', 'Caleb', 'Tre', 'Miles', 'Jaylen', 'DeAndre', 'Cam', 'Evan', 'Bam', 'Jamal', 'Paolo', 'Victor', 'Scottie', 'Amen', 'Cade', 'Kyle', 'Derrick', 'Rudy', 'Myles', 'Keon', 'Shai', 'Brandon', 'Jabari', 'Aaron', 'Terrence'];
const LAST = ['Walker', 'Johnson', 'Brooks', 'Harris', 'Mitchell', 'Allen', 'Green', 'Carter', 'Williams', 'Davis', 'Thompson', 'Robinson', 'Young', 'Bridges', 'Hayes', 'Murray', 'Porter', 'Jackson', 'Barnes', 'Grant', 'Holiday', 'Cunningham', 'Edwards', 'Banks', 'Wright', 'Fox', 'Ball', 'Hart', 'Brown', 'Turner', 'Simmons', 'Morant', 'Fields', 'Coleman', 'Hunter', 'Price', 'Reed', 'Stewart', 'Wallace', 'Okafor'];

export function randName(rng = Math.random) {
  return FIRST[Math.floor(rng() * FIRST.length)] + ' ' + LAST[Math.floor(rng() * LAST.length)];
}

export const POS_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Build a full attribute set for a position + playstyle around a base rating.
export function buildRatings(pos, style, base, rng = Math.random, jitter = 4) {
  const r = {};
  const pm = POSITIONS[pos].mods, sm = style ? PLAYSTYLES[style].mods : {};
  for (const a of ATTRS) {
    const j = (rng() - 0.5) * 2 * jitter;
    r[a.key] = Math.round(clamp(base + (pm[a.key] || 0) + (sm[a.key] || 0) + j, 25, 99));
  }
  return r;
}

export function overall(ratings, pos) {
  const w = POSITIONS[pos].weights;
  let sum = 0, wsum = 0;
  for (const a of ATTRS) {
    const wt = (w[a.key] || 0.6);
    sum += ratings[a.key] * wt; wsum += wt;
  }
  // Stretch so specialists aren't dragged down too much.
  return Math.round(clamp((sum / wsum) * 1.08 - 2, 25, 99));
}

export function upgradeCost(value) {
  if (value < 65) return 1;
  if (value < 75) return 2;
  if (value < 85) return 3;
  if (value < 92) return 4;
  return 5;
}

export const GRADES = [
  [95, 'A+'], [90, 'A'], [85, 'A-'], [80, 'B+'], [75, 'B'], [70, 'B-'],
  [65, 'C+'], [60, 'C'], [55, 'C-'], [50, 'D+'], [45, 'D'], [40, 'D-'], [-999, 'F'],
];
export function gradeLetter(score) { for (const [t, g] of GRADES) if (score >= t) return g; return 'F'; }
export function gradeColor(letter) {
  if (letter[0] === 'A') return '#3ddc84';
  if (letter[0] === 'B') return '#8fd14f';
  if (letter[0] === 'C') return '#f5c542';
  if (letter[0] === 'D') return '#f08a3c';
  return '#e5484d';
}

// Height range per position, in inches.
export const HEIGHT_RANGES = { PG: [72, 77], SG: [75, 79], SF: [77, 81], PF: [79, 83], C: [81, 87] };
export const BUILDS = {
  slim: { name: 'Slim', desc: 'Quicker, weaker', mods: { speed: 4, handle: 2, perD: 1, strength: -8 }, width: 0.92 },
  athletic: { name: 'Athletic', desc: 'Balanced', mods: {}, width: 1 },
  strong: { name: 'Strong', desc: 'Stronger, slower', mods: { strength: 8, intD: 2, reb: 2, speed: -4, handle: -1 }, width: 1.1 },
};
// Attribute caps: the most an attribute can be upgraded to. Small players top out on handles, speed and
// shooting; bigs on inside scoring, rebounding and rim protection. [cap at 6'0", cap at 7'3"]
const CAP_RANGE = {
  close: [84, 99], layup: [99, 86], dunk: [86, 97], mid: [99, 90], three: [99, 80], ft: [99, 88],
  pass: [99, 76], handle: [99, 70], perD: [99, 76], intD: [68, 99], steal: [99, 74], block: [62, 99],
  reb: [68, 99], speed: [99, 70], vert: [97, 84], strength: [72, 99], stamina: [99, 94],
};
// Builds trade caps: slim is quicker and a better shooter, strong owns the paint, athletic jumps out of the gym
const BUILD_CAPS = {
  slim: { speed: 3, handle: 3, perD: 3, three: 3, steal: 2, strength: -12, intD: -5, reb: -4, close: -3, block: -2, dunk: -3 },
  athletic: { vert: 3, dunk: 3, speed: 1, three: -2, strength: -3, handle: -1 },
  strong: { strength: 6, close: 4, intD: 4, reb: 4, block: 2, speed: -6, handle: -6, three: -5, perD: -4, vert: -4, steal: -3 },
};
export function attrCap(key, inches, build = 'athletic') {
  const [lo, hi] = CAP_RANGE[key] || [99, 99];
  const t = clamp((inches - 72) / 15, 0, 1);
  return Math.round(clamp(lo + (hi - lo) * t + ((BUILD_CAPS[build] || {})[key] || 0), 60, 99));
}

// Per inch above (or below) the position's standard height.
export const HEIGHT_MODS = { reb: 1.2, block: 1.2, intD: 1.0, close: 0.6, dunk: 0.3, speed: -1.2, handle: -1.0, three: -0.6, perD: -0.4 };
// Standing reach (feet) with one arm straight overhead, to the grip of the hand. The 3D model is built to match.
export function reachOf(heightFt) { return 1.22 * heightFt - 0.2; }
export function heightIn(ft) { return Math.round(ft * 12); }
export function fmtHeight(inches) { return `${Math.floor(inches / 12)}'${inches % 12}"`; }

// Badges: earned by doing things in games, each tier makes the effect stronger.
export const BADGE_TIERS = ['Bronze', 'Silver', 'Gold', 'Hall of Fame'];
export const BADGE_COLORS = ['#c27c3e', '#c9d1d9', '#ffd23f', '#b48cff'];
export const BADGES = {
  posterizer:  { cat: 'Scoring', name: 'Posterizer', desc: 'More contact dunks on defenders', earn: 'Dunk (posterizers count triple)', need: [3, 12, 30, 70] },
  acrobat:     { cat: 'Scoring', name: 'Acrobat', desc: 'Better layups through contact', earn: 'Make layups', need: [4, 15, 35, 80] },
  catchShoot:  { cat: 'Scoring', name: 'Catch & Shoot', desc: 'Boost on jumpers right after a catch', earn: 'Make catch-and-shoot jumpers', need: [3, 12, 30, 70] },
  deadeye:     { cat: 'Scoring', name: 'Deadeye', desc: 'Contests hurt your jumper less', earn: 'Make contested jumpers', need: [3, 10, 25, 60] },
  fadeAce:     { cat: 'Scoring', name: 'Fade Ace', desc: 'Better post fades and hooks', earn: 'Make post fades and hooks', need: [2, 8, 20, 50] },
  greenMachine:{ cat: 'Scoring', name: 'Green Machine', desc: 'Bigger green window after a green', earn: 'Green releases', need: [4, 15, 35, 80] },
  bully:       { cat: 'Scoring', name: 'Bully', desc: 'Stronger post backdowns', earn: 'Back defenders down in the post', need: [6, 25, 60, 140] },
  ankleBreaker:{ cat: 'Playmaking', name: 'Ankle Breaker', desc: 'Dribble moves shake defenders more', earn: 'Beat defenders (ankle breakers count triple)', need: [4, 15, 35, 80] },
  dimer:       { cat: 'Playmaking', name: 'Dimer', desc: 'Teammates shoot better off your passes', earn: 'Assists', need: [4, 15, 40, 90] },
  needle:      { cat: 'Playmaking', name: 'Needle Threader', desc: 'Your passes are harder to intercept', earn: 'Complete passes', need: [15, 60, 150, 350] },
  interceptor: { cat: 'Defense', name: 'Interceptor', desc: 'More steals and picked-off passes', earn: 'Steals', need: [3, 10, 25, 60] },
  rimProtector:{ cat: 'Defense', name: 'Rim Protector', desc: 'Better shot blocking', earn: 'Blocks', need: [3, 10, 25, 60] },
  clamps:      { cat: 'Defense', name: 'Clamps', desc: 'Dribble moves fail more against you, tighter contests', earn: 'Force misses', need: [4, 15, 35, 80] },
  rebound:     { cat: 'Defense', name: 'Rebound Chaser', desc: 'Win more rebounds', earn: 'Rebounds', need: [6, 25, 60, 140] },
  brickWall:   { cat: 'Defense', name: 'Brick Wall', desc: 'Screens and charges hit harder', earn: 'Screens and charges taken', need: [3, 10, 25, 60] },
};
export function badgeTier(key, count) {
  const need = BADGES[key].need;
  let t = 0;
  for (let i = 0; i < need.length; i++) if (count >= need[i]) t = i + 1;
  return t;
}

// High school state tournament (your school is first)
export const HS_TEAMS = [
  ['WSP', 'Westside Prep', 'Panthers', '#5b2a86', '#f2c14e'],
  ['STA', 'St. Augustine', 'Saints', '#0b3d91', '#ffffff'],
  ['CCK', 'Central Catholic', 'Knights', '#8b0000', '#d4af37'],
  ['OKM', 'Oakmont Academy', 'Warriors', '#1f5f2f', '#f4f4f4'],
  ['RVR', 'Riverside', 'Raiders', '#222222', '#e63946'],
  ['LHL', 'Lincoln Heights', 'Lions', '#d97706', '#1e293b'],
].map(([abbr, city, nick, c1, c2], i) => ({ id: 300 + i, abbr, city, nick, name: `${city} ${nick}`, c1, c2 }));

// College programs (ovr = how good the program is)
export const COLLEGES = [
  ['NRT', 'Northridge Tech', 'Hawks', '#002f6c', '#ffb81c', 62],
  ['KGU', 'Kingsport', 'Royals', '#4b2e83', '#e8d3a2', 61],
  ['BSM', 'Bayview State', 'Mariners', '#00557f', '#f4f4f4', 59],
  ['CCC', 'Capitol City', 'Cardinals', '#a6192e', '#ffffff', 58],
  ['LAM', 'Lakeshore A&M', 'Bulldogs', '#500000', '#ffffff', 56],
  ['DVS', 'Desert Valley', 'Scorpions', '#c25e00', '#1b1b1b', 55],
  ['MTR', 'Mountain Ridge', 'Rams', '#2e5e3e', '#c8a24a', 53],
  ['GCP', 'Gulf Coast', 'Pelicans', '#0e7c86', '#f6c85f', 52],
  ['PNU', 'Pinewood', 'Lumberjacks', '#3a5a40', '#f2e8cf', 51],
  ['SHC', 'Silver Hill', 'Comets', '#4a4e69', '#c9ada7', 50],
].map(([abbr, city, nick, c1, c2, ovr], i) => ({ id: 400 + i, abbr, city, nick, name: `${city} ${nick}`, c1, c2, ovr }));
