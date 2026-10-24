// 2K-mobile-style touch controls.
// Left: floating joystick (push to the edge to sprint).
// Right: four action buttons + a right stick whose meaning changes with context:
//   with ball  — SHOOT, PASS, LOB PASS, SET PICK, stick = DRIBBLE moves / hold to POST UP
//   off ball   — ALLEY-OOP, CALL BALL, CALL SCREEN, SET SCREEN
//   defense    — BLOCK/REBOUND, BOX OUT, STEAL, stick = hold for DEF ASSIST, push to edge for INTENSE D
// Keyboard fallback for desktop testing.

const svg = body => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const BALL = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/><path d="M${cx - r} ${cy}h${r * 2}M${cx} ${cy - r}v${r * 2}"/><path d="M${cx - r * 0.7} ${cy - r * 0.7}q${r * 0.7} ${r * 0.7} 0 ${r * 1.4}M${cx + r * 0.7} ${cy - r * 0.7}q${-r * 0.7} ${r * 0.7} 0 ${r * 1.4}"/>`;
const ICONS = {
  shoot: svg(`${BALL(24, 28, 9)}<path d="M24 14V4M19 9l5-5 5 5"/>`),
  pass: svg(`${BALL(17, 26, 9)}<path d="M28 26h16M39 21l5 5-5 5"/>`),
  lob: svg(`${BALL(13, 32, 7)}<path d="M18 22q12-18 24 0M42 22l-1-7M42 22l-7-1"/>`),
  pick: svg(`<circle cx="24" cy="9" r="4.5"/><path d="M24 14v16M13 21h22M24 30l-7 13M24 30l7 13"/>`),
  screen: svg(`<circle cx="18" cy="9" r="4.5"/><path d="M18 14v16M18 30l-6 13M18 30l6 13M10 21h16"/><path d="M34 10v30" stroke-width="4"/>`),
  call: svg(`<path d="M16 40V20a3 3 0 016 0v10M22 24v-8a3 3 0 016 0v14M28 20a3 3 0 016 0v12M34 26a3 3 0 016 0v6c0 7-5 12-12 12h-2c-5 0-8-3-10-6l-6-8a3 3 0 015-3l1 1"/>`),
  block: svg(`<path d="M16 44V22a3 3 0 016 0v6M22 16a3 3 0 016 0v12M28 14a3 3 0 016 0v14M34 20a3 3 0 016 0v12c0 7-5 12-12 12h-2"/><circle cx="12" cy="10" r="6"/>`),
  steal: svg(`${BALL(14, 30, 8)}<path d="M26 10l14 6M24 18l16 6M24 26l14 4"/><path d="M40 16v14"/>`),
  boxout: svg(`<circle cx="24" cy="8" r="4.5"/><path d="M24 13v14M8 18l16 4 16-4M24 27l-9 15M24 27l9 15"/>`),
};

const LAYOUTS = {
  ball: { a: ['SHOOT', 'shoot'], b: ['PASS', 'pass'], c: ['LOB PASS', 'lob'], d: ['SET PICK', 'pick'], stick: 'DRIBBLE / POST UP' },
  post: { a: ['SHOOT', 'shoot'], b: ['PASS', 'pass'], c: ['LOB PASS', 'lob'], d: ['SET PICK', 'pick'], stick: 'POST MOVES · HOLD = FACE UP' },
  offBall: { a: ['ALLEY-OOP', 'lob'], b: ['CALL BALL', 'call'], c: ['CALL SCREEN', 'pick'], d: ['SET SCREEN', 'screen'], stick: null },
  defense: { a: ['BLOCK / REBOUND', 'block'], b: ['BOX OUT', 'boxout'], c: ['STEAL', 'steal'], d: null, stick: 'SWITCH / DEF ASSIST' },
  ft: { a: ['SHOOT', 'shoot'], b: null, c: null, d: null, stick: null },
};

const LAYOUT_KEY = 'hoops.layout.v1';
const MOVABLE = ['cb_a', 'cb_b', 'cb_c', 'cb_d', 'rstick'];

export class Controls {
  constructor(root) {
    this.root = root;
    this.move = { x: 0, z: 0 };
    this.joyMag = 0;
    this.keys = new Set();
    this.held = { a: false, b: false, c: false, d: false };
    this.edges = { aDown: false, aUp: false, bDown: false, cDown: false, dDown: false, postToggle: false };
    this.gesture = null;
    this.stick = { held: false, intense: false };
    this.mode = null;
    this.build();
    this.bind();
    this.setMode('ball');
    try { this.layout = JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch (e) { this.layout = {}; }
    this.applyLayout();
  }

  build() {
    this.root.innerHTML = `
      <div class="joy-zone" id="joyZone"></div>
      <div class="joy-base" id="joyBase"><div class="joy-knob" id="joyKnob"></div></div>
      ${['a', 'b', 'c', 'd'].map(s => `<button class="cb slot-${s}" id="cb_${s}"><i></i><span></span></button>`).join('')}
      <div class="rstick" id="rstick"><div class="rs-ring"></div><div class="rs-knob" id="rsKnob"></div><span id="rsLabel"></span></div>
      <div class="swipe-trail" id="swipeTrail"></div>`;
    this.$ = id => this.root.querySelector('#' + id);
    this.joyBase = this.$('joyBase');
    this.joyKnob = this.$('joyKnob');
  }

  setMode(mode) {
    if (mode === this.mode || (this.editing && this.mode !== null)) return;
    this.mode = mode;
    const L = LAYOUTS[mode] || LAYOUTS.ball;
    for (const s of ['a', 'b', 'c', 'd']) {
      const el = this.$('cb_' + s);
      const def = L[s];
      el.classList.toggle('hidden', !def);
      if (def) { el.querySelector('span').textContent = def[0]; el.querySelector('i').innerHTML = ICONS[def[1]]; }
    }
    this.$('rstick').classList.toggle('hidden', !L.stick);
    this.$('rsLabel').textContent = L.stick || '';
    this.root.classList.toggle('mode-def', mode === 'defense');
  }

  bind() {
    // ---- Left joystick (push to the edge = sprint)
    const joyZone = this.$('joyZone');
    const R = 62;
    let joyId = null, cx = 0, cy = 0;
    joyZone.addEventListener('pointerdown', e => {
      if (joyId !== null) return;
      joyId = e.pointerId; cx = e.clientX; cy = e.clientY;
      this.joyBase.style.left = cx + 'px'; this.joyBase.style.top = cy + 'px';
      this.joyBase.classList.add('active');
      e.preventDefault();
    });
    addEventListener('pointermove', e => {
      if (e.pointerId !== joyId) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        const over = d - R;
        cx += dx / d * over; cy += dy / d * over;
        this.joyBase.style.left = cx + 'px'; this.joyBase.style.top = cy + 'px';
        dx = e.clientX - cx; dy = e.clientY - cy;
      }
      const m = Math.min(1, Math.hypot(dx, dy) / R);
      const dl = Math.hypot(dx, dy) || 1;
      this.joyMag = m < 0.12 ? 0 : m;
      this.move.x = dx / dl * this.joyMag; this.move.z = dy / dl * this.joyMag;
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.joyBase.classList.toggle('sprint', m > 0.93);
    });
    const joyEnd = e => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.move.x = this.move.z = 0; this.joyMag = 0;
      this.joyBase.classList.remove('active', 'sprint');
      this.joyKnob.style.transform = 'translate(-50%,-50%)';
    };
    addEventListener('pointerup', joyEnd);
    addEventListener('pointercancel', joyEnd);

    // ---- Action buttons
    for (const s of ['a', 'b', 'c', 'd']) {
      const el = this.$('cb_' + s);
      el.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (this.editing) return;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('pressed'); this.held[s] = true; this.edges[s + 'Down'] = true; this.buzz(8);
      });
      const end = () => {
        if (!this.held[s]) return;
        el.classList.remove('pressed'); this.held[s] = false;
        if (s === 'a') this.edges.aUp = true;
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('lostpointercapture', end);
    }

    // ---- Right stick: flick = dribble/post move, double tap = spin, hold = post up / def assist
    const st = this.$('rstick'), knob = this.$('rsKnob'), trail = this.$('swipeTrail');
    const SR = 44;
    let sp = null, lastTap = 0;
    st.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this.editing) return;
      st.setPointerCapture?.(e.pointerId);
      const r = st.getBoundingClientRect();
      sp = { id: e.pointerId, ox: r.left + r.width / 2, oy: r.top + r.height / 2, x: e.clientX, y: e.clientY, t: performance.now(), fired: false, held: false };
      this.stick.held = true;
      st.classList.add('pressed');
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        if (sp && !sp.fired && Math.hypot(sp.lx - sp.x || 0, sp.ly - sp.y || 0) < 14 && (this.mode === 'ball' || this.mode === 'post')) {
          sp.held = true; this.edges.postToggle = true; this.buzz(20);
        }
      }, this.mode === 'post' ? 650 : 380);
    });
    st.addEventListener('pointermove', e => {
      if (!sp || e.pointerId !== sp.id) return;
      sp.lx = e.clientX; sp.ly = e.clientY;
      let dx = e.clientX - sp.ox, dy = e.clientY - sp.oy;
      const d = Math.hypot(dx, dy);
      if (d > SR) { dx = dx / d * SR; dy = dy / d * SR; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.stick.intense = this.mode === 'defense' && d > SR * 0.75;
      st.classList.toggle('intense', this.stick.intense);
      const mx = e.clientX - sp.x, my = e.clientY - sp.y;
      if (!sp.fired && !sp.held && Math.hypot(mx, my) > 26) {
        const target = this.flickTarget(sp.ox, sp.oy, mx, my);
        const fast = performance.now() - sp.t < 320;
        if (this.mode === 'defense') {
          // Flick toward BLOCK or STEAL to do it
          if (fast && target) { sp.fired = true; this.edges[target + 'Down'] = true; this.showTrail(trail, e.clientX, e.clientY, mx, my); this.buzz(12); }
        } else if (this.mode === 'post' && target === 'a') {
          // Flick toward SHOOT from the post: holds the shot until you let go of the stick
          sp.fired = true; sp.shooting = true; this.held.a = true; this.edges.aDown = true; this.buzz(12);
        } else if (this.mode === 'ball' || this.mode === 'post') {
          sp.fired = true;
          // Keep holding the stick after the flick = holding SHOOT (euro steps / floaters fill the meter
          // while you hold, let go to release)
          sp.shooting = true; this.held.a = true;
          this.gesture = { type: 'swipe', x: mx, z: my };
          this.showTrail(trail, e.clientX, e.clientY, mx, my);
          this.buzz(12);
        }
      }
      if (sp.fired && this.mode === 'defense') { this.stick.intense = false; st.classList.remove('intense'); }
    });
    const stEnd = e => {
      if (!sp || e.pointerId !== sp.id) return;
      clearTimeout(this.holdTimer);
      if (sp.shooting) { this.held.a = false; this.edges.aUp = true; }
      const now = performance.now();
      if (!sp.fired && !sp.held && now - sp.t < 250 && (this.mode === 'ball' || this.mode === 'post')) {
        if (now - lastTap < 330) { this.gesture = { type: 'double', x: 0, z: 0 }; lastTap = 0; this.buzz(15); }
        else lastTap = now;
      }
      sp = null;
      this.stick.held = false; this.stick.intense = false;
      st.classList.remove('pressed', 'intense');
      knob.style.transform = 'translate(-50%,-50%)';
    };
    st.addEventListener('pointerup', stEnd);
    st.addEventListener('pointercancel', stEnd);

    // ---- Layout editing: drag buttons around (capture phase so game handlers never see it)
    let drag = null;
    this.root.addEventListener('pointerdown', e => {
      if (!this.editing) return;
      const el = e.target.closest && e.target.closest(MOVABLE.map(id => '#' + id).join(','));
      if (!el) return;
      e.stopPropagation(); e.preventDefault();
      const r = el.getBoundingClientRect();
      drag = { el, id: el.id, pid: e.pointerId, ox: e.clientX - (r.left + r.width / 2), oy: e.clientY - (r.top + r.height / 2) };
      el.classList.add('dragging');
    }, true);
    addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pid) return;
      const el = drag.el, w = el.offsetWidth, h = el.offsetHeight;
      const cx = e.clientX - drag.ox, cy = e.clientY - drag.oy;
      const right = Math.max(0, Math.min(innerWidth - w, innerWidth - cx - w / 2));
      const bottom = Math.max(0, Math.min(innerHeight - h, innerHeight - cy - h / 2));
      el.style.right = right + 'px'; el.style.bottom = bottom + 'px';
      this.layout[drag.id] = { r: Math.round(right), b: Math.round(bottom) };
    });
    const dragEnd = e => { if (drag && e.pointerId === drag.pid) { drag.el.classList.remove('dragging'); drag = null; } };
    addEventListener('pointerup', dragEnd);
    addEventListener('pointercancel', dragEnd);

    // ---- Keyboard (desktop testing)
    const slotKey = { ' ': 'a', j: 'a', k: 'b', l: 'c', o: 'd' };
    addEventListener('keydown', e => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      const s = slotKey[k];
      if (s) { this.held[s] = true; this.edges[s + 'Down'] = true; }
      if (k === 'p') this.edges.postToggle = true;
      if (k === 'q') this.gesture = { type: 'swipe', x: -1, z: 0 };
      if (k === 'e') this.gesture = { type: 'swipe', x: 1, z: 0 };
      if (k === 'r') this.gesture = { type: 'swipe', x: 0, z: -1 };
      if (k === 'f') this.gesture = { type: 'swipe', x: 0, z: 1 };
      if (k === 't') this.gesture = { type: 'double', x: 0, z: 0 };
    });
    addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      this.keys.delete(k);
      const s = slotKey[k];
      if (s && this.held[s]) { this.held[s] = false; if (s === 'a') this.edges.aUp = true; }
    });
  }

  // Which button (a = shoot/block, c = steal) is the stick flicked toward?
  flickTarget(ox, oy, mx, my) {
    let best = null, bestA = this.mode === 'post' ? 0.96 : 0.66; // ~55 degrees in the post, ~38 elsewhere
    const ml = Math.hypot(mx, my) || 1;
    for (const s of ['a', 'c']) {
      const el = this.$('cb_' + s);
      if (el.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      const bx = r.left + r.width / 2 - ox, by = r.top + r.height / 2 - oy, bl = Math.hypot(bx, by) || 1;
      const ang = Math.acos(Math.max(-1, Math.min(1, (mx * bx + my * by) / (ml * bl))));
      if (ang < bestA) { bestA = ang; best = s; }
    }
    return best;
  }

  applyLayout() {
    const L = this.layout || {};
    for (const id of MOVABLE) {
      const el = this.$(id);
      if (L[id]) { el.style.right = L[id].r + 'px'; el.style.bottom = L[id].b + 'px'; }
      else { el.style.right = ''; el.style.bottom = ''; }
    }
    this.root.style.setProperty('--cscale', L.scale || 1);
  }

  saveLayout() { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout)); } catch (e) { /* ignore */ } }

  resetLayout() { this.layout = {}; this.applyLayout(); this.saveLayout(); }

  // Enter button-layout editing. Calls onDone when the player taps DONE.
  edit(onDone) {
    this.reset();
    this.editing = true;
    this.prevMode = this.mode;
    this.mode = null; this.setMode('ball');
    for (const id of MOVABLE) this.$(id).classList.remove('hidden');
    this.root.classList.add('editing');
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.innerHTML = `<span>Drag the buttons to move them</span><button data-a="smaller">SMALLER</button><button data-a="bigger">BIGGER</button><button data-a="reset">RESET</button><button data-a="done" class="done">DONE</button>`;
    this.root.appendChild(bar);
    bar.addEventListener('pointerdown', e => e.stopPropagation(), true);
    bar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'smaller' || a === 'bigger') {
        const sc = Math.max(0.7, Math.min(1.4, (this.layout.scale || 1) + (a === 'bigger' ? 0.1 : -0.1)));
        this.layout.scale = Math.round(sc * 10) / 10;
        this.applyLayout();
      } else if (a === 'reset') {
        this.layout = {}; this.applyLayout();
      } else {
        this.saveLayout();
        bar.remove();
        this.root.classList.remove('editing');
        this.editing = false;
        const m = this.prevMode; this.mode = null; this.setMode(m || 'ball');
        onDone && onDone();
      }
    }));
  }

  showTrail(el, x, y, dx, dy) {
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  // Returns the input for this frame in world space, already mapped to what each button means right now.
  poll(worldMap) {
    const k = this.keys;
    let mx = this.move.x, mz = this.move.z, mag = this.joyMag;
    const kx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const kz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (kx || kz) { const l = Math.hypot(kx, kz); mx = kx / l; mz = kz / l; mag = k.has('shift') ? 1 : 0.9; }
    const map = worldMap || ((x, z) => ({ x, z }));
    let g = this.gesture;
    if (g) g = { ...g, ...map(g.x, g.z) };
    const E = this.edges, H = this.held, m = this.mode;
    const input = {
      move: map(mx, mz), sprint: mag > 0.93 || k.has('shift'), gesture: null,
      shootHeld: false, shootPressed: false, shootReleased: false, passPressed: false, postPressed: false,
      lobPressed: false, pickPressed: false, callScreenPressed: false, setScreenPressed: false,
      boxOut: false, defAssist: false, intense: false,
    };
    if (m === 'ball' || m === 'post' || m === 'ft') {
      input.shootHeld = H.a; input.shootPressed = E.aDown; input.shootReleased = E.aUp;
      input.passPressed = E.bDown; input.lobPressed = E.cDown; input.pickPressed = E.dDown;
      input.postPressed = E.postToggle; input.gesture = g;
    } else if (m === 'offBall') {
      input.shootPressed = E.aDown; input.passPressed = E.bDown;
      input.callScreenPressed = E.cDown; input.setScreenPressed = E.dDown;
    } else if (m === 'defense') {
      input.shootPressed = E.aDown; input.boxOut = H.b; input.passPressed = E.cDown;
      input.defAssist = this.stick.held || k.has('z'); input.intense = this.stick.intense || k.has('x');
    }
    for (const key in E) E[key] = false;
    this.gesture = null;
    return input;
  }

  reset() {
    this.move.x = this.move.z = 0; this.joyMag = 0;
    for (const s in this.held) this.held[s] = false;
    for (const key in this.edges) this.edges[key] = false;
    this.gesture = null; this.stick.held = false; this.stick.intense = false;
  }
}
