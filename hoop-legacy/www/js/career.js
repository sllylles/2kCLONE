// MyCareer state machine: showcase → draft → (G League) → NBA → playoffs → Finals.
import { TEAMS, SHOWCASE_TEAMS, GLEAGUE_NICKS, POSITIONS, POS_ORDER, PLAYSTYLES, ATTRS, SKIN_TONES, HAIR, BUILDS, HEIGHT_MODS, BADGES, badgeTier, heightIn, HS_TEAMS, COLLEGES,
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
export function loadCareer() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
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

export function startingRatings(pos, style, rng = Math.random, inches = null, build = 'athletic', target = START_OVR) {
  const r = buildRatings(pos, style, 40, rng, 2);
  const dIn = inches == null ? 0 : inches - heightIn(POSITIONS[pos].height);
  for (const k in HEIGHT_MODS) r[k] = clamp(Math.round(r[k] + HEIGHT_MODS[k] * dIn), 25, 99);
  const bm = (BUILDS[build] || BUILDS.athletic).mods;
  for (const k in bm) r[k] = clamp(r[k] + bm[k], 25, 99);
  const out = tuneToOverall(r, pos, target);
  const inch = inches == null ? heightIn(POSITIONS[pos].height) : inches;
  for (const k in out) out[k] = Math.min(out[k], attrCap(k, inch, build));
  return out;
}

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
    c.badges[k] = Math.round(((c.badges[k] || 0) + counts[k]) * 10) / 10;
    const after = badgeTier(k, c.badges[k]);
    if (after > before) ups.push({ key: k, tier: after });
  }
  return ups;
}

export function newCareer(p) {
  const inches = p.heightIn || heightIn(POSITIONS[p.position].height);
  const ratings = startingRatings(p.position, p.style, Math.random, inches, p.build || 'athletic');
  const teamOvr = {};
  const rng = mulberry(Date.now() & 0xffff);
  for (const t of TEAMS) teamOvr[t.id] = Math.round(73 + rng() * 11);
  const c = {
    version: 1,
    storyV: 2,
    seed: Math.floor(Math.random() * 1e6),
    player: { ...p, ratings, heightFt: inches / 12, build: p.build || 'athletic' },
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
  c.phase = 'college';
  c.pendingStory = 'college';
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
  return attrCap(key, Math.round(P.heightFt * 12), P.build || 'athletic');
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
  c.nba = {
    teamId, starter: false, trust: 0, rookieBoost: 5, gp: 0, record: [0, 0],
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
  const home = Math.random() < 0.5;
  return {
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
  const out = { ap, letter, gradeScore, win, notes: [], boosts: [], badgeUps: [] };
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
