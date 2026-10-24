// App shell: screens, MyCareer flow, game loop and HUD.
import { ATTRS, POSITIONS, PLAYSTYLES, DRIBBLE_STYLES, JUMPSHOTS, SKIN_TONES, HAIR, TEAMS, POS_ORDER,
  buildRatings, overall, gradeLetter, gradeColor, upgradeCost, HEIGHT_RANGES, BUILDS, heightIn, fmtHeight,
  BADGES, BADGE_TIERS, BADGE_COLORS, badgeTier, TAKEOVERS, takeoverType, NBA_COMPS, STYLE_ADJ, CAP_FLOOR, CAP_BUDGET,
  ANIMS, ANIM_CATS, animFor, animAllowed, GOAT_SKILLS, GOAT_TIERS, goatTier } from './data.js';
import * as C from './career.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { loadPlayerPack } from './player.js';
import { Controls } from './controls.js';
import { sfx, unlock, setMuted, startCrowd, stopCrowd, playVO, stopVO } from './audio.js';
import { VO } from './vo-lines.js';
import { Recorder, ReplayPlayer } from './replay.js';
import { Warmup, cutscene } from './warmup.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// MakeHuman player models; matches started before this finishes use the procedural players
loadPlayerPack();
let settings = C.loadSettings();
C.setMaxed(settings.maxed);
const apText = c => (C.isMaxed() ? '∞ AP' : `${c.ap} AP`) + ` · ${(c.vc || 0).toLocaleString()} VC`;
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

// Game tasks list. With live stats it shows progress, after the game it shows done / not done.
function tasksHTML(list, stats = null, extra = null, result = null) {
  if (!list || !list.length) return '';
  return `<div class="tasks"><div class="ng-label">GAME TASKS</div>${list.map((t, i) => {
    const r = result && result[i];
    const n = r ? r.n : stats ? C.taskProgress(t, stats, extra) : null;
    const done = r ? r.done : n != null && n >= t.n;
    return `<div class="task ${done ? 'done' : ''}"><i>${done ? '✓' : ''}</i><span>${esc(t.text)}${n != null && t.n > 1 && !done ? ` <em>${n}/${t.n}</em>` : ''}</span><b>+${t.ap} AP · +${t.vc} VC</b></div>`;
  }).join('')}</div>`;
}

// Your rival's season next to yours
function rivalHTML(c) {
  const R = c.rival, avg = (o, k) => (o.gp ? o[k] / o.gp : 0).toFixed(1);
  const team = c.nba ? (R.nbaTeam != null ? TEAMS[R.nbaTeam].name : '') : (C.teamOf(c, R.college) || {}).name || '';
  return `<div class="rival"><div class="ng-label">RIVAL · ${esc(R.name)} <small>${esc(team)}</small> · H2H ${R.h2h[0]}-${R.h2h[1]}</div>
    <div class="rv-row"><span>YOU</span><b>${avg(R.me, 'pts')}</b><b>${avg(R.me, 'reb')}</b><b>${avg(R.me, 'ast')}</b></div>
    <div class="rv-row them"><span>${esc(R.name.split(' ').pop().toUpperCase())}</span><b>${avg(R.stats, 'pts')}</b><b>${avg(R.stats, 'reb')}</b><b>${avg(R.stats, 'ast')}</b></div>
    <div class="rv-row lbl"><span></span><small>PPG</small><small>RPG</small><small>APG</small></div></div>`;
}

// Notice banner for menus (outside a game); tap it to run `onTap`
let noticeT = null;
function toastMenu(text, sub = '', color = 'var(--gold)', onTap = null) {
  const n = $('notice');
  n.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
  n.style.borderLeftColor = color;
  n.onclick = () => { n.classList.remove('show'); if (onTap) onTap(); };
  n.classList.add('show');
  clearTimeout(noticeT); noticeT = setTimeout(() => n.classList.remove('show'), 3600);
}
function confirmModal(text, yes) {
  const m = $('modal');
  m.innerHTML = `<div class="ov-card"><p>${esc(text)}</p><div class="ov-btns"><button class="btn ghost" id="mNo">CANCEL</button><button class="btn primary" id="mYes">YES</button></div></div>`;
  m.classList.add('on');
  $('mNo').onclick = () => m.classList.remove('on');
  $('mYes').onclick = () => { m.classList.remove('on'); yes(); };
}

// ---------------- Creator ----------------
// Name + number, then either build your own (spend a budget on attribute potential) or pick an
// NBA-style archetype for your position. Shot and dribble animations are picked later on the Animations page.
const draft = { name: '', num: 23, position: 'SG', heightIn: 78, build: 'athletic', style: 'sharpshooter', method: null, caps: null, dribble: 'quick', jumpshot: 'standard', skin: SKIN_TONES[2], hair: 'Fade', headband: false, sleeve: false };
let cStep = 0;
const C_STEPS = ['Identity', 'Build Type', 'Body', 'Attributes', 'Your Build', 'Look'];

function startCreator() { cStep = 0; renderCreator(); show('scrCreate'); }

function previewRatings() {
  return C.startingRatings(draft.position, draft.style, () => 0.5, draft.heightIn, draft.build, C.START_OVR, draft.caps);
}
// Keep the potential valid for the current body (and refill an archetype's for a new body)
function fixCaps() {
  if (draft.method === 'nba' || !draft.caps) { draft.caps = C.capsForStyle(draft.position, draft.style, draft.heightIn, draft.build); return; }
  const mx = C.capMaxes(draft.heightIn, draft.build);
  for (const a of ATTRS) draft.caps[a.key] = Math.max(CAP_FLOOR, Math.min(mx[a.key], draft.caps[a.key] ?? CAP_FLOOR));
}
function syncBuild() {
  if (!draft.caps) return;
  const d = C.describeBuild(draft.position, draft.caps);
  if (draft.method === 'own') { draft.style = d.style; draft.buildName = d.name; draft.comp = d.comp; }
  else { draft.buildName = `${PLAYSTYLES[draft.style].name}`; draft.comp = NBA_COMPS[draft.position][draft.style]; }
}

