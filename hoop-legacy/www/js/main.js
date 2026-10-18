// App shell: screens, MyCareer flow, game loop and HUD.
import { ATTRS, POSITIONS, PLAYSTYLES, DRIBBLE_STYLES, JUMPSHOTS, SKIN_TONES, HAIR, TEAMS, POS_ORDER,
  buildRatings, overall, gradeLetter, gradeColor, upgradeCost, HEIGHT_RANGES, BUILDS, heightIn, fmtHeight,
  BADGES, BADGE_TIERS, BADGE_COLORS, badgeTier } from './data.js';
import * as C from './career.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Controls } from './controls.js';
import { sfx, unlock, setMuted, startCrowd, stopCrowd } from './audio.js';
import { Recorder, ReplayPlayer } from './replay.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

let settings = C.loadSettings();
C.setMaxed(settings.maxed);
const apText = c => C.isMaxed() ? '∞ AP' : `${c.ap} AP`;
let career = C.loadCareer();
let screenStack = [];
setMuted(!settings.sound);

function syncCareerSettings() {
  if (!career) return;
  career.settingsSeasonLength = settings.seasonLength;
  career.seriesLen = settings.seriesLen;
}
syncCareerSettings();

// ---------------- Screen nav ----------------
function show(id, push = true) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  if (push) screenStack.push(id);
  $('gl').style.visibility = id === 'scrGame' ? 'visible' : 'hidden';
}
function back() {
  screenStack.pop();
  const prev = screenStack.pop() || 'scrTitle';
  if (prev === 'scrHub') renderHub();
  show(prev);
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { sfx.click(); back(); }));
document.addEventListener('pointerdown', () => unlock(), { once: false, passive: true });

// ---------------- Title ----------------
function renderTitle() {
  $('btnContinue').style.display = career ? '' : 'none';
  screenStack = [];
  show('scrTitle');
}
$('btnContinue').onclick = () => { sfx.click(); goCareer(); };
$('btnNew').onclick = () => {
  sfx.click();
  if (career) {
    confirmModal('Start a new career? Your current career will be deleted.', () => { C.deleteCareer(); career = null; startCreator(); });
  } else startCreator();
};
$('btnTitleSettings').onclick = () => { sfx.click(); renderSettings(); };

function confirmModal(text, yes) {
  const m = $('modal');
  m.innerHTML = `<div class="ov-card"><p>${esc(text)}</p><div class="ov-btns"><button class="btn ghost" id="mNo">CANCEL</button><button class="btn primary" id="mYes">YES</button></div></div>`;
  m.classList.add('on');
  $('mNo').onclick = () => m.classList.remove('on');
  $('mYes').onclick = () => { m.classList.remove('on'); yes(); };
}

// ---------------- Creator ----------------
const draft = { name: '', num: 23, position: 'SG', heightIn: 78, build: 'athletic', style: 'sharpshooter', dribble: 'quick', jumpshot: 'standard', skin: SKIN_TONES[2], hair: 'Fade', headband: false, sleeve: false };
let cStep = 0;
const C_STEPS = ['Identity', 'Position', 'Playstyle', 'Dribble & Shot', 'Look'];

function startCreator() { cStep = 0; renderCreator(); show('scrCreate'); }

function previewRatings() {
  return C.startingRatings(draft.position, draft.style, () => 0.5, draft.heightIn, draft.build);
}

