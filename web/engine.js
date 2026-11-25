/* engine.js — the game runtime shared by the editor's Play tab and the exported Android player.
 *
 * Every game object has a Lua script (generated from its blocks, or typed by hand).
 * The script defines optional handler functions:
 *   start()  update(dt)  tapped()  touching(other)  pressed(button)  message(name)  screen_tapped(x, y)
 * and can use the API below (move, jump, say, play, spawn, ...). `me` is the object itself.
 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const Lua = isNode ? require('./lua.js') : root.Lua;
  const CKL = isNode ? require('./blocks.js') : root.CKL;
  const { LuaTable, Interp, toNumber, truthy } = Lua;

  const STEP = 1 / 60;
  const BUDGET = 400000;          // max Lua statements per handler call (stops endless loops)
  const MAX_FALL = 18;
  const BTN_NAMES = { left: 'Left', right: 'Right', up: 'Up', down: 'Down', a: 'A', b: 'B' };

  const numOf = (t, k) => { const v = t.hash.get(k); return typeof v === 'number' ? v : (toNumber(v) || 0); };
  const boxOf = (t) => ({ x: numOf(t, 'x'), y: numOf(t, 'y'), w: numOf(t, 'w'), h: numOf(t, 'h') });
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const toN = (v, d) => { const x = toNumber(v); return x === undefined ? (d || 0) : x; };

  function scriptSource(def) {
    const s = def.script || {};
    return s.mode === 'lua' ? (s.lua || '') : CKL.generate(s.blocks || []);
  }

  /** Compile every script without running it. Returns [{id, name, message}] for scripts with mistakes. */
  function checkProject(project) {
    const I = new Interp();
    const problems = [];
    for (const def of project.objects || []) {
      try { I.compile(scriptSource(def), def.name); }
      catch (e) { problems.push({ id: def.id, name: def.name, message: friendly(def, e.message) }); }
    }
    return problems;
  }
  // For block scripts the generated Lua line numbers mean nothing to the user, so hide them.
  function friendly(def, msg) {
    if (def && def.script && def.script.mode !== 'lua') return String(msg).replace(/^[^:]*:\d+:\s*/, '');
    return String(msg);
  }

  // ------------------------------------------------------------------ sound (tiny synth, no files needed)
  class Sound {
    constructor() { this.ctx = null; }
    ensure() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) { /* ignore */ } }
      return this.ctx;
    }
    tone(f0, f1, dur, type, vol, delay) {
      const c = this.ensure();
      if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(vol || 0.07, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    }
    play(name) {
      switch (name) {
        case 'jump': this.tone(260, 620, 0.16, 'square'); break;
        case 'coin': this.tone(988, 988, 0.07, 'square'); this.tone(1319, 1319, 0.16, 'square', 0.07, 0.07); break;
        case 'hit': this.tone(220, 55, 0.25, 'sawtooth', 0.09); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.14, 'triangle', 0.09, i * 0.11)); break;
        case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.09, i * 0.15)); break;
        default: this.tone(660, 660, 0.1, 'sine', 0.09);
      }
    }
  }

  // ------------------------------------------------------------------ drawing (shared with the editor)
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  /** Draws one object. `o` is a plain object: x,y,w,h,angle,flip,shape,emoji,color,text. */
  function drawObject(ctx, o, alpha) {
    const w = +o.w || 0, h = +o.h || 0;
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.translate((+o.x || 0) + w / 2, (+o.y || 0) + h / 2);
    if (o.angle) ctx.rotate(o.angle * Math.PI / 180);
    const shape = o.shape || 'emoji';
    if (shape === 'emoji') {
      const size = Math.max(4, Math.min(w, h) * 0.9);
      ctx.save();
      if (o.flip) ctx.scale(-1, 1);
      ctx.font = size + 'px ' + EMOJI_FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(o.emoji || '❓', 0, size * 0.06);
      ctx.restore();
    } else if (shape === 'rect') {
      ctx.fillStyle = o.color || '#888';
      roundRectPath(ctx, -w / 2, -h / 2, w, h, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (shape === 'circle') {
      ctx.fillStyle = o.color || '#888';
      ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    const text = o.text == null ? '' : String(o.text);
    if (text !== '') {
      if (shape === 'text') {
        ctx.font = 'bold ' + Math.max(8, h * 0.75) + 'px sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillStyle = o.color || '#222';
        ctx.fillText(text, -w / 2, 0);
      } else {
        ctx.font = 'bold ' + Math.max(9, Math.min(h * 0.5, 18)) + 'px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(text, 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillText(text, 0, 0);
      }
    }
    ctx.restore();
  }

  function drawBubble(ctx, o, text) {
    ctx.save();
    ctx.font = 'bold 14px sans-serif';
    const pad = 8, tw = ctx.measureText(text).width, bw = tw + pad * 2, bh = 26;
    const bx = o.x + o.w / 2 - bw / 2, by = o.y - bh - 10;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    roundRectPath(ctx, bx, by, bw, bh, 9); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.x + o.w / 2 - 5, by + bh); ctx.lineTo(o.x + o.w / 2, by + bh + 8); ctx.lineTo(o.x + o.w / 2 + 5, by + bh);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  }

  function wrapText(ctx, text, maxW) {
    const words = String(text).split(/\s+/); const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ------------------------------------------------------------------ the game
  class Game {
    constructor(canvas, project, opts) {
      this.opts = opts || {};
      this.canvas = canvas || null;
      this.ctx = canvas ? canvas.getContext('2d') : null;
      this.project = JSON.parse(JSON.stringify(project));
      const st = this.project.settings = this.project.settings || {};
      const portrait = st.orientation === 'portrait';
      this.W = portrait ? 360 : 640;
      this.H = portrait ? 640 : 360;
      this.worldW = Math.max(+st.worldWidth || this.W, this.W);
      this.worldH = Math.max(+st.worldHeight || this.H, this.H);
      this.interp = new Interp();
      this.interp.onPrint = (s) => this.log(s);
      this.G = this.interp.globals;
      this.envMeta = new LuaTable();
      this.envMeta.set('__index', this.G);
      this.sound = new Sound();
      this.down = {};
      this.pressQueue = [];
      this.tapQueue = [];
      this.saveMem = {};
      this.scale = 1;
      this.raf = 0;
      this.installSharedApi();
      this.reset();
    }

    log(s) { if (this.opts.onLog) this.opts.onLog(String(s)); }

    // ---------------------------------------------------------- setup
    reset() {
      const st = this.project.settings;
      this.state = 'playing';
      this.error = null;
      this.time = 0; this.acc = 0;
      this.objects = []; this.pending = []; this.msgs = [];
      this.camTarget = null; this.camX = 0; this.camY = 0;
      this.wantRestart = false;
      this.gravity = st.gravity === undefined ? 0.6 : +st.gravity;
      this.background = st.background || '#87ceeb';
      this.down = {}; this.pressQueue = []; this.tapQueue = [];

      const vars = new LuaTable();
      const vmt = new LuaTable();
      vmt.set('__index', () => [0]);
      vars.meta = vmt;
      for (const v of this.project.variables || []) vars.set(v, 0);
      this.G.set('vars', vars);
      const screen = new LuaTable(); screen.set('width', this.W); screen.set('height', this.H);
      this.G.set('screen', screen);
      this.tapT = new LuaTable(); this.tapT.set('x', 0); this.tapT.set('y', 0);
      this.G.set('tap', this.tapT);

      this.programs = {};
      for (const def of this.project.objects || []) {
        try { this.programs[def.id] = this.interp.compile(scriptSource(def), def.name); }
        catch (e) { this.fail(def, e); return; }
      }
      for (const def of this.project.objects || []) this.objects.push(this.makeInstance(def));
      for (const inst of this.objects.slice()) this.runProgram(inst);
      for (const inst of this.objects.slice()) this.call(inst, 'start');
      this.endAt = 0;
    }

    makeInstance(def) {
      const t = new LuaTable();
      const set = (k, v) => t.set(k, v);
      set('name', def.name); set('x', +def.x || 0); set('y', +def.y || 0);
      set('w', +def.w || 32); set('h', +def.h || 32);
      set('vx', 0); set('vy', 0); set('angle', 0); set('flip', false);
      set('visible', def.visible !== false);
      set('solid', !!def.solid); set('gravity', !!def.gravity); set('collide', !!def.collide);
      set('fixed', !!def.fixed);
      set('shape', def.shape || 'emoji'); set('emoji', def.emoji || '❓');
      set('color', def.color || '#888888'); set('text', def.text || '');
      set('on_ground', false); set('hitx', false); set('hity', false);
      const inst = { def, t, alive: true, timers: [], bubble: null, baseW: +def.w || 32, baseH: +def.h || 32, env: new LuaTable() };
      inst.env.meta = this.envMeta;
      inst.env.set('me', t);
      const api = this.objectApi(inst);
      for (const k of Object.keys(api)) inst.env.set(k, api[k]);
      return inst;
    }

    runProgram(inst) {
      const ast = this.programs[inst.def.id];
      if (!ast) return;
      this.interp.resetBudget(BUDGET);
      try { this.interp.runChunk(ast, inst.env); } catch (e) { this.fail(inst.def, e); }
    }

    call(inst, name, args) {
      if (this.state !== 'playing') return;
      const f = inst.env.hash.get(name);
      if (typeof f !== 'function') return;
      this.interp.resetBudget(BUDGET);
      try { this.interp.call(f, args || []); } catch (e) { this.fail(inst.def, e); }
    }
    callFn(inst, f) {
      if (this.state !== 'playing') return;
      this.interp.resetBudget(BUDGET);
      try { this.interp.call(f, []); } catch (e) { this.fail(inst.def, e); }
    }

    fail(def, e) {
      if (this.state === 'error') return;
      const raw = e && e.message ? e.message : String(e);
      this.state = 'error';
      this.error = { id: def.id, name: def.name, message: friendly(def, raw) };
      if (this.opts.onError) this.opts.onError(this.error);
    }

    // ---------------------------------------------------------- API visible to Lua
    installSharedApi() {
      const g = this, G = this.G;
      const reg = (name, fn) => G.set(name, fn);
      reg('random', (a) => {
        if (a.length === 0) return [Math.random()];
        let lo = 1, hi;
        if (a.length === 1) hi = toN(a[0]); else { lo = toN(a[0]); hi = toN(a[1]); }
        lo = Math.floor(lo); hi = Math.floor(hi);
        if (hi < lo) { const t = lo; lo = hi; hi = t; }
        return [Math.floor(Math.random() * (hi - lo + 1)) + lo];
      });
      reg('button', (a) => [!!g.down[BTN_NAMES[String(a[0]).toLowerCase()] || a[0]]]);
      reg('get', (a) => { const o = g.findAll(a[0])[0]; return [o ? o.t : undefined]; });
      reg('count', (a) => [g.findAll(a[0]).length]);
      reg('play', (a) => { g.sound.play(String(a[0])); return []; });
      reg('send', (a) => { g.msgs.push(String(a[0])); return []; });
      reg('restart', () => { g.wantRestart = true; return []; });
      reg('game_over', (a) => { g.endGame('over', a[0], 'Game over'); return []; });
      reg('win', (a) => { g.endGame('won', a[0], 'You win!'); return []; });
      reg('set_gravity', (a) => { g.gravity = toN(a[0]); return []; });
      reg('set_background', (a) => { g.background = String(a[0]); return []; });
      reg('game_time', () => [g.time]);
      reg('log', (a) => { g.log(a.map((v) => Lua.tostr(g.interp, v)).join('\t')); return []; });
      reg('save', (a) => {
        const key = 'ckl:' + (g.project.id || 'game') + ':' + String(a[0]);
        const v = typeof a[1] === 'number' || typeof a[1] === 'string' || typeof a[1] === 'boolean' ? a[1] : null;
        g.saveMem[key] = v;
        try { root.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* no storage */ }
        return [];
      });
      reg('saved', (a) => {
        const key = 'ckl:' + (g.project.id || 'game') + ':' + String(a[0]);
        let v;
        try { const s = root.localStorage.getItem(key); if (s !== null) v = JSON.parse(s); } catch (e) { /* ignore */ }
        if (v === undefined) v = g.saveMem[key];
        return [v === undefined || v === null ? a[1] : v];
      });
      const alias = (p) => ({ width: 'w', height: 'h' }[p] || p);
      reg('prop_of', (a) => {
        const o = g.findAll(a[0])[0];
        if (!o) return [0];
        const v = o.t.get(alias(String(a[1])));
        return [v === undefined ? 0 : v];
      });
      reg('set_prop_of', (a) => { const o = g.findAll(a[0])[0]; if (o) o.t.set(alias(String(a[1])), a[2]); return []; });
      reg('spawn', (a) => {
        const def = (g.project.objects || []).find((d) => d.name === a[0]);
        if (!def) g.interp.rtErr(`spawn: there is no object called '${a[0]}'`);
        if (!g.programs[def.id]) return [];
        const inst = g.makeInstance(def);
        inst.t.set('x', toN(a[1], def.x)); inst.t.set('y', toN(a[2], def.y));
        g.runProgram(inst);
        g.pending.push(inst);
        return [inst.t];
      });
    }

    objectApi(inst) {
      const g = this, t = inst.t;
      return {
        move: (a) => { g.moveInst(inst, toN(a[0]), toN(a[1])); return []; },
        go_to: (a) => { t.set('x', toN(a[0])); t.set('y', toN(a[1])); return []; },
        jump: (a) => { if (truthy(t.get('on_ground'))) { t.set('vy', -toN(a[0])); t.set('on_ground', false); } return []; },
        bounce: (a) => { g.bounce(inst, a[0]); return []; },
        keep_inside: () => {
          const b = boxOf(t);
          t.set('x', clamp(b.x, 0, Math.max(0, g.worldW - b.w)));
          t.set('y', clamp(b.y, 0, Math.max(0, g.worldH - b.h)));
          return [];
        },
        move_toward: (a) => {
          const o = g.nearest(inst, a[0]);
          if (!o) return [];
          const A = boxOf(t), B = boxOf(o.t);
          const dx = (B.x + B.w / 2) - (A.x + A.w / 2), dy = (B.y + B.h / 2) - (A.y + A.h / 2);
          const d = Math.hypot(dx, dy);
          if (d < 0.0001) return [];
          const sp = Math.min(toN(a[1], 1), d);
          g.moveInst(inst, dx / d * sp, dy / d * sp);
          return [];
        },
        say: (a) => { inst.bubble = { text: Lua.tostr(g.interp, a[0]), t: a[1] === undefined ? 2 : toN(a[1], 2) }; return []; },
        set_size: (a) => {
          const p = Math.max(1, toN(a[0], 100)) / 100;
          const b = boxOf(t);
          const w = inst.baseW * p, h = inst.baseH * p;
          t.set('x', b.x + b.w / 2 - w / 2); t.set('y', b.y + b.h / 2 - h / 2);
          t.set('w', w); t.set('h', h);
          return [];
        },
        face: (a) => { t.set('flip', String(a[0]) === 'left'); return []; },
        destroy: () => { inst.alive = false; return []; },
        after: (a) => { inst.timers.push({ t: toN(a[0]), fn: a[1], period: 0 }); return []; },
        every: (a) => { const p = Math.max(0.02, toN(a[0], 1)); inst.timers.push({ t: p, fn: a[1], period: p }); return []; },
        is_touching: (a) => {
          const me = boxOf(t);
          if (!truthy(t.get('visible'))) return [false];
          for (const o of g.objects) {
            if (o === inst || !o.alive || !truthy(o.t.get('visible'))) continue;
            if (a[0] !== undefined && a[0] !== null && o.t.get('name') !== a[0]) continue;
            if (overlap(me, boxOf(o.t))) return [true];
          }
          return [false];
        },
        distance_to: (a) => {
          const o = g.nearest(inst, a[0]);
          if (!o) return [99999];
          const A = boxOf(t), B = boxOf(o.t);
          return [Math.hypot((A.x + A.w / 2) - (B.x + B.w / 2), (A.y + A.h / 2) - (B.y + B.h / 2))];
        },
        camera_follow: () => { g.camTarget = inst; return []; },
      };
    }

    findAll(name) { return this.objects.filter((o) => o.alive && o.t.get('name') === name); }
    nearest(inst, name) {
      const A = boxOf(inst.t);
      let best = null, bd = Infinity;
      for (const o of this.findAll(name)) {
        if (o === inst) continue;
        const B = boxOf(o.t);
        const d = Math.hypot((A.x + A.w / 2) - (B.x + B.w / 2), (A.y + A.h / 2) - (B.y + B.h / 2));
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    }

    endGame(state, text, fallback) {
      if (this.state !== 'playing') return;
      this.state = state;
      this.endText = text === undefined || text === null ? fallback : Lua.tostr(this.interp, text);
      this.endAt = Date.now();
    }

    // ---------------------------------------------------------- movement & collisions
    moveInst(inst, dx, dy) {
      const t = inst.t;
      const collide = truthy(t.get('collide'));
      if (dx !== 0) { t.set('x', numOf(t, 'x') + dx); if (collide) this.resolve(inst, 'x', dx); }
      if (dy !== 0) { t.set('y', numOf(t, 'y') + dy); if (collide) this.resolve(inst, 'y', dy); }
    }
    resolve(inst, axis, d) {
      const t = inst.t;
      for (const o of this.objects) {
        if (o === inst || !o.alive || !truthy(o.t.get('solid')) || !truthy(o.t.get('visible'))) continue;
        const me = boxOf(t), ob = boxOf(o.t);
        if (!overlap(me, ob)) continue;
        if (axis === 'x') {
          t.set('x', d > 0 ? ob.x - me.w : ob.x + ob.w);
          t.set('hitx', true);
        } else {
          if (d > 0) { t.set('y', ob.y - me.h); t.set('on_ground', true); t.set('vy', 0); }
          else { t.set('y', ob.y + ob.h); if (numOf(t, 'vy') < 0) t.set('vy', 0); }
          t.set('hity', true);
        }
      }
    }
    bounce(inst, mode) {
      const t = inst.t;
      mode = mode === undefined ? 'sides' : String(mode);
      const b = boxOf(t);
      let vx = numOf(t, 'vx'), vy = numOf(t, 'vy');
      if (mode === 'sides' || mode === 'all') {
        if ((b.x <= 0 && vx < 0) || (b.x + b.w >= this.worldW && vx > 0) || (truthy(t.get('hitx')) && vx !== 0)) { vx = -vx; t.set('vx', vx); t.set('flip', vx < 0); }
      }
      if (mode === 'top' || mode === 'all') {
        if ((b.y <= 0 && vy < 0) || (b.y + b.h >= this.worldH && vy > 0) || (truthy(t.get('hity')) && vy !== 0)) { vy = -vy; t.set('vy', vy); }
      }
    }

    // ---------------------------------------------------------- one simulation step
    step(dt) {
      if (this.state !== 'playing') return;
      this.time += dt;

      if (this.pressQueue.length) {
        const q = this.pressQueue.splice(0);
        for (const b of q) for (const inst of this.objects.slice()) if (inst.alive) this.call(inst, 'pressed', [b]);
      }
      if (this.tapQueue.length) {
        const q = this.tapQueue.splice(0);
        for (const tp of q) this.handleTap(tp);
      }
      for (const inst of this.objects.slice()) if (inst.alive) this.call(inst, 'update', [dt]);

      for (const inst of this.objects.slice()) {
        if (!inst.alive || inst.timers.length === 0) continue;
        for (const tm of inst.timers.slice()) {
          if (this.state !== 'playing' || !inst.alive) break;
          tm.t -= dt;
          if (tm.t <= 0) {
            if (tm.period > 0) tm.t += tm.period; else inst.timers.splice(inst.timers.indexOf(tm), 1);
            this.callFn(inst, tm.fn);
          }
        }
      }
      this.physics();
      this.touching();

      if (this.msgs.length && this.state === 'playing') {
        const batch = this.msgs; this.msgs = [];
        for (const m of batch) for (const inst of this.objects.slice()) if (inst.alive) this.call(inst, 'message', [m]);
      }
      this.flush();

      for (const inst of this.objects) if (inst.bubble && (inst.bubble.t -= dt) <= 0) inst.bubble = null;
      this.updateCamera();
      if (this.wantRestart) this.reset();
    }

    physics() {
      for (const inst of this.objects) {
        if (!inst.alive) continue;
        const t = inst.t;
        t.set('hitx', false); t.set('hity', false);
        let vx = numOf(t, 'vx'), vy = numOf(t, 'vy');
        if (truthy(t.get('gravity'))) {
          vy = Math.min(vy + this.gravity, MAX_FALL);
          t.set('vy', vy); t.set('on_ground', false);
        }
        if (vx !== 0 || vy !== 0) this.moveInst(inst, vx, vy);
      }
    }

    touching() {
      for (const inst of this.objects.slice()) {
        if (this.state !== 'playing') return;
        if (!inst.alive || typeof inst.env.hash.get('touching') !== 'function' || !truthy(inst.t.get('visible'))) continue;
        for (const o of this.objects.slice()) {
          if (this.state !== 'playing' || !inst.alive) break;
          if (o === inst || !o.alive || !truthy(o.t.get('visible'))) continue;
          if (overlap(boxOf(inst.t), boxOf(o.t))) this.call(inst, 'touching', [o.t]);
        }
      }
    }

    flush() {
      if (this.pending.length) {
        const fresh = this.pending; this.pending = [];
        for (const p of fresh) this.objects.push(p);
        for (const p of fresh) this.call(p, 'start');
      }
      if (this.objects.some((o) => !o.alive)) {
        this.objects = this.objects.filter((o) => o.alive);
        if (this.camTarget && !this.camTarget.alive) this.camTarget = null;
      }
    }

    updateCamera() {
      if (!this.camTarget) return;
      const b = boxOf(this.camTarget.t);
      this.camX = clamp(b.x + b.w / 2 - this.W / 2, 0, Math.max(0, this.worldW - this.W));
      this.camY = clamp(b.y + b.h / 2 - this.H / 2, 0, Math.max(0, this.worldH - this.H));
    }

    // ---------------------------------------------------------- input
    press(name) {
      name = BTN_NAMES[String(name).toLowerCase()] || name;
      if (!this.down[name]) { this.down[name] = true; if (this.state === 'playing') this.pressQueue.push(name); }
    }
    release(name) { name = BTN_NAMES[String(name).toLowerCase()] || name; this.down[name] = false; }

    /** sx, sy are in screen units (0..W, 0..H). */
    tapAt(sx, sy) {
      if (this.state !== 'playing') {
        if (Date.now() - this.endAt > 600 || this.state === 'error') { this.reset(); }
        return;
      }
      this.tapQueue.push({ sx, sy, x: sx + this.camX, y: sy + this.camY });
    }
    handleTap(tp) {
      this.tapT.set('x', tp.x); this.tapT.set('y', tp.y);
      for (let i = this.objects.length - 1; i >= 0; i--) {
        const o = this.objects[i];
        if (!o.alive || !truthy(o.t.get('visible'))) continue;
        const fixed = truthy(o.t.get('fixed'));
        const px = fixed ? tp.sx : tp.x, py = fixed ? tp.sy : tp.y;
        const b = boxOf(o.t);
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { this.call(o, 'tapped'); break; }
      }
      for (const inst of this.objects.slice()) if (inst.alive) this.call(inst, 'screen_tapped', [tp.x, tp.y]);
    }

    // ---------------------------------------------------------- rendering & loop
    snapshot(inst) {
      const h = inst.t.hash;
      return {
        x: numOf(inst.t, 'x'), y: numOf(inst.t, 'y'), w: numOf(inst.t, 'w'), h: numOf(inst.t, 'h'),
        angle: numOf(inst.t, 'angle'), flip: truthy(h.get('flip')), visible: truthy(h.get('visible')), fixed: truthy(h.get('fixed')),
        shape: h.get('shape'), emoji: h.get('emoji'), color: h.get('color'), text: h.get('text'),
      };
    }

    resize() {
      if (!this.canvas) return;
      const host = this.canvas.parentElement;
      const r = host ? host.getBoundingClientRect() : { width: this.W, height: this.H };
      const fit = Math.max(0.1, Math.min(r.width / this.W, r.height / this.H));
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.canvas.style.width = Math.floor(this.W * fit) + 'px';
      this.canvas.style.height = Math.floor(this.H * fit) + 'px';
      this.canvas.width = Math.round(this.W * fit * dpr);
      this.canvas.height = Math.round(this.H * fit * dpr);
      this.scale = fit * dpr;
    }

    draw() {
      const ctx = this.ctx;
      if (!ctx) return;
      const s = this.scale;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.W, this.H);
      const items = this.objects.filter((o) => o.alive).map((o) => ({ inst: o, s: this.snapshot(o) })).filter((it) => it.s.visible);
      ctx.save();
      ctx.translate(-this.camX, -this.camY);
      for (const it of items) if (!it.s.fixed) drawObject(ctx, it.s);
      for (const it of items) if (!it.s.fixed && it.inst.bubble) drawBubble(ctx, it.s, it.inst.bubble.text);
      ctx.restore();
      for (const it of items) if (it.s.fixed) drawObject(ctx, it.s);
      if (this.state !== 'playing') this.drawOverlay(ctx);
    }

    drawOverlay(ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const cx = this.W / 2, cy = this.H / 2;
      if (this.state === 'error') {
        ctx.fillStyle = '#ff8a80'; ctx.font = 'bold 22px sans-serif';
        ctx.fillText('Oops! A script has a problem', cx, cy - 70);
        ctx.fillStyle = '#fff'; ctx.font = '15px sans-serif';
        const lines = wrapText(ctx, `${this.error.name}: ${this.error.message}`, this.W - 40).slice(0, 6);
        lines.forEach((l, i) => ctx.fillText(l, cx, cy - 30 + i * 20));
        ctx.fillStyle = '#ccc'; ctx.font = '14px sans-serif';
        ctx.fillText('Tap to try again', cx, cy + 110);
        return;
      }
      ctx.fillStyle = this.state === 'won' ? '#ffd54f' : '#ff8a80';
      ctx.font = 'bold 34px sans-serif';
      const lines = wrapText(ctx, this.endText || '', this.W - 40).slice(0, 3);
      lines.forEach((l, i) => ctx.fillText(l, cx, cy - 20 + i * 40));
      ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif';
      ctx.fillText('Tap to play again', cx, cy + 20 + lines.length * 40);
    }

    start() {
      if (this.raf || !this.canvas) return;
      this.resize();
      this.attachInput();
      this.last = performance.now();
      const frame = (now) => {
        this.raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.acc += dt;
        let n = 0;
        while (this.acc >= STEP && n < 5) { this.step(STEP); this.acc -= STEP; n++; }
        if (n === 5) this.acc = 0;
        this.draw();
      };
      this.raf = requestAnimationFrame(frame);
    }
    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.detachInput();
    }

    attachInput() {
      if (this._in || typeof window === 'undefined') return;
      const keyMap = { ArrowLeft: 'Left', a: 'Left', A: 'Left', ArrowRight: 'Right', d: 'Right', D: 'Right', ArrowUp: 'Up', w: 'Up', W: 'Up', ArrowDown: 'Down', s: 'Down', S: 'Down', ' ': 'A', z: 'A', Z: 'A', x: 'B', X: 'B' };
      const typing = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const kd = (e) => { const b = keyMap[e.key]; if (b && !typing(e)) { e.preventDefault(); this.press(b); } };
      const ku = (e) => { const b = keyMap[e.key]; if (b && !typing(e)) this.release(b); };
      const pd = (e) => {
        const r = this.canvas.getBoundingClientRect();
        this.tapAt((e.clientX - r.left) * this.W / r.width, (e.clientY - r.top) * this.H / r.height);
      };
      const rs = () => this.resize();
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
      window.addEventListener('resize', rs);
      this.canvas.addEventListener('pointerdown', pd);
      this._in = { kd, ku, pd, rs };
    }
    detachInput() {
      if (!this._in) return;
      window.removeEventListener('keydown', this._in.kd); window.removeEventListener('keyup', this._in.ku);
      window.removeEventListener('resize', this._in.rs);
      this.canvas.removeEventListener('pointerdown', this._in.pd);
      this._in = null;
    }
  }

  /** On-screen buttons (touch). Returns { destroy() }. */
  function mountControls(container, game) {
    const mode = (game.project.settings || {}).controls || 'lr';
    const layer = document.createElement('div');
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;';
    container.appendChild(layer);
    if (mode === 'none') return { destroy() { layer.remove(); } };
    const mk = (label, name, size, css) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = `position:absolute;width:${size}px;height:${size}px;border-radius:${size / 2}px;background:rgba(20,20,30,.45);` +
        `border:2px solid rgba(255,255,255,.55);color:#fff;font:bold ${size * 0.4}px sans-serif;display:flex;align-items:center;` +
        `justify-content:center;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;${css}`;
      const down = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } b.style.background = 'rgba(255,255,255,.55)'; game.press(name); };
      const up = (e) => { e.preventDefault(); b.style.background = 'rgba(20,20,30,.45)'; game.release(name); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      layer.appendChild(b);
    };
    if (mode === 'dpad') {
      const s = 50;
      mk('▲', 'Up', s, `left:${12 + s}px;bottom:${12 + s * 2}px;`);
      mk('◀', 'Left', s, `left:12px;bottom:${12 + s}px;`);
      mk('▶', 'Right', s, `left:${12 + s * 2}px;bottom:${12 + s}px;`);
      mk('▼', 'Down', s, `left:${12 + s}px;bottom:12px;`);
    } else {
      mk('◀', 'Left', 62, 'left:12px;bottom:14px;');
      mk('▶', 'Right', 62, 'left:84px;bottom:14px;');
    }
    mk('A', 'A', 66, 'right:12px;bottom:14px;');
    mk('B', 'B', 52, 'right:90px;bottom:26px;');
    return { destroy() { layer.remove(); } };
  }

  const api = { Game, Sound, drawObject, drawBubble, mountControls, checkProject, scriptSource, boxOf, overlap, STEP };
  root.Engine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