function cardHTML(p, ratings, extra = '') {
  const ovr = overall(ratings, p.position);
  const top = ATTRS.map(a => ({ a, v: ratings[a.key] })).sort((x, y) => y.v - x.v).slice(0, 7);
  const styleName = p.buildName || PLAYSTYLES[p.style].name;
  return `<div class="pc-top"><div class="pc-ovr">${ovr}<small>OVR</small></div>
    <div><div class="pc-name">${esc(p.name || 'Your Name')}</div><div class="pc-sub">#${p.num} · ${fmtHeight(p.heightIn || heightIn(p.heightFt || POSITIONS[p.position].height))} ${POSITIONS[p.position].name} · ${esc(styleName)}${p.build && p.build !== 'athletic' ? ' · ' + BUILDS[p.build].name : ''}</div>${p.comp ? `<div class="pc-comp">Plays like ${esc(p.comp)}</div>` : ''}</div></div>
    ${extra}
    <div class="bars">${top.map(({ a, v }) => `<div class="bar-row"><span>${a.name}</span><div class="track"><i style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>`;
}
function potentialBars(caps, n = 8) {
  const top = ATTRS.map(a => ({ a, v: caps[a.key] })).sort((x, y) => y.v - x.v).slice(0, n);
  return `<div class="ng-label" style="margin-top:6px">POTENTIAL</div><div class="bars">${top.map(({ a, v }) => `<div class="bar-row"><span>${a.name}</span><div class="track"><i class="pot" style="width:${v}%"></i></div><b>${v}</b></div>`).join('')}</div>`;
}
function refreshCreateCard() {
  syncBuild();
  $('createCard').innerHTML = cardHTML(draft, previewRatings(), draft.caps && cStep >= 3 ? potentialBars(draft.caps, 5) : '');
}

function renderCreator() {
  $('createSteps').innerHTML = C_STEPS.map((_, i) => `<i class="${i <= cStep ? 'on' : ''}"></i>`).join('');
  const m = $('createMain');
  const choice = (group, key, title, desc, sel) => `<button class="choice ${sel ? 'sel' : ''}" data-g="${group}" data-k="${key}"><b>${title}</b><small>${desc}</small></button>`;
  if (cStep === 0) {
    m.innerHTML = `<h3>PLAYER NAME</h3><div class="field"><input id="inName" maxlength="22" placeholder="First Last" value="${esc(draft.name)}" autocomplete="off"></div>
      <h3>JERSEY NUMBER</h3><div class="wheel-wrap"><div class="wheel-band"></div><div class="wheel" id="numWheel"><div class="wpad"></div>${Array.from({ length: 100 }, (_, n) => `<div class="wi" data-n="${n}">${n}</div>`).join('')}<div class="wpad"></div></div></div>`;
    const inp = $('inName');
    inp.addEventListener('input', () => { draft.name = inp.value; refreshCreateCard(); });
    setupWheel();
  } else if (cStep === 1) {
    m.innerHTML = `<h3>HOW DO YOU WANT TO BUILD?</h3><div class="choices big">
      ${choice('method', 'own', 'BUILD YOUR OWN', `Take charge of your attributes. Spend ${CAP_BUDGET} potential points however you want, then see what your build is called and who you play like.`, draft.method === 'own')}
      ${choice('method', 'nba', 'NBA PLAYER BUILDS', 'Pick an archetype for your position, each one compared to a real NBA player. Your potential is set for you.', draft.method === 'nba')}</div>`;
  } else if (cStep === 2) {
    const [hMin, hMax] = HEIGHT_RANGES[draft.position];
    m.innerHTML = `<h3>POSITION</h3><div class="choices">${POS_ORDER.map(k => choice('position', k, `${k} · ${POSITIONS[k].name}`, `${fmtHeight(HEIGHT_RANGES[k][0])} – ${fmtHeight(HEIGHT_RANGES[k][1])}`, draft.position === k)).join('')}</div>
      <h3>HEIGHT</h3><div class="field slider"><input type="range" id="inHeight" min="${hMin}" max="${hMax}" step="1" value="${draft.heightIn}"><b id="hLabel">${fmtHeight(draft.heightIn)}</b></div>
      <small class="hint">Height and build set the most each attribute can ever reach. Taller: better rebounding, blocking and inside D. Shorter: quicker with better handles and shooting.</small>
      <h3>BUILD</h3><div class="choices">${Object.entries(BUILDS).map(([k, b]) => choice('build', k, b.name, b.desc, draft.build === k)).join('')}</div>`;
    const hs = $('inHeight');
    hs.addEventListener('input', () => { draft.heightIn = +hs.value; $('hLabel').textContent = fmtHeight(draft.heightIn); fixCaps(); refreshCreateCard(); });
  } else if (cStep === 3 && draft.method === 'nba') {
    const comps = NBA_COMPS[draft.position];
    m.innerHTML = `<h3>${POSITIONS[draft.position].name.toUpperCase()} ARCHETYPES</h3><div class="choices">${Object.entries(PLAYSTYLES).map(([k, st]) =>
      choice('style', k, `${st.name} <span class="comp">· ${esc(comps[k])}</span>`, st.desc, draft.style === k)).join('')}</div>`;
  } else if (cStep === 3) {
    const mx = C.capMaxes(draft.heightIn, draft.build);
    let html = `<div class="cap-head"><h3>ATTRIBUTE POTENTIAL</h3><div class="cap-left"><b id="capLeft"></b><small>POINTS LEFT</small></div></div>
      <small class="hint">Drag each bar to the most that attribute can reach. Your height and build set the max (the gray line). You start at 40 OVR and upgrade toward this.</small>
      <div class="ov-btns" style="justify-content:flex-start;margin:6px 0"><button class="btn ghost small" id="capReset">RESET</button><button class="btn ghost small" id="capEven">SPREAD EVENLY</button></div>`;
    let group = '';
    for (const a of ATTRS) {
      if (a.group !== group) { group = a.group; html += `<div class="up-group">${group.toUpperCase()}</div>`; }
      html += `<div class="cap-row"><span>${a.name}</span><div class="cap-slider"><input type="range" min="${CAP_FLOOR}" max="99" step="1" value="${draft.caps[a.key]}" data-cap="${a.key}"><i class="cap-max" style="left:${(mx[a.key] - CAP_FLOOR) / (99 - CAP_FLOOR) * 100}%"></i></div><b id="capv_${a.key}">${draft.caps[a.key]}</b><small>/${mx[a.key]}</small></div>`;
    }
    m.innerHTML = html;
    const paintLeft = () => { const left = CAP_BUDGET - C.capsSpent(draft.caps); $('capLeft').textContent = left; $('capLeft').style.color = left > 0 ? 'var(--gold)' : 'var(--green)'; };
    paintLeft();
    m.querySelectorAll('[data-cap]').forEach(el => el.addEventListener('input', () => {
      const k = el.dataset.cap;
      const others = C.capsSpent(draft.caps) - (draft.caps[k] - CAP_FLOOR);
      const v = Math.max(CAP_FLOOR, Math.min(+el.value, mx[k], CAP_FLOOR + CAP_BUDGET - others));
      draft.caps[k] = v; el.value = v; $('capv_' + k).textContent = v;
      paintLeft(); refreshCreateCard();
    }));
    $('capReset').onclick = () => { sfx.click(); for (const a of ATTRS) draft.caps[a.key] = CAP_FLOOR; renderCreator(); };
    $('capEven').onclick = () => {
      sfx.click();
      for (const a of ATTRS) draft.caps[a.key] = CAP_FLOOR;
      for (let left = CAP_BUDGET, guard = 0; left > 0 && guard < 99; guard++) {
        const open = ATTRS.filter(a => draft.caps[a.key] < mx[a.key]);
        if (!open.length) break;
        for (const a of open) { if (left <= 0) break; draft.caps[a.key]++; left--; }
      }
      renderCreator();
    };
  } else if (cStep === 4) {
    syncBuild();
    const d = C.describeBuild(draft.position, draft.caps);
    m.innerHTML = `<div class="build-reveal"><div class="ng-label">YOUR BUILD</div><div class="br-name">${esc(draft.buildName)}</div>
      <div class="br-pos">${fmtHeight(draft.heightIn)} ${BUILDS[draft.build].name} ${POSITIONS[draft.position].name}</div>
      <div class="br-comp"><small>PLAYS LIKE</small><b>${esc(draft.comp)}</b></div>
      <small class="hint">${draft.method === 'own' ? `Your potential leans ${STYLE_ADJ[d.style].toLowerCase()} with a ${STYLE_ADJ[d.secondary].toLowerCase()} side.` : PLAYSTYLES[draft.style].desc}</small></div>
      ${potentialBars(draft.caps, 17)}`;
  } else {
    m.innerHTML = `<h3>SKIN TONE</h3><div class="swatches">${SKIN_TONES.map(c => `<button class="swatch ${draft.skin === c ? 'sel' : ''}" style="background:${c}" data-g="skin" data-k="${c}"></button>`).join('')}</div>
      <h3>HAIR</h3><div class="chips">${HAIR.map(h => `<button class="chip ${draft.hair === h ? 'sel' : ''}" data-g="hair" data-k="${h}">${h}</button>`).join('')}</div>
      <h3>ACCESSORIES</h3><div class="chips"><button class="chip ${draft.headband ? 'sel' : ''}" data-g="headband" data-k="1">Headband</button><button class="chip ${draft.sleeve ? 'sel' : ''}" data-g="sleeve" data-k="1">Arm Sleeve</button></div>
      <small class="hint">Jumpshots, dribble styles, dunk packages and defensive stances are on the Animations page: you unlock more as your ratings climb.</small>`;
  }
  m.querySelectorAll('[data-g]').forEach(el => el.addEventListener('click', () => {
    sfx.click();
    const g = el.dataset.g, k = el.dataset.k;
    if (g === 'num') draft.num = +k;
    else if (g === 'method') { draft.method = k; draft.caps = null; fixCaps(); if (k === 'own') for (const a of ATTRS) draft.caps[a.key] = CAP_FLOOR; }
    else if (g === 'position') { draft.position = k; draft.heightIn = heightIn(POSITIONS[k].height); draft.dribble = ['PF', 'C'].includes(k) ? 'power' : 'quick'; fixCaps(); }
    else if (g === 'build') { draft.build = k; fixCaps(); }
    else if (g === 'style') { draft.style = k; fixCaps(); }
    else if (g === 'headband' || g === 'sleeve') draft[g] = !draft[g];
    else draft[g] = k;
    renderCreator();
  }));
  refreshCreateCard();
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
  if (cStep === 1 && !draft.method) { toastMenu('Pick how you want to build'); return; }
  if (cStep === 3 && draft.method === 'own' && C.capsSpent(draft.caps) < CAP_BUDGET * 0.6) { toastMenu(`Spend your potential points (${CAP_BUDGET - C.capsSpent(draft.caps)} left)`); return; }
  if (cStep < C_STEPS.length - 1) { cStep++; renderCreator(); return; }
  draft.name = draft.name.trim().replace(/\s+/g, ' ');
  syncBuild();
  career = C.newCareer({ ...draft, caps: { ...draft.caps } });
  syncCareerSettings();
  C.saveCareer(career);
  goCareer();
};

// ---------------- Interviews ----------------
// A short sit-down: pick a "brand" answer (fans) or a "team" answer (chemistry) for each question
function runInterview(key, done) {
  const iv = C.interviewFor(key), m = $('modal');
  let q = 0, gotF = 0, gotC = 0;
  const step = () => {
    if (q >= iv.qs.length) {
      const deals = C.activeDeals(career);
      m.innerHTML = `<div class="ov-card iv"><div class="ng-label">${esc(iv.outlet)}</div><h1>THAT'S A WRAP</h1>
        <p>+${gotF.toLocaleString()} fans · ${gotC >= 0 ? '+' : ''}${gotC} team chemistry</p>
        <p class="hint">${(career.fans || 0).toLocaleString()} fans · Chemistry ${career.chem || 0}/100${deals.length ? ' · Deals: ' + deals.map(d => esc(d.name)).join(', ') : ''}</p>
        <div class="ov-btns"><button class="btn primary" id="ivDone">CONTINUE</button></div></div>`;
      $('ivDone').onclick = () => { sfx.click(); m.classList.remove('on'); C.saveCareer(career); done(); };
      return;
    }
    const [question0, answers] = iv.qs[q];
    const qv = VO[`iv_${key}_${q}`], introV = VO[`iv_${key}_intro`];
    const question = qv ? qv.text : question0, intro = introV ? introV.text : iv.intro;
    // The narrator sets the scene, then the interviewer asks
    if (q === 0 && introV) playVO(`iv_${key}_intro`, () => { if (qv) playVO(`iv_${key}_${q}`); });
    else if (qv) playVO(`iv_${key}_${q}`);
    m.innerHTML = `<div class="ov-card iv"><div class="ng-label">${esc(iv.outlet)} · ${esc(iv.who)}</div>${q === 0 ? `<p class="hint">${esc(intro)}</p>` : ''}
      <h2>"${esc(question)}"</h2><div class="iv-ans">
      <button class="choice" data-a="0"><b>${esc(answers[0])}</b><small>FANS ↑</small></button>
      <button class="choice" data-a="1"><b>${esc(answers[1])}</b><small>TEAM CHEMISTRY ↑</small></button></div></div>`;
    m.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      sfx.click(); stopVO();
      const r = C.answerInterview(career, key, q, +b.dataset.a);
      gotF += r.fans; gotC += r.chem; q++; step();
    }));
  };
  m.classList.add('on');
  step();
}

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
  if (career.pendingInterview && !career.pendingStory) {
    const k = career.pendingInterview;
    career.pendingInterview = null;
    C.saveCareer(career);
    runInterview(k, goCareer);
    return;
  }
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
  const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : String(n);
  const media = c.fans || c.chem ? `<div class="pc-media">${fmtK(c.fans || 0)} fans · Chemistry ${c.chem || 0}</div>` : '';
  $('hubCard').innerHTML = cardHTML(P, P.ratings, `<div class="pc-team">${esc(teamLine)}</div>${media}`);
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
  $('hubNext').innerHTML = `<div class="ng-scroll"><div class="ng-label">${esc(info.label)}</div>
    <div class="ng-match"><div class="ng-team">${teamLogo(info.myTeam)}<b>${esc(info.myTeam.name)}</b><small>${info.myOvr} OVR</small></div>
    <div class="ng-vs">VS</div>
    <div class="ng-team">${teamLogo(info.opp)}<b>${esc(info.opp.name)}</b><small>${info.oppOvr} OVR</small></div></div>
    ${info.tag ? `<div class="ng-tag">${esc(info.tag)}</div>` : ''}
    ${meter}
    ${c.rival && (c.phase === 'college' || c.nba) ? rivalHTML(c) : ''}
    ${tasksHTML(C.gameTasks(c, settings))}</div>
    <div class="ng-btns"><button class="btn ghost" id="btnSim">SIM GAME</button><button class="btn primary" id="btnPlay">PLAY GAME</button></div>`;
  C.saveCareer(c); // keep this game's tasks
  $('btnPlay').onclick = () => { sfx.click(); startMatch(info); };
  $('btnSim').onclick = () => {
    sfx.click();
    confirmModal('Simulate this game? Simmed games earn less AP.', () => {
      const res = C.simulateGame(career, info);
      res.scale = { q: settings.qLen, season: settings.seasonLength };
      finishMatch(info, res);
    });
  };
  $('hubUpgrade').innerHTML = `<b>UPGRADE ${c.ap > 0 || C.isMaxed() ? `<span class="badge">${C.isMaxed() ? '∞' : c.ap}</span>` : ''}</b><small>Spend attribute points</small>`;
  $('hubStandings').style.display = c.nba ? '' : 'none';
  const na = C.newAnimCount(c);
  $('hubStyle').innerHTML = `<b>ANIMATIONS ${na ? `<span class="badge">${na} NEW</span>` : ''}</b><small>Unlock &amp; equip · ${(c.vc || 0).toLocaleString()} VC</small>`;
}

$('hubUpgrade').onclick = () => { sfx.click(); renderUpgrade(); show('scrUpgrade'); };
$('hubStandings').onclick = () => { sfx.click(); renderStandings(); };
$('hubHistory').onclick = () => { sfx.click(); renderHistory(); };
$('hubStyle').onclick = () => { sfx.click(); renderAnimations(C.newAnimCount(career) ? 'recent' : animTab); };
$('hubBadges').onclick = () => { sfx.click(); renderBadges(); };

function badgeChip(key, tier) {
  const col = tier ? BADGE_COLORS[tier - 1] : '#3a3f50';
  return `<span class="bdg" style="--bc:${col}">${BADGES[key].name[0]}</span>`;
}

function renderBadges() {
  const c = career, prog = c.badges || {};
  $('listTitle').textContent = 'BADGES';
  const P = c.player;
  let html = `<div class="up-group">GOAT SKILL</div><p class="hint">Pick one. Hit its requirement in a game and it switches on for 5 game minutes, boosting its attributes (Bronze +15, Silver +20, Gold +27, Hall of Fame 99). Every activation counts toward the next tier.</p>
    <div class="choices">${Object.entries(GOAT_SKILLS).map(([k, gs]) => {
      const acts = (c.goatProg || {})[k] || 0, t = C.isMaxed() ? GOAT_TIERS.length - 1 : goatTier(acts), T = GOAT_TIERS[t], nx = GOAT_TIERS[t + 1];
      return `<button class="choice ${P.goat === k ? 'sel' : ''}" data-goat="${k}"><b style="color:${gs.color}">${gs.name}</b> <em style="color:${T.color};font-style:normal;font-size:11px;font-weight:900">${T.name.toUpperCase()}</em>
        <small>${gs.req} → ${gs.attrs.map(a => ATTRS.find(x => x.key === a).name).join(', ')} ${T.boost >= 99 ? 'go to 99' : '+' + T.boost}</small>
        <small>${nx ? `${acts}/${nx.need} activations to ${nx.name} (${nx.boost >= 99 ? '99' : '+' + nx.boost})` : 'Max tier'}</small></button>`;
    }).join('')}</div>`;
  html += '<p style="color:var(--dim);font-size:12px;margin:0 0 6px">Badges level up as you do things in games. Every tier makes the effect stronger: Bronze, Silver, Gold, Hall of Fame.</p>';
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
  $('listBody').querySelectorAll('[data-goat]').forEach(b => b.addEventListener('click', () => { sfx.click(); P.goat = b.dataset.goat; C.saveCareer(c); const st = $('listBody').scrollTop; renderBadges(); $('listBody').scrollTop = st; }));
  if (screenStack[screenStack.length - 1] !== 'scrList') show('scrList');
}
$('hubMenu').onclick = () => {
  sfx.click();
  const m = $('modal');
  m.innerHTML = `<div class="ov-card"><h1>MENU</h1><div class="ov-btns" style="flex-direction:column">
    <button class="btn" id="mmMaxed">INFINITE AP + ALL BADGES: ${settings.maxed ? 'ON' : 'OFF'}</button><button class="btn" id="mmSettings">SETTINGS</button><button class="btn" id="mmTitle">MAIN MENU</button><button class="btn ghost" id="mmClose">CLOSE</button></div></div>`;
  m.classList.add('on');
  $('mmClose').onclick = () => m.classList.remove('on');
  $('mmSettings').onclick = () => { m.classList.remove('on'); renderSettings(); };
  $('mmMaxed').onclick = () => {
    sfx.click();
    settings.maxed = !settings.maxed;
    C.saveSettings(settings); C.setMaxed(settings.maxed);
    $('mmMaxed').textContent = `INFINITE AP + ALL BADGES: ${settings.maxed ? 'ON' : 'OFF'}`;
    renderHub();
  };
  $('mmTitle').onclick = () => { m.classList.remove('on'); renderTitle(); };
};

function renderUpgrade() {
  const c = career, r = c.player.ratings;
  $('upAP').textContent = apText(c);
  $('upOVR').textContent = `${C.userOverall(c)} OVR`;
  let html = '', group = '';
  for (const a of ATTRS) {
    if (a.group !== group) { group = a.group; html += `<div class="up-group">${group.toUpperCase()}</div>`; }
    const v = r[a.key], cost = upgradeCost(v), cap = C.capOf(c, a.key), maxed = v >= cap;
    html += `<div class="up-row" id="up_${a.key}"><div><div class="nm">${a.name}</div><div class="track"><i style="width:${v}%"></i><b class="cap" style="left:${cap}%"></b></div></div>
      <div class="val">${v}<small class="capv">/${cap}</small></div><button class="plus" data-k="${a.key}" ${(!C.isMaxed() && c.ap < cost) || maxed ? 'disabled' : ''}>+1<small>${maxed ? 'MAX' : cost + ' AP'}</small></button></div>`;
  }
  $('upList').innerHTML = html;
  $('upList').querySelectorAll('.plus').forEach(b => b.addEventListener('click', () => {
    if (C.upgrade(c, b.dataset.k)) {
      sfx.click();
      announceUnlocks(C.checkAnimUnlocks(c));
      C.saveCareer(c);
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
  const goals = C.lifeGoals(c);
  const goalsHTML = `<div class="up-group">LIFETIME GOALS</div><p class="hint">${c.nba ? '' : 'Unlocks when you reach the NBA. '}Only NBA games count, scaled to full NBA games (12-minute quarters, 82-game seasons).</p>
    <div class="goals">${goals.map(gl => {
      const nx = gl.next, prev = gl.done ? gl.tiers[gl.done - 1][0] : 0;
      const pct = nx ? Math.min(100, Math.max(0, (gl.value - (gl.kind === 'game' ? 0 : prev)) / ((nx[0] - (gl.kind === 'game' ? 0 : prev)) || 1) * 100)) : 100;
      return `<div class="goal ${nx ? '' : 'done'}"><div><b>${esc(gl.label)}</b><small>${nx ? `Next: ${nx[0].toLocaleString()}${nx[1] ? ' · beat ' + esc(nx[1]) : ''}` : 'All tiers done'} · ${gl.done}/${gl.tiers.length}</small>
        <div class="track"><i style="width:${pct}%"></i></div></div><em>${gl.value.toLocaleString()}</em></div>`;
    }).join('')}</div>`;
  $('listBody').innerHTML = goalsHTML + `<div class="up-group">CAREER STATS</div><div class="statline"><div><b>${t.gp}</b><small>GP</small></div><div><b>${avg('pts')}</b><small>PPG</small></div><div><b>${avg('reb')}</b><small>RPG</small></div><div><b>${avg('ast')}</b><small>APG</small></div><div><b>${avg('stl')}</b><small>SPG</small></div><div><b>${avg('blk')}</b><small>BPG</small></div></div>
    ${c.awards.length ? `<div class="notes">${c.awards.map(a => `<div>🏆 ${esc(a)}</div>`).join('')}</div>` : ''}
    <table><tr><th>SEASON</th><th>PHASE</th><th>OPP</th><th>RESULT</th><th>GRD</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG</th></tr>
    ${c.history.slice().reverse().map(h => `<tr><td>${h.season}</td><td>${h.phase.toUpperCase()}</td><td>${h.opp}</td><td style="color:${h.win ? 'var(--green)' : 'var(--red)'}">${h.win ? 'W' : 'L'} ${h.my}-${h.them}</td><td style="color:${gradeColor(h.grade)}">${h.grade}</td><td>${h.pts}</td><td>${h.reb}</td><td>${h.ast}</td><td>${h.stl}</td><td>${h.blk}</td><td>${h.fgm}/${h.fga}</td></tr>`).join('')}</table>`;
  show('scrList');
}

// ---------------- Animations ----------------
// Your position's list of jumpshots, dribble styles, dunk packages and defensive stances. They unlock when
// your ratings hit the requirement (you get a notification), or you can buy them early with VC.
let animTab = 'recent';
function reqText(c, a) {
  return Object.entries(a.req || {}).map(([k, v]) => {
    const have = c.player.ratings[k] || 0;
    return `<span class="${have >= v ? 'ok' : ''}">${v} ${ATTRS.find(x => x.key === k).name} (${have})</span>`;
  }).join(' · ');
}
function animCard(c, a, isNew) {
  const A = c.anims, own = A.owned.includes(a.id), eq = A.equipped[a.cat] === a.id;
  const btn = eq ? `<button class="btn small eq" disabled>EQUIPPED</button>`
    : own ? `<button class="btn small primary" data-eq="${a.id}">EQUIP</button>`
      : `<button class="btn small" data-buy="${a.id}" ${c.vc < a.vc ? 'disabled' : ''}>BUY ${a.vc.toLocaleString()} VC</button>`;
  return `<div class="anim ${own ? 'own' : 'locked'} ${eq ? 'eq' : ''}"><div class="ai"><b>${esc(a.name)}${isNew ? ' <em class="new">NEW</em>' : ''}</b>
    <small class="cat">${ANIM_CATS[a.cat].replace(/s$/, '')}</small><small>${esc(a.desc)}</small>
    ${own ? '' : `<small class="req">${Object.keys(a.req || {}).length ? 'Unlocks at ' + reqText(c, a) : ''}</small>`}</div>${btn}</div>`;
}
function renderAnimations(tab) {
  const c = career, A = c.anims, pos = c.player.position;
  if (tab) animTab = tab;
  $('listTitle').textContent = `ANIMATIONS · ${(c.vc || 0).toLocaleString()} VC`;
  const fresh = C.newAnimCount(c);
  const tabs = [['recent', `RECENTLY UNLOCKED${fresh ? ` (${fresh})` : ''}`], ...Object.entries(ANIM_CATS).map(([k, v]) => [k, v.toUpperCase()])];
  let html = `<div class="seg anim-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${animTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (animTab === 'recent') {
    html += `<p class="hint">Animations unlock as your ratings climb. You can also buy them early with VC, which you earn every game and from game tasks.</p>`;
    html += A.recent.length ? A.recent.map(r => animCard(c, animFor(r.id), !r.seen)).join('') : '<p class="hint">Nothing new yet. Upgrade your attributes to unlock more.</p>';
    for (const r of A.recent) r.seen = true;
    C.saveCareer(c);
  } else {
    const list = ANIMS.filter(a => a.cat === animTab && animAllowed(a, pos));
    html += `<p class="hint">${POSITIONS[pos].name} ${ANIM_CATS[animTab].toLowerCase()}.</p>` + list.map(a => animCard(c, a, false)).join('');
  }
  $('listBody').innerHTML = html;
  $('listBody').querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { sfx.click(); renderAnimations(b.dataset.tab); }));
  $('listBody').querySelectorAll('[data-eq]').forEach(b => b.addEventListener('click', () => { sfx.click(); C.equipAnim(c, b.dataset.eq); C.saveCareer(c); renderAnimations(); }));
  $('listBody').querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
    const a = animFor(b.dataset.buy);
    confirmModal(`Buy ${a.name} for ${a.vc.toLocaleString()} VC?`, () => { if (C.buyAnim(c, a.id)) { C.equipAnim(c, a.id); C.saveCareer(c); sfx.green(); } renderAnimations(); });
  }));
  if (screenStack[screenStack.length - 1] !== 'scrList') show('scrList');
}
// Tell the player about newly unlocked animations
function announceUnlocks(list) {
  if (!list || !list.length) return;
  const names = list.map(a => a.name).join(', ');
  toastMenu(`NEW ANIMATION${list.length > 1 ? 'S' : ''} UNLOCKED: ${names}`, 'Tap to open the Animations page', 'var(--green)', () => renderAnimations('recent'));
}