function cardHTML(p, ratings, extra = '') {
  const ovr = overall(ratings, p.position);
  const top = ATTRS.map(a => ({ a, v: ratings[a.key] })).sort((x, y) => y.v - x.v).slice(0, 7);
  return `<div class="pc-top"><div class="pc-ovr">${ovr}<small>OVR</small></div>
    <div><div class="pc-name">${esc(p.name || 'Your Name')}</div><div class="pc-sub">#${p.num} · ${fmtHeight(p.heightIn || heightIn(p.heightFt || POSITIONS[p.position].height))} ${POSITIONS[p.position].name} · ${PLAYSTYLES[p.style].name}${p.build && p.build !== 'athletic' ? ' · ' + BUILDS[p.build].name : ''}</div></div></div>
    ${extra}
    <div class="bars">${top.map(({ a, v }) => `<div class="bar-row"><span>${a.name}</span><div class="track"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>`;
}

function renderCreator() {
  $('createSteps').innerHTML = C_STEPS.map((_, i) => `<i class="${i <= cStep ? 'on' : ''}"></i>`).join('');
  const m = $('createMain');
  const choice = (group, key, title, desc, sel) => `<button class="choice ${sel ? 'sel' : ''}" data-g="${group}" data-k="${key}"><b>${title}</b><small>${desc}</small></button>`;
  if (cStep === 0) {
    m.innerHTML = `<h3>PLAYER NAME</h3><div class="field"><input id="inName" maxlength="22" placeholder="First Last" value="${esc(draft.name)}" autocomplete="off"></div>
      <h3>JERSEY NUMBER</h3><div class="wheel-wrap"><div class="wheel-band"></div><div class="wheel" id="numWheel"><div class="wpad"></div>${Array.from({ length: 100 }, (_, n) => `<div class="wi" data-n="${n}">${n}</div>`).join('')}<div class="wpad"></div></div></div>`;
    const inp = $('inName');
    inp.addEventListener('input', () => { draft.name = inp.value; $('createCard').innerHTML = cardHTML(draft, previewRatings()); });
    setupWheel();
  } else if (cStep === 1) {
    const [hMin, hMax] = HEIGHT_RANGES[draft.position];
    m.innerHTML = `<h3>POSITION</h3><div class="choices">${POS_ORDER.map(k => choice('position', k, `${k} · ${POSITIONS[k].name}`, `${fmtHeight(HEIGHT_RANGES[k][0])} – ${fmtHeight(HEIGHT_RANGES[k][1])}`, draft.position === k)).join('')}</div>
      <h3>HEIGHT</h3><div class="field slider"><input type="range" id="inHeight" min="${hMin}" max="${hMax}" step="1" value="${draft.heightIn}"><b id="hLabel">${fmtHeight(draft.heightIn)}</b></div>
      <small class="hint">Taller: better rebounding, blocking and inside D. Shorter: quicker with better handles and shooting.</small>
      <h3>BUILD</h3><div class="choices">${Object.entries(BUILDS).map(([k, b]) => choice('build', k, b.name, b.desc, draft.build === k)).join('')}</div>`;
    const hs = $('inHeight');
    hs.addEventListener('input', () => { draft.heightIn = +hs.value; $('hLabel').textContent = fmtHeight(draft.heightIn); $('createCard').innerHTML = cardHTML(draft, previewRatings()); });
  } else if (cStep === 2) {
    m.innerHTML = `<h3>PLAYSTYLE</h3><div class="choices">${Object.entries(PLAYSTYLES).map(([k, s]) => choice('style', k, s.name, s.desc, draft.style === k)).join('')}</div>`;
  } else if (cStep === 3) {
    m.innerHTML = `<h3>DRIBBLE STYLE</h3><div class="choices">${Object.entries(DRIBBLE_STYLES).map(([k, s]) => choice('dribble', k, s.name, s.desc, draft.dribble === k)).join('')}</div>
      <h3>JUMPSHOT</h3><div class="choices">${Object.entries(JUMPSHOTS).map(([k, s]) => choice('jumpshot', k, s.name, k === 'quick' ? 'Fast release, smaller green window.' : k === 'higharc' ? 'Slow and steady, bigger green window.' : 'Balanced timing.', draft.jumpshot === k)).join('')}</div>`;
  } else {
    m.innerHTML = `<h3>SKIN TONE</h3><div class="swatches">${SKIN_TONES.map(c => `<button class="swatch ${draft.skin === c ? 'sel' : ''}" style="background:${c}" data-g="skin" data-k="${c}"></button>`).join('')}</div>
      <h3>HAIR</h3><div class="chips">${HAIR.map(h => `<button class="chip ${draft.hair === h ? 'sel' : ''}" data-g="hair" data-k="${h}">${h}</button>`).join('')}</div>
      <h3>ACCESSORIES</h3><div class="chips"><button class="chip ${draft.headband ? 'sel' : ''}" data-g="headband" data-k="1">Headband</button><button class="chip ${draft.sleeve ? 'sel' : ''}" data-g="sleeve" data-k="1">Arm Sleeve</button></div>`;
  }
  m.querySelectorAll('[data-g]').forEach(el => el.addEventListener('click', () => {
    sfx.click();
    const g = el.dataset.g, k = el.dataset.k;
    if (g === 'num') draft.num = +k;
    else if (g === 'position') { draft.position = k; draft.heightIn = heightIn(POSITIONS[k].height); }
    else if (g === 'headband' || g === 'sleeve') draft[g] = !draft[g];
    else draft[g] = k;
    renderCreator();
  }));
  $('createCard').innerHTML = cardHTML(draft, previewRatings(), `<div class="pc-team">${DRIBBLE_STYLES[draft.dribble].name} handles · ${JUMPSHOTS[draft.jumpshot].name} jumper</div>`);
  $('createPrev').style.visibility = cStep === 0 ? 'hidden' : 'visible';
  $('createNext').textContent = cStep === C_STEPS.length - 1 ? 'START CAREER' : 'NEXT';
}
function setupWheel() {
  const w = $('numWheel'), H = 40;
  const paint = () => {
    const c = w.scrollTop / H;
    w.querySelectorAll('.wi').forEach(el => {
      const d = Math.abs(+el.dataset.n - c);
      el.style.opacity = Math.max(0.15, 1 - d * 0.3);
      el.style.transform = `scale(${Math.max(0.7, 1.15 - d * 0.18)}) rotateX(${Math.max(-60, Math.min(60, (+el.dataset.n - c) * 22))}deg)`;
      el.classList.toggle('sel', d < 0.5);
    });
  };
  w.scrollTop = draft.num * H;
  paint();
  let t = null;
  w.addEventListener('scroll', () => {
    paint();
    clearTimeout(t);
    t = setTimeout(() => {
      const n = Math.max(0, Math.min(99, Math.round(w.scrollTop / H)));
      if (n !== draft.num) { draft.num = n; sfx.click(); $('createCard').innerHTML = cardHTML(draft, previewRatings()); }
    }, 90);
  }, { passive: true });
  w.querySelectorAll('.wi').forEach(el => el.addEventListener('click', () => w.scrollTo({ top: +el.dataset.n * H, behavior: 'smooth' })));
}

function heightStr(h) { const ft = Math.floor(h), inch = Math.round((h - ft) * 12); return `${ft}'${inch}"`; }

$('createPrev').onclick = () => { sfx.click(); if (cStep > 0) { cStep--; renderCreator(); } };
$('createNext').onclick = () => {
  sfx.click();
  if (cStep === 0 && !draft.name.trim()) { $('inName').focus(); $('inName').style.borderColor = 'var(--red)'; return; }
  if (cStep < C_STEPS.length - 1) { cStep++; renderCreator(); return; }
  draft.name = draft.name.trim().replace(/\s+/g, ' ');
  career = C.newCareer({ ...draft });
  syncCareerSettings();
  C.saveCareer(career);
  goCareer();
};

// ---------------- Story ----------------
function playStory(key, done) {
  const s = C.story(career, key);
  if (!s) { done(); return; }
  let i = 0;
  $('storyTitle').textContent = s.title;
  $('storySpeaker').textContent = s.speaker;
  const line = $('storyLine');
  const step = () => {
    if (i >= s.lines.length) { $('scrStory').onclick = null; done(); return; }
    line.textContent = s.lines[i++];
    line.style.animation = 'none'; void line.offsetWidth; line.style.animation = '';
  };
  $('scrStory').onclick = () => { sfx.click(); step(); };
  step();
  show('scrStory', false);
}

// ---------------- Career routing ----------------
function goCareer() {
  syncCareerSettings();
  if (career.pendingStory) {
    const k = career.pendingStory;
    career.pendingStory = null;
    C.saveCareer(career);
    playStory(k, goCareer);
    return;
  }
  if (career.phase === 'draft') { runDraftNight(); return; }
  if (career.phase === 'recruit') { renderRecruit(); return; }
  if (career.phase === 'collegeDecision') { renderCollegeDecision(); return; }
  if (career.phase === 'resign') { renderResign(); return; }
  if (career.phase === 'offseason') {
    C.startNextSeason(career); C.saveCareer(career); goCareer(); return;
  }
  screenStack = ['scrTitle'];
  renderHub();
  show('scrHub');
}

function teamLogo(t) { return `<div class="ng-logo" style="background:${t.c1};border-color:${t.c2};color:${t.c2}">${t.abbr}</div>`; }

function renderHub() {
  const c = career;
  const P = c.player;
  const phaseName = { hs: 'HIGH SCHOOL · SENIOR YEAR', college: `COLLEGE · YEAR ${c.college ? c.college.year : 1}`, showcase: c.storyV === 2 ? 'DRAFT COMBINE' : 'PROSPECT SHOWCASE', gleague: 'G LEAGUE', nba: `SEASON ${c.season}`, playoffs: 'PLAYOFFS' }[c.phase] || 'MYCAREER';
  $('hubPhase').textContent = phaseName;
  $('hubAP').textContent = apText(c);
  let teamLine = '';
  if (c.phase === 'hs') teamLine = c.hs.team.name;
  else if (c.phase === 'college') teamLine = c.college.team.name;
  else if (c.phase === 'gleague') teamLine = c.gleague.teams[0].name;
  else if (c.nba) teamLine = TEAMS[c.nba.teamId].name + (c.nba.starter ? ' · Starter' : ' · Bench');
  else teamLine = 'Prospect';
  $('hubCard').innerHTML = cardHTML(P, P.ratings, `<div class="pc-team">${esc(teamLine)}</div>`);
  const info = C.nextGame(c, settings);
  let meter = '';
  if (c.phase === 'hs' || c.phase === 'college') {
    const sc = Math.min(100, c.scout || 0);
    const rec = c.phase === 'college' ? ` · ${c.college.record[0]}-${c.college.record[1]}` : '';
    meter = `<div class="ng-meter"><div class="lbl"><span>SCOUTING</span><span>${sc}${rec}</span></div><div class="track"><i style="width:${sc}%"></i></div></div>`;
  } else if (c.phase === 'showcase') {
    const st = C.draftStock(c);
    meter = `<div class="ng-meter"><div class="lbl"><span>DRAFT STOCK</span><span>${st.label}</span></div><div class="track"><i style="width:${Math.min(100, st.score)}%"></i></div></div>`;
  } else if (c.phase === 'gleague') {
    meter = `<div class="ng-meter"><div class="lbl"><span>CALL-UP METER</span><span>${c.gleague.callUp}% · ${c.gleague.record[0]}-${c.gleague.record[1]}</span></div><div class="track"><i style="width:${c.gleague.callUp}%"></i></div></div>`;
  } else if (c.nba) {
    const n = c.nba;
    meter = n.starter
      ? `<div class="ng-meter"><div class="lbl"><span>RECORD</span><span>${n.record[0]}-${n.record[1]}</span></div><div class="track"><i style="width:${(n.record[0] / Math.max(1, n.schedule.length)) * 100}%"></i></div></div>`
      : `<div class="ng-meter"><div class="lbl"><span>COACH TRUST → STARTING 5</span><span>${n.trust}% · ${n.record[0]}-${n.record[1]}</span></div><div class="track"><i style="width:${n.trust}%"></i></div></div>`;
  }
  $('hubNext').innerHTML = `<div class="ng-label">${esc(info.label)}</div>
    <div class="ng-match"><div class="ng-team">${teamLogo(info.myTeam)}<b>${esc(info.myTeam.name)}</b><small>${info.myOvr} OVR</small></div>
    <div class="ng-vs">VS</div>
    <div class="ng-team">${teamLogo(info.opp)}<b>${esc(info.opp.name)}</b><small>${info.oppOvr} OVR</small></div></div>
    ${info.tag ? `<div class="ng-tag">${esc(info.tag)}</div>` : ''}
    ${meter}
    <div class="ng-btns"><button class="btn ghost" id="btnSim">SIM GAME</button><button class="btn primary" id="btnPlay">PLAY GAME</button></div>`;
  $('btnPlay').onclick = () => { sfx.click(); startMatch(info); };
  $('btnSim').onclick = () => {
    sfx.click();
    confirmModal('Simulate this game? Simmed games earn less AP.', () => {
      const res = C.simulateGame(career, info);
      finishMatch(info, res);
    });
  };
  $('hubUpgrade').innerHTML = `<b>UPGRADE ${c.ap > 0 || C.isMaxed() ? `<span class="badge">${C.isMaxed() ? '∞' : c.ap}</span>` : ''}</b><small>Spend attribute points</small>`;
  $('hubStandings').style.display = c.nba ? '' : 'none';
}

$('hubUpgrade').onclick = () => { sfx.click(); renderUpgrade(); show('scrUpgrade'); };
$('hubStandings').onclick = () => { sfx.click(); renderStandings(); };
$('hubHistory').onclick = () => { sfx.click(); renderHistory(); };
$('hubStyle').onclick = () => { sfx.click(); renderStyle(); };
$('hubBadges').onclick = () => { sfx.click(); renderBadges(); };

function badgeChip(key, tier) {
  const col = tier ? BADGE_COLORS[tier - 1] : '#3a3f50';
  return `<span class="bdg" style="--bc:${col}">${BADGES[key].name[0]}</span>`;
}

function renderBadges() {
  const c = career, prog = c.badges || {};
  $('listTitle').textContent = 'BADGES';
  let html = '<p style="color:var(--dim);font-size:12px;margin:0 0 6px">Badges level up as you do things in games. Every tier makes the effect stronger: Bronze, Silver, Gold, Hall of Fame.</p>';
  for (const cat of ['Scoring', 'Playmaking', 'Defense']) {
    html += `<div class="up-group">${cat.toUpperCase()}</div><div class="badge-grid">`;
    for (const [k, b] of Object.entries(BADGES)) {
      if (b.cat !== cat) continue;
      const n = prog[k] || 0, t = C.isMaxed() ? BADGE_TIERS.length : badgeTier(k, n);
      const next = b.need[t], prev = t ? b.need[t - 1] : 0;
      const pct = next ? Math.min(100, (n - prev) / (next - prev) * 100) : 100;
      html += `<div class="badge-row">${badgeChip(k, t)}<div class="bi"><b>${b.name}</b> <em style="color:${t ? BADGE_COLORS[t - 1] : 'var(--dim)'}">${t ? BADGE_TIERS[t - 1] : 'Locked'}</em>
        <small>${b.desc}</small><div class="track"><i style="width:${pct}%"></i></div><small>${b.earn}: ${Math.floor(n)}${next ? ' / ' + next : ' (max)'}</small></div></div>`;
    }
    html += '</div>';
  }
  $('listBody').innerHTML = html;
  show('scrList');
}
$('hubMenu').onclick = () => {
  sfx.click();
  const m = $('modal');
  m.innerHTML = `<div class="ov-card"><h1>MENU</h1><div class="ov-btns" style="flex-direction:column">
    <button class="btn" id="mmSettings">SETTINGS</button><button class="btn" id="mmTitle">MAIN MENU</button><button class="btn ghost" id="mmClose">CLOSE</button></div></div>`;
  m.classList.add('on');
  $('mmClose').onclick = () => m.classList.remove('on');
  $('mmSettings').onclick = () => { m.classList.remove('on'); renderSettings(); };
  $('mmTitle').onclick = () => { m.classList.remove('on'); renderTitle(); };
};

function renderUpgrade() {
  const c = career, r = c.player.ratings;
  $('upAP').textContent = apText(c);
  $('upOVR').textContent = `${C.userOverall(c)} OVR`;
  let html = '', group = '';
  for (const a of ATTRS) {
    if (a.group !== group) { group = a.group; html += `<div class="up-group">${group.toUpperCase()}</div>`; }
    const v = r[a.key], cost = upgradeCost(v);
    html += `<div class="up-row" id="up_${a.key}"><div><div class="nm">${a.name}</div><div class="track"><i style="width:${v}%"></i></div></div>
      <div class="val">${v}</div><button class="plus" data-k="${a.key}" ${(!C.isMaxed() && c.ap < cost) || v >= 99 ? 'disabled' : ''}>+1<small>${v >= 99 ? 'MAX' : cost + ' AP'}</small></button></div>`;
  }
  $('upList').innerHTML = html;
  $('upList').querySelectorAll('.plus').forEach(b => b.addEventListener('click', () => {
    if (C.upgrade(c, b.dataset.k)) {
      sfx.click(); C.saveCareer(c);
      const scroll = $('upList').scrollTop;
      renderUpgrade();
      $('upList').scrollTop = scroll;
      $('up_' + b.dataset.k).classList.add('flash');
    }
  }));
}

function renderStandings() {
  const list = C.standingsList(career);
  $('listTitle').textContent = 'STANDINGS';
  $('listBody').innerHTML = `<table><tr><th>#</th><th>TEAM</th><th>W</th><th>L</th><th>PCT</th><th>OVR</th></tr>${list.map((x, i) =>
    `<tr class="${x.team.id === career.nba.teamId ? 'me' : ''} ${i === 15 ? 'cut' : ''}"><td>${i + 1}</td><td><span class="dot" style="background:${x.team.c1}"></span>${esc(x.team.name)}</td><td>${x.w}</td><td>${x.l}</td><td>${x.pct.toFixed(3).replace(/^0/, '')}</td><td>${career.teamOvr[x.team.id]}</td></tr>`).join('')}</table>
    <p style="color:var(--dim);font-size:12px">Top 16 make the playoffs.</p>`;
  show('scrList');
}

function renderHistory() {
  const c = career, t = c.totals, gp = Math.max(1, t.gp);
  $('listTitle').textContent = 'CAREER';
  const avg = k => (t[k] / gp).toFixed(1);
  $('listBody').innerHTML = `<div class="statline"><div><b>${t.gp}</b><small>GP</small></div><div><b>${avg('pts')}</b><small>PPG</small></div><div><b>${avg('reb')}</b><small>RPG</small></div><div><b>${avg('ast')}</b><small>APG</small></div><div><b>${avg('stl')}</b><small>SPG</small></div><div><b>${avg('blk')}</b><small>BPG</small></div></div>
    ${c.awards.length ? `<div class="notes">${c.awards.map(a => `<div>🏆 ${esc(a)}</div>`).join('')}</div>` : ''}
    <table><tr><th>SEASON</th><th>PHASE</th><th>OPP</th><th>RESULT</th><th>GRD</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th></tr>
    ${c.history.slice().reverse().map(h => `<tr><td>${h.season}</td><td>${h.phase.toUpperCase()}</td><td>${h.opp}</td><td style="color:${h.win ? 'var(--green)' : 'var(--red)'}">${h.win ? 'W' : 'L'} ${h.my}-${h.them}</td><td style="color:${gradeColor(h.grade)}">${h.grade}</td><td>${h.pts}</td><td>${h.reb}</td><td>${h.ast}</td><td>${h.stl}</td><td>${h.blk}</td><td>${h.fgm}/${h.fga}</td></tr>`).join('')}</table>`;
  show('scrList');
}

function renderStyle() {
  const P = career.player;
  $('listTitle').textContent = 'MY PLAYER';
  const seg = (key, opts) => `<div class="seg">${Object.entries(opts).map(([k, v]) => `<button data-s="${key}" data-k="${k}" class="${P[key] === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>`;
  $('listBody').innerHTML = `
    <div class="set-row"><label>Dribble Style<small>${DRIBBLE_STYLES[P.dribble].desc}</small></label>${seg('dribble', DRIBBLE_STYLES)}</div>
    <div class="set-row"><label>Jumpshot<small>Changes meter speed and green window size</small></label>${seg('jumpshot', JUMPSHOTS)}</div>`;
  $('listBody').querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { sfx.click(); P[b.dataset.s] = b.dataset.k; C.saveCareer(career); renderStyle(); }));
  if (screenStack[screenStack.length - 1] !== 'scrList') show('scrList');
}