function renderSettings() {
  const S = settings;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-s="${key}" data-v="${v}" class="${String(S[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  $('settingsBody').innerHTML = `
    <div class="set-row"><label>Infinite AP + All Badges<small>Upgrades cost nothing and every badge is Hall of Fame. Turn off to go back to your earned progress</small></label>${seg('maxed', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Quarter Length</label>${seg('qLen', [[2, '2 min'], [3, '3 min'], [5, '5 min'], [8, '8 min']])}</div>
    <div class="set-row"><label>Difficulty</label>${seg('difficulty', [[0, 'Rookie'], [1, 'Pro'], [2, 'All-Star'], [3, 'Hall of Fame']])}</div>
    <div class="set-row"><label>Season Length<small>Regular season games you play</small></label>${seg('seasonLength', [[10, '10'], [16, '16'], [29, '29'], [41, '41']])}</div>
    <div class="set-row"><label>Playoff Series<small>Short: best-of-3, Finals best-of-5</small></label>${seg('seriesLen', [['short', 'Short'], ['long', 'Best-of-7']])}</div>
    <div class="set-row"><label>Camera</label>${seg('camera', [['2k', '2K Cam'], ['broadcast', 'Broadcast']])}</div>
    <div class="set-row"><label>Graphics</label>${seg('quality', [['low', 'Low'], ['med', 'Medium'], ['high', 'High']])}</div>
    <div class="set-row"><label>Auto Defensive Assist<small>Also guard your man automatically whenever the stick is idle (the DEF ASSIST stick always works)</small></label>${seg('defAssist', [[true, 'On'], [false, 'Off']])}</div>
    <div class="set-row"><label>Button Layout<small>Move and resize buttons from the in-game pause menu (MOVE BUTTONS)</small></label><button class="btn ghost" id="resetLayout">RESET LAYOUT</button></div>
    <div class="set-row"><label>Replays<small>Instant replays of big plays and a highlight reel after each game</small></label>${seg('replays', [[true, 'On'], [false, 'Off']])}</div>
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
let recorder = null, replay = null, lastReplayT = -99, reelShown = false, snapCam = false, heldClip = null;

const DUNK_NAMES = { one: 'ONE-HAND JAM!', two: 'TWO-HAND SLAM!', tomahawk: 'TOMAHAWK!', cockback: 'COCK-BACK SLAM!', reverse: 'REVERSE JAM!',
  clutch: 'CLUTCH DUNK!', windmill: 'WINDMILL!', '360': '360 DUNK!', btl: 'BETWEEN THE LEGS!', contact: 'IN HIS FACE!',
  leaner: 'LEANER!', backscratch: 'BACK-SCRATCHER!', cradle: 'ROCK THE CRADLE!', windmill2: 'TWO-HAND WINDMILL!', '360wm': '360 WINDMILL!' };

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
    ...C.animOpts(career), playstyle: P.style, goat: P.goat || null, goatTier: C.goatTierOf(career), intensity: info.intensity || 0, chemTakeover: info.chemTakeover || 0, defAssist: settings.defAssist, passBias: info.passBias, badges: info.badges, greenBoost: info.greenBoost,
    onEvent: onGameEvent,
  });
  game.homeIdx = info.teams.indexOf(info.homeTeam);
  recorder = new Recorder(game); replay = null; lastReplayT = -99; reelShown = false; heldClip = null;
  $('scrGame').classList.remove('replaying');
  renderer.camMode = settings.camera;
  renderer.camYaw = undefined;
  renderer.resize();
  renderer.buildArena(info.homeTeam);
  renderer.addPlayers(game);
  renderer.precompile();
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
    // Warmups first (with the story's cutscene when there is one), then the tip-off card
    const prePhase = game.phase;
    game.phase = 'pregame';
    runWarmup(info, () => tipOffCard(info, prePhase));
  }
  startCrowd();
  running = true;
  last = performance.now();
  requestAnimationFrame(loop);
}
let warmup = null;
function runWarmup(info, done) {
  const c = career, P = c.player;
  const rv = game.players.find(p => p.isRival);
  const kind = c.phase === 'hs' && c.hs.round === 0 && !c.history.length ? 'debut' : c.phase === 'hs' && c.hs.round === 2 ? 'trash'
    : rv ? 'rival' : (info.intensity || 0) >= 0.5 ? 'heated' : null;
  const script = kind ? cutscene(kind, game, { school: info.myTeam.name, first: P.name.split(' ')[0], talker: rv ? rv.idx : null, rivalFirst: rv ? rv.name.split(' ')[0] : '' }) : null;
  warmup = new Warmup(game, renderer, script);
  $('scrGame').classList.add('warming');
  const paint = () => {
    const s = warmup.shot;
    overlay(`<div class="wu" id="wuTap">
      <div class="wu-top"><div class="ng-label">${esc(info.label)}</div><b>${s ? '' : 'WARMUPS'}</b></div>
      ${s ? `<div class="wu-cap"><em>${esc(s.speaker)}</em><p>${esc(s.text)}</p></div>` : ''}
      <div class="wu-hint">TAP TO SKIP</div></div>`);
    $('wuTap').onclick = () => { sfx.click(); clearTimeout(lineT); stopVO(); if (warmup && warmup.shot) warmup.line = warmup.script.length; finish(); };
    // The scene plays out on its own: each line is spoken (voice acting), then a beat, then the next one.
    // Lines without audio (or when muted) stay up long enough to read.
    clearTimeout(lineT);
    if (!s) return;
    const advance = () => { clearTimeout(lineT); if (!warmup) return; if (warmup.next()) paint(); else finish(); };
    const readT = 1800 + s.text.length * 45;
    if (s.vo) {
      const me = warmup.line;
      lineT = setTimeout(advance, ((VO[s.vo] && VO[s.vo].dur) || 4) * 1000 + 3500); // safety net
      playVO(s.vo, ok => { if (!warmup || warmup.line !== me) return; clearTimeout(lineT); lineT = setTimeout(advance, ok ? 650 : readT); });
    } else lineT = setTimeout(advance, readT);
  };
  let lineT = null;
  let auto = null;
  const finish = () => {
    if (!warmup) return;
    clearTimeout(auto);
    if (warmup.shot) { warmup.line = warmup.script.length; paint(); auto = setTimeout(finish, 9000); return; } // cutscene over: a few seconds of warmups, then tip-off
    stopVO(); warmup.end(); warmup = null; overlay(null); $('scrGame').classList.remove('warming'); done();
  };
  paint();
  if (!script) auto = setTimeout(finish, 12000);
}
function tipOffCard(info, prePhase) {
  {
    overlay(`<div class="ov-card"><div class="ng-label">${esc(info.label)}</div><h1>${esc(info.myTeam.name)} vs ${esc(info.opp.name)}</h1>
      ${info.boost ? `<p>G League Boost: +${info.boost} to all attributes this game</p>` : ''}
      ${tasksHTML(C.gameTasks(career, settings))}
      <div class="ov-btns"><button class="btn ghost" id="ovHelp">CONTROLS</button><button class="btn primary" id="ovTip">TIP OFF</button></div></div>`);
    $('ovTip').onclick = () => { overlay(null); game.phase = prePhase; sfx.whistle(); };
    $('ovHelp').onclick = () => showHelp(() => startMatchOverlayAgain(info, prePhase));
  }
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
    <b>Takeover</b><span>Buckets, greens, assists, stops, blocks, steals and boards fill your takeover meter (misses and turnovers drain it). Fill it to take over for a stretch. The type is whatever you've been doing most that game: Shooting, Finishing, Playmaking, Lockdown or Glass. Opposing stars can heat up too.</span>
    <b>GOAT skill</b><span>Pick one on the Badges page. Hit its requirement (e.g. 3 made layups/dunks) to max out its attributes for 5 game minutes</span>
    <b>Keyboard</b><span>WASD move · Shift sprint · Space shoot · K pass/box out · L lob/steal · O pick/screen · P post · Z def assist · X intense · Q/E/R/F/T moves</span>
  </div><div class="ov-btns"><button class="btn primary" id="ovOk">GOT IT</button></div></div>`);
  $('ovOk').onclick = () => after();
}

$('btnPause').onclick = () => {
  if (!game || paused || game.phase === 'over') return;
  paused = true;
  overlay(`<div class="ov-card"><h1>PAUSED</h1><p>${game.score[0]} - ${game.score[1]} · Q${game.quarter}</p>
    ${tasksHTML(C.gameTasks(career, settings), game.user.stats, { greens: game.badgeCounts.greenMachine || 0, gradeScore: game.grade, win: game.score[game.userTeam] > game.score[1 - game.userTeam] })}
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
      renderer.hype = Math.max(renderer.hype || 0, d.p.team === game.homeIdx ? (d.three ? 0.8 : 0.55) : 0.3);
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
    case 'poster': renderer.hype = 1.6; markPlay('poster', d.p, d.p.isUser || d.def.isUser ? 10 : 7, 'POSTERIZED!', true); toast(d.p.isUser ? 'POSTERIZED!' : d.def.isUser ? 'YOU GOT POSTERIZED' : 'POSTERIZED!', '#ff5a1f'); sfx.ooh(); renderer.shake = 0.6; if (d.p.isUser) vib(90); break;
    case 'stepover': renderer.hype = Math.max(renderer.hype || 0, 1.3); sfx.ooh(); toast(d.p.isUser ? 'STEPPED OVER HIM!' : 'STEPPED OVER!', d.p.team === game.userTeam ? '#ff5a1f' : '#e5484d'); if (d.p.isUser) markPlay('poster', d.p, 9, 'STEP OVER', false); break;
    case 'tipWon': callout(d.team === game.userTeam ? (d.by.isUser ? 'YOU WON THE TIP!' : 'WON THE TIP') : 'LOST THE TIP', d.team === game.userTeam ? '#3ddc84' : '#e5484d'); break;
    case 'goat': {
      // Hard to miss: announcer call, big banner, crowd on its feet, ring under your player (render.js)
      callout(`${d.info.name.toUpperCase()} ACTIVATED!`, d.info.color);
      toast(`GOAT · ${d.tier.name.toUpperCase()}`, d.info.color);
      playVO('goat_' + game.opts.goat);
      sfx.cheer(1.2); vib([60, 40, 90]); renderer.hype = Math.max(renderer.hype || 0, 1.5); renderer.shake = 0.25;
      $('scrGame').classList.remove('goat-flash'); void $('scrGame').offsetWidth; $('scrGame').classList.add('goat-flash');
      $('scrGame').style.setProperty('--goat', d.info.color);
      break;
    }
    case 'goatProgress': callout(`GOAT ${d.n}/${d.need}`, '#cfd3df'); break;
    case 'goatEnd': callout('GOAT SKILL OVER', '#9aa3b2'); break;
    case 'scuffle': renderer.hype = Math.max(renderer.hype || 0, 1.5); renderer.shake = 0.3; sfx.ooh(); toast('SCUFFLE!', '#e5484d'); callout('DOUBLE TECHNICAL', '#ff8a8d'); vib(80); break;
    case 'takeover': {
      const nm = `#${d.p.num} ${d.p.name.split(' ').pop().toUpperCase()}`;
      if (d.p.isUser) {
        callout(`${d.info.name.toUpperCase()} TAKEOVER!`, d.info.color); toast('TAKEOVER', d.info.color);
        sfx.cheer(1); vib(80); renderer.hype = Math.max(renderer.hype || 0, 1.4);
      } else toast(d.p.team === game.userTeam ? `${nm} IS TAKING OVER` : `${nm} IS HEATING UP`, d.p.team === game.userTeam ? d.info.color : '#e5484d');
      break;
    }
    case 'takeoverEnd': if (d.p.isUser) callout('TAKEOVER OVER', '#9aa3b2'); break;
    case 'charge': toast(d.def.isUser ? 'CHARGE TAKEN!' : 'CHARGE', d.def.team === game.userTeam ? '#3ddc84' : '#e5484d'); break;
    case 'ankle': renderer.hype = Math.max(renderer.hype || 0, 1.2); if (d.p.isUser) markPlay('ankle', d.p, 8, 'ANKLE BREAKER', true); toast('ANKLE BREAKER!', '#ff5a1f'); sfx.ooh(); renderer.shake = 0.35; vib(60); break;
    case 'beat': if (d.p.isUser) callout('BLOW-BY', '#ffd23f'); sfx.squeak(); break;
    case 'block': {
      const bl = d.type === 'chase' ? 'CHASE-DOWN BLOCK!' : d.type === 'snatch' ? 'SNATCHED!' : d.def.isUser ? 'BLOCKED BY YOU!' : 'BLOCKED!';
      if (d.def.isUser) markPlay('block', d.def, d.type === 'swat' ? 7 : 9, d.type === 'chase' ? 'CHASE-DOWN BLOCK' : d.type === 'snatch' ? 'SNATCHED' : 'REJECTED!', true);
      else if (d.type !== 'swat') markPlay('block', d.def, 5, d.type === 'chase' ? 'CHASE-DOWN BLOCK' : 'SNATCHED', false);
      renderer.hype = Math.max(renderer.hype || 0, 1.1);
      toast(bl, d.def.team === game.userTeam ? '#3ddc84' : '#e5484d'); sfx.block(); renderer.shake = d.type === 'swat' ? 0.2 : 0.35; if (d.def.isUser) vib(40); break;
    }
    case 'steal': sfx.steal(); if (d.def.isUser) { toast('STOLEN!', '#3ddc84'); vib(40); } else if (d.h && d.h.isUser) toast('TURNOVER', '#e5484d'); break;
    case 'dunk': {
      const dn = DUNK_NAMES[d.p.dunkStyle] || 'SLAM!';
      const flashy = ['windmill', '360', 'btl', 'reverse', 'contact', 'leaner', 'backscratch', 'cradle', 'windmill2', '360wm'].includes(d.p.dunkStyle);
      // Only the flashy / contact ones get an instant replay (all of them still go in the highlight reel)
      markPlay('dunk', d.p, d.p.isUser ? (flashy ? 8 : 6) : flashy ? 5 : 3, dn, d.p.isUser && flashy);
      sfx.dunk(); renderer.shake = 0.45; renderer.hype = Math.max(renderer.hype || 0, flashy ? 1.4 : 1.1);
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
  const rvp = game.players.find(p => p.isRival);
  const res = { goatActs: game.goatActs || 0, rivalStats: rvp ? { ...rvp.stats } : null, stats: { ...game.user.stats }, grade: game.grade, myScore: game.score[my], oppScore: game.score[1 - my], simmed: false, badgeCounts: { ...game.badgeCounts } };
  overlay(null);
  finishMatch(matchInfo, res, game);
}

function finishMatch(info, res, g) {
  res.scale = { q: settings.qLen, season: settings.seasonLength };
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
      <div class="ap">+${out.ap} AP</div><div class="vc">+${out.vc.toLocaleString()} VC</div>${res.simmed ? '<small style="color:var(--dim)">Simulated</small>' : ''}</div>
    <div>
      <div class="ng-label">${esc(info.label)} · vs ${esc(info.opp.name)}</div>
      <div class="statline"><div><b>${s.pts}</b><small>PTS</small></div><div><b>${s.reb}</b><small>REB</small></div><div><b>${s.ast}</b><small>AST</small></div><div><b>${s.stl}</b><small>STL</small></div><div><b>${s.blk}</b><small>BLK</small></div><div><b>${s.fgm}/${s.fga}</b><small>FG</small></div></div>
      ${out.tasks.length ? tasksHTML(out.tasks.map(t => ({ ...t, id: 'pts' })), null, null, out.tasks) : ''}
      <div class="notes">${out.newDeal ? `<div class="badge-up" style="border-left-color:#7cc4ff">NEW ENDORSEMENT: ${esc(out.newDeal.name)} · +${out.newDeal.vc} VC every game</div>` : ''}${out.goals.map(x => `<div class="badge-up" style="border-left-color:var(--gold)">LIFETIME GOAL: ${esc(x.label)} ${x.n.toLocaleString()}${x.who ? ` · passed ${esc(x.who)}` : ''} · +${x.ap} AP +${x.vc.toLocaleString()} VC</div>`).join('')}${out.newAnims.map(a => `<div class="badge-up" style="border-left-color:var(--green)">NEW ANIMATION UNLOCKED: ${esc(a.name)} · equip it on the Animations page</div>`).join('')}${out.badgeUps.map(u => `<div class="badge-up" style="border-left-color:${BADGE_COLORS[u.tier - 1]}">${badgeChip(u.key, u.tier)} NEW BADGE: ${BADGES[u.key].name} (${BADGE_TIERS[u.tier - 1]})</div>`).join('')}${out.boosts.map(b => `<div class="boost">Skill boost: ${esc(b)}</div>`).join('')}${out.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>
      ${box}
      <div class="ov-btns" style="justify-content:flex-start"><button class="btn primary" id="postGo">CONTINUE</button></div>
    </div>`;
  show('scrPost', false);
  $('postGo').onclick = () => {
    sfx.click(); goCareer();
    if (out.goals.length) { const x = out.goals[out.goals.length - 1]; toastMenu(`LIFETIME GOAL: ${x.label} ${x.n.toLocaleString()}${x.who ? ' · passed ' + x.who : ''}`, 'See all your goals on the Career page', 'var(--gold)', () => renderHistory()); }
    else if (out.newAnims.length) announceUnlocks(out.newAnims);
  };
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
  if (warmup && !paused) warmup.update(dt);
  if (!paused) {
    // Fixed-ish substeps for stable physics
    const steps = dt > 0.02 ? 2 : 1;
    for (let i = 0; i < steps; i++) g.update(dt / steps, i === 0 ? input : { ...input, shootPressed: false, passPressed: false, gesture: null, shootReleased: false });
  }
  renderer.render(g, dt, now / 1000);
  if (!paused && !replay) renderer.adapt(dt);
  updateHUD(dt);
  if (!paused && recorder) {
    recorder.capture(dt);
    const clip = recorder.update();
    // Instant replays wait for a dead ball, so they never cut into a possession (an ankle breaker shows once
    // the play is over), and they're spaced out (dunks most of all)
    if (clip && settings.replays !== false) heldClip = { clip, t: g.time };
    if (heldClip && g.time - heldClip.t > 9) heldClip = null;
    const gap = heldClip && heldClip.clip.kind === 'dunk' ? 40 : 20;
    if (heldClip && g.phase === 'dead' && g.ball.state !== 'shot' && g.ball.state !== 'net' && g.time - lastReplayT > gap) {
      lastReplayT = g.time;
      const c2 = heldClip.clip; heldClip = null;
      startReplay([c2], 'instant', null);
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
  // Takeover meter
  const to = TAKEOVERS[u.toType];
  const toTxt = to.name.toUpperCase() + (u.toOn ? ' TAKEOVER' : '');
  if (ui.toTxt !== toTxt) { $('huTOName').textContent = toTxt; $('huTO').classList.toggle('on', u.toOn); ui.toTxt = toTxt; }
  $('huTOFill').style.width = (u.toMeter * 100).toFixed(1) + '%';
  $('huTOFill').style.background = to.color;
  const gs = g.opts.goat && GOAT_SKILLS[g.opts.goat];
  const gtier = GOAT_TIERS[g.opts.goatTier || 0].name.toUpperCase();
  const gtxt = !gs ? '' : u.goatOn ? `${gs.name.toUpperCase()} (${gtier}) · ${Math.ceil(Math.max(0, u.goatUntil - g.time))}s` : `GOAT ${u.goatN || 0}/${gs.need} · ${gtier}`;
  if (ui.gtxt !== gtxt) { $('huGoat').textContent = gtxt; $('huGoat').style.color = u.goatOn ? gs.color : ''; ui.gtxt = gtxt; }
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
    $('meterWin').style.display = w > 0 ? '' : 'none'; // out of range: no green to hit
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