function renderSettings() {
  const S = settings;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-s="${key}" data-v="${v}" class="${String(S[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('settingsBody').innerHTML = `
    <div class="set-row"><label>Quarter Length</label>${seg('qLen', [[2, '2 min'], [3, '3 min'], [5, '5 min'], [8, '8 min']])}</div>
    <div class="set-row"><label>Difficulty</label>${seg('difficulty', [[0, 'Rookie'], [1, 'Pro'], [2, 'All-Star'], [3, 'Hall of Fame']])}</div>
    <div class="set-row"><label>Season Length<small>Regular season games you play</small></label>${seg('seasonLength', [[10, '10'], [16, '16'], [29, '29'], [41, '41']])}</div>
    <div class="set-row"><label>Playoff Series<small>Short: best-of-3, Finals best-of-5</small></label>${seg('seriesLen', [['short', 'Short'], ['long', 'Best-of-7']])}</div>
    <div class="set-row"><label>Camera</label>${seg('camera', [['2k', '2K Cam'], ['broadcast', 'Broadcast']])}</div>
    <div class="set-row"><label>Graphics</label>${seg('quality', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']])}</div>
    <div class="set-row"><label>Auto Defensive Assist<small>Also guard your man automatically whenever the stick is idle (the DEF ASSIST stick always works)</small></label>${seg('defAssist', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Button Layout<small>Move and resize buttons from the in-game pause menu (MOVE BUTTONS)</small></label><button class="btn ghost" id="resetLayout">RESET LAYOUT</button></div>
    <div class="set-row"><label>Replays<small>Instant replays of big plays and a highlight reel after each game</small></label>${seg('replays', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Infinite AP + All Badges<small>Upgrades cost nothing and every badge is Hall of Fame. Turn off to go back to your earned progress</small></label>${seg('maxed', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Sound</label>${seg('sound', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Vibration</label>${seg('vibrate', [[true, 'On'], [false, 'Off']])}</div>
    <p style="color:var(--dim);font-size:12px">Season length applies from the next season you start.</p>`;
  $('resetLayout').onclick = () => { try { localStorage.removeItem('hoops.layout.v1'); } catch (e) { /* ignore */ } if (controls) controls.resetLayout(); sfx.click(); };
  $('settingsBody').querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    sfx.click();
    let v = b.dataset.v;
    if (v === 'true') v = true; else if (v === 'false') v = false; else if (!isNaN(+v)) v = +v;
    settings[b.dataset.s] = v;
    C.saveSettings(settings);
    setMuted(!settings.sound);
    C.setMaxed(settings.maxed);
    if (b.dataset.s === 'quality') renderer = null;
    renderSettings();
  }));
  if (screenStack[screenStack.length - 1] !== 'scrSettings') show('scrSettings');
}

// ---------------- Draft night ----------------
// ---------- Story decision screens ----------
function choiceCards(items) {
  return `<div class="offer-grid">${items.map((it, i) => `<button class="offer" data-i="${i}" style="--c1:${it.c1};--c2:${it.c2}">
    ${teamLogo(it)}<b>${esc(it.title)}</b><small>${esc(it.sub)}</small><em>${esc(it.perk)}</em></button>`).join('')}</div>`;
}

function renderRecruit() {
  const offers = C.collegeOffers(career);
  C.saveCareer(career);
  const items = offers.map(o => { const t = C.teamOf(career, o.id); return { ...t, title: t.name, sub: `Program rating ${t.ovr}`, perk: o.role }; });
  $('draftBody').innerHTML = `<h1 class="reveal">COLLEGE OFFERS</h1><p>Scouting score ${Math.min(100, career.scout)}. Three programs want you. Pick where you'll play your college season and chase the title.</p>${choiceCards(items)}`;
  show('scrDraft', false);
  $('draftBody').querySelectorAll('.offer').forEach(b => b.onclick = () => {
    const o = offers[+b.dataset.i];
    confirmModal(`Commit to ${C.teamOf(career, o.id).name}?`, () => { sfx.cheer(1.2); C.chooseCollege(career, o.id); C.saveCareer(career); goCareer(); });
  });
}

function renderCollegeDecision() {
  const k = career.college, canReturn = k.year < 4;
  $('draftBody').innerHTML = `<h1 class="reveal">DECISION TIME</h1>
    <p>Year ${k.year} at ${esc(k.team.name)} is over (${k.record[0]}-${k.record[1]}). Your overall is ${C.userOverall(career)}.</p>
    <div class="offer-grid">
      ${canReturn ? `<button class="offer" id="dcReturn"><b>RETURN FOR YEAR ${k.year + 1}</b><small>Another season of growth</small><em>+10 AP, stronger team, more scouting</em></button>` : ''}
      <button class="offer" id="dcDeclare"><b>DECLARE FOR THE DRAFT</b><small>Go to the Draft Combine</small><em>3 games decide your draft fate</em></button>
    </div>`;
  show('scrDraft', false);
  if (canReturn) $('dcReturn').onclick = () => { sfx.click(); C.returnToCollege(career); C.saveCareer(career); goCareer(); };
  $('dcDeclare').onclick = () => confirmModal('Declare for the NBA Draft?', () => { sfx.cheer(1); C.declareForDraft(career); C.saveCareer(career); goCareer(); });
}

function renderResign() {
  const cur = TEAMS[career.nba.teamId];
  $('draftBody').innerHTML = `<h1 class="reveal">CHAMPION'S CHOICE</h1><p>You won it all with the ${esc(cur.name)}. Stay and run it back, or see what other teams will offer.</p>
    <div class="offer-grid"><button class="offer" id="rsStay" style="--c1:${cur.c1};--c2:${cur.c2}">${teamLogo(cur)}<b>RE-SIGN</b><small>${esc(cur.name)}</small><em>+15 AP · +2 to your 3 best attributes · team gets better</em></button>
    <button class="offer" id="rsFA"><b>TEST FREE AGENCY</b><small>Hear offers from 3 teams</small><em>Different deals and perks</em></button></div>`;
  show('scrDraft', false);
  $('rsStay').onclick = () => { sfx.cheer(1); C.resignTeam(career); C.saveCareer(career); goCareer(); };
  $('rsFA').onclick = () => {
    sfx.click();
    const offers = C.faOffers(career);
    C.saveCareer(career);
    const items = offers.map(o => { const t = TEAMS[o.id]; return { ...t, title: t.name, sub: `Team OVR ${career.teamOvr[o.id]}`, perk: `${o.perk.label}: ${o.perk.desc}` }; });
    $('draftBody').innerHTML = `<h1 class="reveal">FREE AGENCY</h1><p>Three teams want the champ. Each deal comes with a different perk.</p>${choiceCards(items)}
      <button class="btn ghost" id="faBack" style="margin-top:10px">BACK</button>`;
    $('faBack').onclick = () => renderResign();
    $('draftBody').querySelectorAll('.offer').forEach(b => b.onclick = () => {
      const o = offers[+b.dataset.i];
      confirmModal(`Sign with the ${TEAMS[o.id].name}?`, () => { sfx.cheer(1.3); C.signWith(career, o); C.saveCareer(career); goCareer(); });
    });
  };
}

function runDraftNight() {
  const d = career.draft || C.runDraft(career);
  C.saveCareer(career);
  const body = $('draftBody');
  show('scrDraft', false);
  if (d.result === 'choose') {
    body.innerHTML = `<h1 class="reveal">YOU'RE A TOP-3 PICK</h1><p>Your showcase was so good that you get to pick where you play. Choose your team.</p>
      <div class="team-grid">${TEAMS.map(t => `<button class="team-pick" data-id="${t.id}" style="background:${t.c1};color:${t.c2};border-color:${t.c2}">${t.abbr}<small>${esc(t.city)} · ${career.teamOvr[t.id]} OVR</small></button>`).join('')}</div>`;
    body.querySelectorAll('.team-pick').forEach(b => b.addEventListener('click', () => {
      const id = +b.dataset.id;
      confirmModal(`Sign with the ${TEAMS[id].name}?`, () => { d.teamId = id; sfx.cheer(1.4); C.joinNBA(career, id, 'draft'); C.saveCareer(career); goCareer(); });
    }));
  } else if (d.result === 'auto') {
    const t = TEAMS[d.teamId];
    body.innerHTML = `<p>${d.round === 1 ? 'With the' : 'In the second round, with the'} #${d.pick} pick in the draft, the ${esc(t.name)} select…</p>
      <h1 class="reveal" style="color:${t.c2 === '#ffffff' ? '#fff' : t.c2}; animation-delay:.6s">${esc(career.player.name.toUpperCase())}</h1>
      ${teamLogo(t)}<p>${esc(POSITIONS[career.player.position].name)} · ${esc(PLAYSTYLES[career.player.style].name)}</p>
      <button class="btn primary" id="draftGo">PUT ON THE HAT</button>`;
    setTimeout(() => sfx.cheer(1.5), 600);
    $('draftGo').onclick = () => { C.joinNBA(career, d.teamId, 'draft'); C.saveCareer(career); goCareer(); };
  } else {
    body.innerHTML = `<h1>UNDRAFTED</h1><p>Sixty picks. No call. The arena empties out and your phone stays quiet… until a G League coach calls.</p>
      <button class="btn primary" id="draftGo">TAKE THE G LEAGUE DEAL</button>`;
    $('draftGo').onclick = () => { C.startGLeague(career); C.saveCareer(career); goCareer(); };
  }
}

// ---------------- Match ----------------
let renderer = null, game = null, controls = null, matchInfo = null, last = 0, running = false, paused = false;
let recorder = null, replay = null, lastReplayT = -99, reelShown = false, snapCam = false;

const DUNK_NAMES = { one: 'ONE-HAND JAM!', two: 'TWO-HAND SLAM!', tomahawk: 'TOMAHAWK!', cockback: 'COCK-BACK SLAM!', reverse: 'REVERSE JAM!',
  clutch: 'CLUTCH DUNK!', windmill: 'WINDMILL!', '360': '360 DUNK!', btl: 'BETWEEN THE LEGS!', contact: 'IN HIS FACE!' };

function markPlay(kind, p, score, label, instant) { if (recorder && p) recorder.mark(kind, p.idx, score, label, instant); }

function startReplay(clips, kind, onDone) {
  controls.reset();
  snapCam = true;
  replay = new ReplayPlayer(clips, game.teams, clip => { $('rpLabel').textContent = clip.label; snapCam = true; });
  replay.kind = kind; replay.onDone = onDone;
  renderer.prevCam = renderer.camMode;
  renderer.camMode = 'replay';
  renderer.replayAng = Math.PI * 0.3;
  $('rpTag').textContent = kind === 'reel' ? 'GAME HIGHLIGHTS' : 'REPLAY';
  $('scrGame').classList.add('replaying');
}

function endReplay() {
  const done = replay && replay.onDone;
  replay = null;
  renderer.camMode = renderer.prevCam || settings.camera;
  renderer.camYaw = undefined;
  $('scrGame').classList.remove('replaying');
  last = performance.now();
  if (done) done();
}

function runReplay(dt, now) {
  const st = replay.step(dt);
  if (!st) { endReplay(); return; }
  const f = st.game.players[st.focus].pos;
  renderer.replayFocus = f;
  if (snapCam) { renderer.camLook.set(f.x, 5.5, f.z); renderer.replayAng = Math.PI * (0.2 + Math.random() * 0.3); snapCam = false; }
  if (st.crossedEvent) {
    const k = replay.clip.kind;
    if (k === 'poster' || k === 'dunk' || k === 'oop') { sfx.dunk(); renderer.shake = 0.4; }
    else if (k === 'block') sfx.block();
    else if (k === 'ankle') sfx.ooh();
    else { sfx.swish(); sfx.cheer(1.2); }
  }
  renderer.render(st.game, dt * st.rate, now / 1000);
}

// Quick settings from the pause menu
function gameSettings(resume) {
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-s="${key}" data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  overlay(`<div class="ov-card"><h1>SETTINGS</h1>
    <div class="set-row"><label>Replays</label>${seg('replays', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Infinite AP + All Badges<small>Upgrades are free and every badge is Hall of Fame</small></label>${seg('maxed', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Sound</label>${seg('sound', [[true, 'On'], [false, 'Off']])}</div>
    <div class="ov-btns"><button class="btn primary" id="gsBack">RESUME</button></div></div>`);
  $('gameOverlay').querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    sfx.click();
    settings[b.dataset.s] = b.dataset.v === 'true';
    C.saveSettings(settings);
    setMuted(!settings.sound);
    C.setMaxed(settings.maxed);
    if (game && career) game.badgeTiers = C.badgeTiers(career);
    gameSettings(resume);
  }));
  $('gsBack').onclick = resume;
}

// Turn replays off for good, right from a replay
$('rpOff').onclick = () => {
  settings.replays = false;
  C.saveSettings(settings);
  if (replay) endReplay();
};

$('rpSkip').onclick = () => {
  if (!replay) return;
  if (replay.kind === 'reel') { replay.skipClip(); if (replay.done) endReplay(); }
  else endReplay();
};
const ui = {};

function ensureRenderer() {
  if (!renderer || renderer.quality !== settings.quality) {
    if (renderer) renderer.r.dispose();
    renderer = new Renderer($('gl'), settings.quality);
  }
  if (!controls) controls = new Controls($('controls'));
}

function startMatch(info) {
  ensureRenderer();
  matchInfo = info;
  const P = career.player;
  game = new Game({
    teams: info.teams, rosters: info.rosters, userTeam: info.userTeam, userSlot: info.slot,
    qLen: settings.qLen, difficulty: settings.difficulty, benchStart: info.benchStart, boost: info.boost,
    dribbleStyle: P.dribble, jumpshot: P.jumpshot, defAssist: settings.defAssist, passBias: info.passBias, badges: info.badges, greenBoost: info.greenBoost,
    onEvent: onGameEvent,
  });
  game.homeIdx = info.teams.indexOf(info.homeTeam);
  recorder = new Recorder(game); replay = null; lastReplayT = -99; reelShown = false;
  $('scrGame').classList.remove('replaying');
  renderer.camMode = settings.camera;
  renderer.camYaw = undefined;
  renderer.resize();
  renderer.buildArena(info.homeTeam);
  renderer.addPlayers(game);
  const [A, B] = info.teams;
  const sbA = $('sbA'), sbB = $('sbB');
  sbA.style.background = A.c1; sbA.style.color = A.c2 === '#ffffff' || A.c2 === '#e5e5e5' ? '#fff' : A.c2;
  sbB.style.background = B.c1; sbB.style.color = B.c2 === '#ffffff' || B.c2 === '#e5e5e5' ? '#fff' : B.c2;
  sbA.querySelector('.abbr').textContent = A.abbr; sbB.querySelector('.abbr').textContent = B.abbr;
  $('huName').textContent = P.name.toUpperCase();
  $('gradeFeed').innerHTML = '';
  controls.reset();
  show('scrGame', false);
  overlay(null);
  paused = false;
  game.start();
  if (game.phase !== 'bench') {
    overlay(`<div class="ov-card"><div class="ng-label">${esc(info.label)}</div><h1>${esc(info.myTeam.name)} vs ${esc(info.opp.name)}</h1>
      ${info.boost ? `<p>G League Boost: +${info.boost} to all attributes this game</p>` : ''}
      <div class="ov-btns"><button class="btn ghost" id="ovHelp">CONTROLS</button><button class="btn primary" id="ovTip">TIP OFF</button></div></div>`);
    const prePhase = game.phase;
    game.phase = 'pregame';
    $('ovTip').onclick = () => { overlay(null); game.phase = prePhase; sfx.whistle(); };
    $('ovHelp').onclick = () => showHelp(() => startMatchOverlayAgain(info, prePhase));
  }
  startCrowd();
  running = true;
  last = performance.now();
  requestAnimationFrame(loop);
}
function startMatchOverlayAgain(info, prePhase) {
  overlay(`<div class="ov-card"><h1>READY?</h1><div class="ov-btns"><button class="btn primary" id="ovTip">TIP OFF</button></div></div>`);
  $('ovTip').onclick = () => { overlay(null); game.phase = prePhase; sfx.whistle(); };
}

function overlay(html) {
  const o = $('gameOverlay');
  if (!html) { o.classList.remove('on'); o.innerHTML = ''; return; }
  o.innerHTML = html; o.classList.add('on');
}

function showHelp(after) {
  overlay(`<div class="ov-card"><h1>CONTROLS</h1><div class="help-grid">
    <b>Left stick</b><span>Move. Push it all the way to the edge to sprint</span>
    <b>SHOOT</b><span>Hold, release at the top of the meter. A green release always goes in. Contested, deep or moving shots shrink the green window. Tap while driving for a layup or dunk</span>
    <b>PASS / LOB PASS</b><span>Pass toward the stick direction. LOB PASS throws an alley-oop to a teammate near the rim</span>
    <b>SET PICK</b><span>Call a teammate to screen your defender</span>
    <b>Right stick</b><span>Flick ← → crossover / between the legs / behind the back · ↑ hesitation · ↓ stepback · double-tap spin · press and hold to POST UP</span>
    <b>Post up</b><span>Push toward the rim to back down. SHOOT (or flick the stick toward SHOOT, hold, and let go) = turnaround fadeaway. Hold the stick toward the rim + SHOOT = hook. Flick for a drop step, ↓ to shimmy, double-tap to spin</span>
    <b>Off the ball</b><span>CALL BALL · ALLEY-OOP · CALL SCREEN (a teammate screens for you) · SET SCREEN (you screen for the ball handler)</span>
    <b>Defense</b><span>BLOCK/REBOUND · STEAL · hold BOX OUT when a shot goes up · hold the DEF ASSIST stick to stay on your man, slowly push it to the edge for intense D, or flick it toward BLOCK or STEAL to do those</span>
    <b>Keyboard</b><span>WASD move · Shift sprint · Space shoot · K pass/box out · L lob/steal · O pick/screen · P post · Z def assist · X intense · Q/E/R/F/T moves</span>
  </div><div class="ov-btns"><button class="btn primary" id="ovOk">GOT IT</button></div></div>`);
  $('ovOk').onclick = () => after();
}

$('btnPause').onclick = () => {
  if (!game || paused || game.phase === 'over') return;
  paused = true;
  overlay(`<div class="ov-card"><h1>PAUSED</h1><p>${game.score[0]} - ${game.score[1]} · Q${game.quarter}</p>
    <div class="ov-btns"><button class="btn" id="pHelp">CONTROLS</button><button class="btn" id="pEdit">MOVE BUTTONS</button><button class="btn" id="pSet">SETTINGS</button><button class="btn danger" id="pQuit">SIM TO END</button><button class="btn primary" id="pRes">RESUME</button></div></div>`);
  const resume = () => { paused = false; overlay(null); last = performance.now(); };
  $('pRes').onclick = resume;
  $('pHelp').onclick = () => showHelp(resume);
  $('pSet').onclick = () => gameSettings(resume);
  $('pEdit').onclick = () => { overlay(null); controls.edit(() => { overlay(`<div class="ov-card"><h1>LAYOUT SAVED</h1><div class="ov-btns"><button class="btn primary" id="pRes2">RESUME</button></div></div>`); $('pRes2').onclick = resume; }); };
  $('pQuit').onclick = () => {
    // Sim the rest of regulation
    const remain = (4 - game.quarter) * game.qLen + game.clock;
    game.simChunk(remain);
    if (game.score[0] === game.score[1]) game.score[game.userTeam === 0 ? 1 : 0] += 2;
    paused = false;
    endMatch();
  };
};

function onGameEvent(type, d) {
  const u = game && game.user;
  const vib = ms => { if (settings.vibrate) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } };
  switch (type) {
    case 'dribble': sfx.dribble(); break;
    case 'swish': sfx.swish(); renderer.netSwish(d.side); break;
    case 'rim': sfx.rim(); break;
    case 'bounce': sfx.bounce(); break;
    case 'make':
      if (game.buzzer && d.p.team === game.userTeam && d.kind !== 'ft') markPlay('buzzer', d.p, 9, 'AT THE BUZZER!', true);
      else if (d.p.isUser && d.three) markPlay('three', d.p, 5, 'FROM DOWNTOWN', false);
      else if (d.assister && d.assister.isUser) markPlay('assist', d.assister, 3, 'THE DIME', false);
      sfx.cheer(d.p.team === game.userTeam ? 1 : 0.5);
      if (d.p.isUser) toast(d.three ? '+3' : '+2', '#ffd23f');
      else if (d.assister && d.assister.isUser) toast('ASSIST', '#3ddc84');
      break;
    case 'release': {
      const map = { perfect: ['EXCELLENT RELEASE', '#3ddc84'], good: ['GOOD RELEASE', '#ffd23f'], early: ['SLIGHTLY EARLY', '#f08a3c'], late: ['SLIGHTLY LATE', '#f08a3c'], 'very early': ['VERY EARLY', '#e5484d'], 'very late': ['VERY LATE', '#e5484d'] };
      const [t, c] = map[d.q];
      callout(t, c);
      ui.meterResult = d.q === 'perfect' ? 'green' : d.q === 'good' ? 'ok' : 'bad';
      ui.meterHold = 0.7;
      if (d.q === 'perfect') { sfx.green(); vib(30); }
      break;
    }
    case 'screen': sfx.thud(); callout(d.screener.isUser ? 'GREAT SCREEN!' : 'SCREEN!', '#ffd23f'); break;
    case 'screenSet': if (d.for.isUser) callout('SCREEN SET, USE IT!', '#ffd23f'); break;
    case 'contact': sfx.thud(); if (d.power >= 4 && (d.p.isUser || d.p === game.matchup(game.user))) renderer.shake = Math.max(renderer.shake, 0.12); break;
    case 'poster': markPlay('poster', d.p, d.p.isUser || d.def.isUser ? 10 : 7, 'POSTERIZED!', true); toast(d.p.isUser ? 'POSTERIZED!' : d.def.isUser ? 'YOU GOT POSTERIZED' : 'POSTERIZED!', '#ff5a1f'); sfx.ooh(); renderer.shake = 0.6; if (d.p.isUser) vib(90); break;
    case 'charge': toast(d.def.isUser ? 'CHARGE TAKEN!' : 'CHARGE', d.def.team === game.userTeam ? '#3ddc84' : '#e5484d'); break;
    case 'ankle': if (d.p.isUser) markPlay('ankle', d.p, 8, 'ANKLE BREAKER', true); toast('ANKLE BREAKER!', '#ff5a1f'); sfx.ooh(); renderer.shake = 0.35; vib(60); break;
    case 'beat': if (d.p.isUser) callout('BLOW-BY', '#ffd23f'); sfx.squeak(); break;
    case 'block': {
      const bl = d.type === 'chase' ? 'CHASE-DOWN BLOCK!' : d.type === 'snatch' ? 'SNATCHED!' : d.def.isUser ? 'BLOCKED BY YOU!' : 'BLOCKED!';
      if (d.def.isUser) markPlay('block', d.def, d.type === 'swat' ? 7 : 9, d.type === 'chase' ? 'CHASE-DOWN BLOCK' : d.type === 'snatch' ? 'SNATCHED' : 'REJECTED!', true);
      else if (d.type !== 'swat') markPlay('block', d.def, 5, d.type === 'chase' ? 'CHASE-DOWN BLOCK' : 'SNATCHED', false);
      toast(bl, d.def.team === game.userTeam ? '#3ddc84' : '#e5484d'); sfx.block(); renderer.shake = d.type === 'swat' ? 0.2 : 0.35; if (d.def.isUser) vib(40); break;
    }
    case 'steal': sfx.steal(); if (d.def.isUser) { toast('STOLEN!', '#3ddc84'); vib(40); } else if (d.h && d.h.isUser) toast('TURNOVER', '#e5484d'); break;
    case 'dunk': {
      const dn = DUNK_NAMES[d.p.dunkStyle] || 'SLAM!';
      const flashy = ['windmill', '360', 'btl', 'reverse', 'contact'].includes(d.p.dunkStyle);
      markPlay('dunk', d.p, d.p.isUser ? (flashy ? 8 : 7) : flashy ? 5 : 3, dn, d.p.isUser);
      sfx.dunk(); renderer.shake = 0.45;
      if (d.p.isUser) { toast(dn, '#ff5a1f'); vib(70); }
      break;
    }
    case 'alleyoop': markPlay('oop', d.p, d.p.isUser ? 8 : 4, 'ALLEY-OOP', d.p.isUser); toast('ALLEY-OOP!', '#ffd23f'); break;
    case 'airball': if (d.p.isUser) callout('AIRBALL', '#e5484d'); break;
    case 'whistle': sfx.whistle(); callout(d.text, '#fff'); break;
    case 'call': callout(d.text, '#ffd23f'); break;
    case 'buzzer': sfx.buzzer(); break;
    case 'pass': sfx.pass(); break;
    case 'move': if (d.p.isUser) sfx.squeak(); break;
    case 'grade': {
      const el = document.createElement('div');
      el.textContent = `${d.delta > 0 ? '+' : ''}${d.label}`;
      if (d.delta < 0) el.className = 'neg';
      $('gradeFeed').prepend(el);
      setTimeout(() => el.remove(), 2400);
      break;
    }
    case 'ft': if (d.shooter.isUser) callout(`FREE THROW ${d.i + 1} OF ${d.n}: HOLD & RELEASE SHOOT`, '#fff'); break;
    case 'benchIntro': {
      const sc = d.score;
      const my = game.userTeam;
      overlay(`<div class="ov-card"><div class="ng-label">${esc(matchInfo.label)}</div><h1>OFF THE BENCH</h1>
        <p>You watched the first half of the 1st quarter from the bench.<br>${esc(matchInfo.myTeam.abbr)} ${sc[my]} - ${sc[1 - my]} ${esc(matchInfo.opp.abbr)} with ${fmtClock(d.clock)} left in the 1st.</p>
        <p>Coach: “You're in. Show me something.”</p>
        <div class="ov-btns"><button class="btn ghost" id="ovHelp">CONTROLS</button><button class="btn primary" id="ovIn">CHECK IN</button></div></div>`);
      $('ovIn').onclick = () => { overlay(null); game.resumeFromBench(); sfx.whistle(); };
      $('ovHelp').onclick = () => showHelp(() => {
        overlay(`<div class="ov-card"><h1>READY?</h1><div class="ov-btns"><button class="btn primary" id="ovIn">CHECK IN</button></div></div>`);
        $('ovIn').onclick = () => { overlay(null); game.resumeFromBench(); sfx.whistle(); };
      });
      break;
    }
    case 'quarterEnd': {
      const q = d.quarter;
      const s = game.user.stats;
      setTimeout(() => {
        if (!game || game.phase !== 'break') return;
        overlay(`<div class="ov-card"><h1>${q === 2 ? 'HALFTIME' : q >= 4 ? 'END OF REGULATION' : `END OF ${ordinal(q)} QUARTER`}</h1>
          <p>${esc(game.teams[0].abbr)} ${game.score[0]} - ${game.score[1]} ${esc(game.teams[1].abbr)}</p>
          <p>You: ${s.pts} PTS · ${s.reb} REB · ${s.ast} AST · ${s.stl} STL · ${s.fgm}/${s.fga} FG · Grade <b style="color:${gradeColor(gradeLetter(game.grade))}">${gradeLetter(game.grade)}</b></p>
          ${q >= 4 ? '<p>Tied. Heading to overtime!</p>' : ''}
          <div class="ov-btns"><button class="btn primary" id="ovNext">${q >= 4 ? 'OVERTIME' : 'CONTINUE'}</button></div></div>`);
        $('ovNext').onclick = () => { overlay(null); game.nextQuarter(); sfx.whistle(); };
      }, 300);
      break;
    }
    case 'gameOver': setTimeout(endMatch, 600); break;
  }
}

function ordinal(n) { return ['1ST', '2ND', '3RD', '4TH'][n - 1] || `${n}TH`; }
function fmtClock(s) { s = Math.max(0, s); if (s < 60) return s.toFixed(1); const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; }
function toast(text, color) { const t = $('toast'); t.textContent = text; t.style.color = color || '#fff'; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
function callout(text, color) { const t = $('callout'); t.textContent = text; t.style.color = color || '#ffd23f'; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }

function endMatch() {
  if (!running) return;
  if (!reelShown && recorder && settings.replays !== false) {
    reelShown = true;
    recorder.flush();
    const reel = recorder.reel(5);
    if (reel.length) { overlay(null); startReplay(reel, 'reel', () => endMatch()); return; }
  }
  if (replay) return;
  running = false;
  stopCrowd();
  const my = game.userTeam;
  const res = { stats: { ...game.user.stats }, grade: game.grade, myScore: game.score[my], oppScore: game.score[1 - my], simmed: false, badgeCounts: { ...game.badgeCounts } };
  overlay(null);
  finishMatch(matchInfo, res, game);
}

function finishMatch(info, res, g) {
  const out = C.applyResult(career, info, res);
  C.saveCareer(career);
  const s = res.stats;
  const col = gradeColor(out.letter);
  let box = '';
  if (g) {
    const tm = t => g.players.filter(p => p.team === t).sort((a, b) => b.stats.pts - a.stats.pts).slice(0, 3)
      .map(p => `<tr class="${p.isUser ? 'me' : ''}"><td>${esc(p.name)}</td><td>${p.stats.pts}</td><td>${p.stats.reb}</td><td>${p.stats.ast}</td></tr>`).join('');
    box = `<table><tr><th>${esc(g.teams[0].abbr)} LEADERS</th><th>PTS</th><th>REB</th><th>AST</th></tr>${tm(0)}<tr><th>${esc(g.teams[1].abbr)} LEADERS</th><th></th><th></th><th></th></tr>${tm(1)}</table>`;
  }
  $('postBody').innerHTML = `
    <div class="post-grade"><div class="res" style="color:${out.win ? 'var(--green)' : 'var(--red)'}">${out.win ? 'WIN' : 'LOSS'} ${res.myScore}-${res.oppScore}</div>
      <div class="ng-label">TEAMMATE GRADE</div><div class="big" style="color:${col}">${out.letter}</div>
      <div class="ap">+${out.ap} AP</div>${res.simmed ? '<small style="color:var(--dim)">Simulated</small>' : ''}</div>
    <div>
      <div class="ng-label">${esc(info.label)} · vs ${esc(info.opp.name)}</div>
      <div class="statline"><div><b>${s.pts}</b><small>PTS</small></div><div><b>${s.reb}</b><small>REB</small></div><div><b>${s.ast}</b><small>AST</small></div><div><b>${s.stl}</b><small>STL</small></div><div><b>${s.blk}</b><small>BLK</small></div><div><b>${s.fgm}/${s.fga}</b><small>FG</small></div></div>
      <div class="notes">${out.badgeUps.map(u => `<div class="badge-up" style="border-left-color:${BADGE_COLORS[u.tier - 1]}">${badgeChip(u.key, u.tier)} NEW BADGE: ${BADGES[u.key].name} (${BADGE_TIERS[u.tier - 1]})</div>`).join('')}${out.boosts.map(b => `<div class="boost">Skill boost: ${esc(b)}</div>`).join('')}${out.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>
      ${box}
      <div class="ov-btns" style="justify-content:flex-start"><button class="btn primary" id="postGo">CONTINUE</button></div>
    </div>`;
  show('scrPost', false);
  $('postGo').onclick = () => { sfx.click(); goCareer(); };
}

// ---------------- Loop ----------------
function loop(now) {
  if (!running) return;
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) dt = 0;
  if (replay) { runReplay(dt, now); return; }
  const g = game;
  const u = g.user;
  // Controls mode
  let mode;
  if (g.phase === 'ft') mode = g.ftQueue && g.ftQueue.shooter === u ? 'ft' : 'defense';
  else if (g.offense === g.userTeam) mode = u.hasBall ? 'ball' : 'offBall';
  else mode = 'defense';
  controls.setMode(mode === 'ball' && u.post ? 'post' : mode);
  const input = controls.poll((x, z) => renderer.worldMap(x, z));
  if (!paused) {
    // Fixed-ish substeps for stable physics
    const steps = dt > 0.02 ? 2 : 1;
    for (let i = 0; i < steps; i++) g.update(dt / steps, i === 0 ? input : { ...input, shootPressed: false, passPressed: false, gesture: null, shootReleased: false });
  }
  renderer.render(g, dt, now / 1000);
  updateHUD(dt);
  if (!paused && recorder) {
    recorder.capture(dt);
    const clip = recorder.update();
    if (clip && settings.replays !== false && (g.phase === 'live' || g.phase === 'dead') && g.time - lastReplayT > 15) {
      lastReplayT = g.time;
      startReplay([clip], 'instant', null);
    }
  }
}

function updateHUD(dt) {
  const g = game;
  $('sbA').querySelector('.pts').textContent = g.score[0];
  $('sbB').querySelector('.pts').textContent = g.score[1];
  $('sbQ').textContent = g.quarter > 4 ? `OT${g.quarter > 5 ? g.quarter - 4 : ''}` : ordinal(g.quarter);
  $('sbClock').textContent = fmtClock(g.clock);
  const sc = $('sbShot');
  sc.textContent = Math.ceil(Math.max(0, g.shotClock));
  sc.classList.toggle('low', g.shotClock < 5);
  const u = g.user;
  const L = gradeLetter(g.grade);
  const gr = $('huGrade');
  gr.textContent = L; gr.style.color = gradeColor(L);
  $('huEnergy').style.width = u.energy + '%';
  $('huEnergy').style.background = u.energy < 25 ? 'var(--red)' : 'var(--green)';
  $('huStats').textContent = `${u.stats.pts} PTS · ${u.stats.reb} REB · ${u.stats.ast} AST`;
  const mu = g.matchup(u);
  const mtxt = mu ? `${g.offense === u.team ? 'GUARDED BY' : 'GUARDING'} #${mu.num} ${mu.name.split(' ').pop().toUpperCase()}` : '';
  if (ui.mtxt !== mtxt) { $('huMatch').textContent = mtxt; ui.mtxt = mtxt; }

  // Shot meter
  const m = $('meter');
  const shooting = (u.action === 'shoot' || (u.action === 'layup' && u.meterOn)) && !u.released;
  if (shooting || ui.meterHold > 0) {
    const head = renderer.project(u.pos.x, u.heightFt + u.y + 0.5, u.pos.z);
    m.style.left = (head.x + 34) + 'px';
    m.style.top = (head.y - 60) + 'px';
    const H = 92, max = 1.45;
    const v = shooting ? u.meter : (ui.meterVal ?? 1);
    if (shooting) { ui.meterVal = u.meter; ui.meterResult = null; ui.meterHold = 0; }
    m.classList.add('on');
    $('meterFill').style.height = Math.min(1, v / max) * H + 'px';
    const w = g.meterWindow(u);
    $('meterWin').style.bottom = ((1 - w) / max) * H + 'px';
    $('meterWin').style.height = Math.max(3, (2 * w / max) * H) + 'px';
    m.classList.toggle('green', ui.meterResult === 'green');
    m.classList.toggle('ok', ui.meterResult === 'ok');
    m.classList.toggle('bad', ui.meterResult === 'bad');
    if (!shooting) ui.meterHold -= dt;
  } else m.classList.remove('on');
}

// Keep the app in landscape fullscreen where possible
try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ }

// Register service worker for offline/PWA when served over http(s)
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !location.hostname.includes('localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

renderTitle();
window.__hoops = { get game() { return game; }, get career() { return career; }, get renderer() { return renderer; }, get controls() { return controls; } };
