/* editor.js — the Block Game Maker app UI (home, scene, code, play, game settings). */
(function () {
  'use strict';
  const CKL = window.CKL, Engine = window.Engine, Templates = window.Templates, Lua = window.Lua;
  const Native = window.Android || null;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ------------------------------------------------------------------ tiny DOM helper
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    let after = null;
    for (const k in props || {}) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') after = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    if (after !== null) el.value = after;
    return el;
  }

  // ------------------------------------------------------------------ storage
  const Store = Native ? {
    list() { try { return JSON.parse(Native.listProjects()); } catch (e) { return []; } },
    load(id) { try { return JSON.parse(Native.loadProject(id)); } catch (e) { return null; } },
    save(p) { Native.saveProject(p.id, JSON.stringify(p)); },
    del(id) { Native.deleteProject(id); },
  } : {
    list() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('ckl-project:')) { const p = JSON.parse(localStorage.getItem(k)); out.push({ id: p.id, name: p.name, updated: p.updated, objects: (p.objects || []).length }); }
        }
      } catch (e) { /* ignore */ }
      return out;
    },
    load(id) { try { return JSON.parse(localStorage.getItem('ckl-project:' + id)); } catch (e) { return null; } },
    save(p) { try { localStorage.setItem('ckl-project:' + p.id, JSON.stringify(p)); } catch (e) { toast('Could not save (storage is full or blocked)'); } },
    del(id) { try { localStorage.removeItem('ckl-project:' + id); } catch (e) { /* ignore */ } },
  };

  // ------------------------------------------------------------------ state
  let P = null;               // current project
  let tab = 'scene';
  let selId = null;           // selected object id (scene)
  let codeId = null;          // object being edited in Code tab
  let game = null, controls = null;
  const Scene = { z: null, pan: false, drag: null };

  const ctxNames = () => ({ objects: uniqueNames(), variables: P ? P.variables : [] });
  const uniqueNames = () => Array.from(new Set(P.objects.map((o) => o.name)));
  const objById = (id) => P && P.objects.find((o) => o.id === id);

  function normalize(p) {
    p.format = 'ckl'; p.version = 1;
    p.id = p.id || Templates.uid('p');
    p.name = String(p.name || 'My game').slice(0, 40);
    p.settings = Object.assign({ orientation: 'landscape', worldWidth: 640, worldHeight: 360, gravity: 0.6, background: '#87ceeb', controls: 'lr' }, p.settings || {});
    p.variables = Array.isArray(p.variables) ? p.variables.map(String) : [];
    p.objects = Array.isArray(p.objects) ? p.objects : [];
    for (const o of p.objects) {
      o.id = o.id || Templates.uid('o');
      Object.assign(o, Object.assign({ name: 'Thing', x: 0, y: 0, w: 32, h: 32, shape: 'emoji', emoji: '😀', color: '#888888', text: '', solid: false, gravity: false, collide: false, fixed: false, visible: true }, o));
      o.script = o.script && typeof o.script === 'object' ? o.script : {};
      o.script.mode = o.script.mode === 'lua' ? 'lua' : 'blocks';
      o.script.blocks = Array.isArray(o.script.blocks) ? o.script.blocks : [];
      o.script.lua = typeof o.script.lua === 'string' ? o.script.lua : '';
    }
    return p;
  }

  // ------------------------------------------------------------------ small UI utilities
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  let saveTimer = 0;
  function dirty() {
    if (!P) return;
    $('#saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 350);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!P) return;
    P.updated = Date.now();
    Store.save(P);
    $('#saved').textContent = 'Saved';
  }

  let sheetOnClose = null;
  function openSheet(title, build, onClose) {
    $('#sheetTitle').textContent = title;
    const body = $('#sheetBody'); body.replaceChildren();
    sheetOnClose = onClose || null;
    build(body);
    $('#overlay').classList.remove('hidden');
  }
  function closeSheet() {
    $('#overlay').classList.add('hidden');
    const f = sheetOnClose; sheetOnClose = null;
    if (f) f();
  }
  function ask(title, def, cb, okText) {
    const input = h('input', { type: 'text', value: def || '', style: 'width:100%' });
    const go = () => { const v = input.value.trim(); if (!v) return; closeSheet(); cb(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    openSheet(title, (b) => { b.append(input, h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: go }, okText || 'OK'), h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'))); });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  }
  function confirmBox(title, text, okText, cb) {
    openSheet(title, (b) => { b.append(h('p', {}, text), h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { closeSheet(); cb(); } }, okText), h('button', { class: 'btn', onclick: closeSheet }, 'Cancel'))); });
  }
  const EMOJIS = ('😀 😎 🤖 👾 👻 💀 🐱 🐶 🐭 🐰 🦊 🐻 🐼 🐸 🐵 🐔 🐧 🐢 🐙 🦋 🐝 🐞 🦖 🐉 🧑 👦 👧 🧙 🧛 🥷 🦸 🚀 🚗 🚁 ✈️ ⛵ 🏎️ ' +
    '🪙 💎 ⭐ ✨ 💥 🔥 💧 ❄️ ⚡ 🍎 🍌 🍒 🍉 🍕 🍔 🍪 🎁 🔑 🚪 🏠 🌳 🌵 🌸 🍄 🪨 🧱 🔺 ⚽ 🏀 🎾 🎯 🎈 💣 ⚔️ 🛡️ 🏹 🧺 🚩 🏁 ❤️ 💙 💚 ☁️ 🌙 ☀️ 🌈 ⬜ ⬛ 🟥 🟩 🟦 🟨').split(' ');
  function pickEmoji(cb) {
    openSheet('Pick a picture', (b) => {
      const free = h('input', { type: 'text', placeholder: 'or type / paste any emoji', style: 'width:100%;margin-bottom:8px' });
      free.addEventListener('change', () => { if (free.value.trim()) { closeSheet(); cb(free.value.trim().slice(0, 4)); } });
      b.append(free, h('div', { class: 'emojis' }, EMOJIS.map((e) => h('button', { onclick: () => { closeSheet(); cb(e); } }, e))));
    });
  }

  // ------------------------------------------------------------------ home screen
  function showScreen(id) {
    $('#home').classList.toggle('hidden', id !== 'home');
    $('#editor').classList.toggle('hidden', id !== 'editor');
  }
  function renderHome() {
    stopPlay();
    showScreen('home');
    const st = $('#starters'); st.replaceChildren();
    for (const g of Templates.GAMES) {
      st.append(h('button', { class: 'card', onclick: () => { const p = normalize(Templates.newProject(g.key)); Store.save(p); openProject(p); } },
        h('div', { class: 'em' }, g.emoji), h('b', {}, g.title), h('span', {}, g.desc)));
    }
    const list = Store.list().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const box = $('#projects'); box.replaceChildren();
    if (!list.length) box.append(h('div', { class: 'empty' }, 'No games yet. Pick one above to begin!'));
    for (const it of list) {
      box.append(h('div', { class: 'item' },
        h('div', { class: 'nm', onclick: () => { const p = Store.load(it.id); if (p) openProject(normalize(p)); else toast('Could not open this game'); } },
          h('b', {}, it.name || 'My game'), h('small', {}, (it.updated ? new Date(it.updated).toLocaleString() : ''))),
        h('button', { class: 'icon-btn', title: 'Copy', onclick: () => { const p = Store.load(it.id); if (!p) return; p.id = Templates.uid('p'); p.name = (p.name || 'Game') + ' copy'; Store.save(p); renderHome(); } }, '📋'),
        h('button', { class: 'icon-btn', title: 'Delete', onclick: () => confirmBox('Delete this game?', `"${it.name}" will be removed from this device. Export it first if you want to keep a copy.`, 'Delete', () => { Store.del(it.id); renderHome(); }) }, '🗑️')));
    }
  }

  // ------------------------------------------------------------------ editor shell
  function openProject(p) {
    P = normalize(p);
    selId = P.objects.length ? P.objects[0].id : null;
    codeId = selId;
    Scene.z = null; Scene.pan = false;
    $('#projName').value = P.name;
    $('#saved').textContent = 'Saved';
    showScreen('editor');
    setTab('scene');
  }
  function closeProject() {
    saveNow(); stopPlay(); P = null;
    renderHome();
  }
  function setTab(t) {
    if (tab === 'play' && t !== 'play') stopPlay();
    tab = t;
    $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach((el) => el.classList.toggle('hidden', el.id !== 'tab-' + t));
    if (t === 'scene') renderScene();
    if (t === 'code') renderCode();
    if (t === 'play') startPlay();
    if (t === 'game') renderGame();
  }

  // ------------------------------------------------------------------ SCENE
  function worldSize() { return { w: Math.max(P.settings.worldWidth | 0, screenSize().w), h: Math.max(P.settings.worldHeight | 0, screenSize().h) }; }
  function screenSize() { return P.settings.orientation === 'portrait' ? { w: 360, h: 640 } : { w: 640, h: 360 }; }

  function renderScene() {
    layoutScene(); drawScene(); renderChips(); renderProps();
  }
  function layoutScene() {
    const wrap = $('#sceneWrap'), cv = $('#scene'), W = worldSize();
    if (Scene.z === null) Scene.z = Math.min(1.5, Math.max(0.15, (wrap.clientWidth - 4) / W.w));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = Math.round(W.w * Scene.z) + 'px';
    cv.style.height = Math.round(W.h * Scene.z) + 'px';
    cv.width = Math.round(W.w * Scene.z * dpr);
    cv.height = Math.round(W.h * Scene.z * dpr);
    cv._dpr = dpr;
    cv.classList.toggle('pan', Scene.pan);
    $('#panToggle').textContent = Scene.pan ? '✋ Scroll' : '🎯 Move';
  }
  function drawScene() {
    const cv = $('#scene'), ctx = cv.getContext('2d'), W = worldSize(), z = Scene.z * (cv._dpr || 1);
    ctx.setTransform(z, 0, 0, z, 0, 0);
    ctx.fillStyle = P.settings.background || '#87ceeb';
    ctx.fillRect(0, 0, W.w, W.h);
    ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1 / Scene.z;
    for (let x = 0; x <= W.w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, W.h); ctx.stroke(); }
    for (let y = 0; y <= W.h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W.w, y); ctx.stroke(); }
    const S = screenSize();
    ctx.setLineDash([8 / Scene.z, 6 / Scene.z]); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2 / Scene.z;
    ctx.strokeRect(0, 0, S.w, S.h);
    ctx.setLineDash([]);
    for (const o of P.objects) Engine.drawObject(ctx, o, o.visible === false ? 0.35 : 1);
    const sel = objById(selId);
    if (sel) {
      ctx.setLineDash([6 / Scene.z, 4 / Scene.z]); ctx.strokeStyle = '#3d6bff'; ctx.lineWidth = 2.5 / Scene.z;
      ctx.strokeRect(sel.x - 2, sel.y - 2, sel.w + 4, sel.h + 4);
      ctx.setLineDash([]);
    }
  }
  function hitTest(x, y) {
    for (let i = P.objects.length - 1; i >= 0; i--) {
      const o = P.objects[i];
      if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return o;
    }
    return null;
  }
  function wireScene() {
    const cv = $('#scene');
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / Scene.z, y: (e.clientY - r.top) / Scene.z }; };
    cv.addEventListener('pointerdown', (e) => {
      if (!P) return;
      const p = pos(e), o = hitTest(p.x, p.y);
      if (o) { selId = o.id; codeId = o.id; } else if (Scene.pan) selId = null;
      if (o && !Scene.pan) { Scene.drag = { id: o.id, dx: p.x - o.x, dy: p.y - o.y, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
      else if (!o && !Scene.pan) selId = null;
      drawScene(); renderChips(); renderProps();
    });
    cv.addEventListener('pointermove', (e) => {
      const d = Scene.drag; if (!d) return;
      const o = objById(d.id); if (!o) return;
      const p = pos(e), W = worldSize();
      o.x = Math.max(-o.w / 2, Math.min(W.w - o.w / 2, Math.round(p.x - d.dx)));
      o.y = Math.max(-o.h / 2, Math.min(W.h - o.h / 2, Math.round(p.y - d.dy)));
      d.moved = true; drawScene();
    });
    const end = () => { const d = Scene.drag; Scene.drag = null; if (d && d.moved) { dirty(); renderProps(); } };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    $('#zoomIn').onclick = () => { Scene.z = Math.min(3, Scene.z * 1.25); renderScene(); };
    $('#zoomOut').onclick = () => { Scene.z = Math.max(0.1, Scene.z / 1.25); renderScene(); };
    $('#panToggle').onclick = () => { Scene.pan = !Scene.pan; layoutScene(); drawScene(); };
    $('#addObj').onclick = openAddObject;
  }
  function renderChips() {
    const c = $('#chips'); c.replaceChildren();
    if (!P.objects.length) { c.append(h('div', { class: 'empty' }, 'No objects yet. Tap “＋ Add object”.')); return; }
    for (const o of P.objects) {
      c.append(h('button', { class: 'chip' + (o.id === selId ? ' on' : ''), onclick: () => { selId = o.id; codeId = o.id; renderScene(); } }, (o.shape === 'emoji' ? o.emoji : o.shape === 'text' ? '🔤' : o.shape === 'circle' ? '⚪' : '▭') + ' ' + o.name));
    }
  }
  function openAddObject() {
    openSheet('Add an object', (b) => {
      const list = h('div', { class: 'pal objs' });
      for (const t of Templates.OBJECTS) {
        list.append(h('button', { onclick: () => { closeSheet(); addObject(t.key); } }, h('b', {}, (t.emoji + ' ' + t.title)), h('span', { class: 'hint' }, t.desc)));
      }
      b.append(list);
    });
  }
  function addObject(key) {
    const wrap = $('#sceneWrap'), W = worldSize();
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / Scene.z, cy = (wrap.scrollTop + wrap.clientHeight / 2) / Scene.z;
    const o = Templates.makeObject(key, 0, 0);
    o.x = Math.round(Math.max(0, Math.min(W.w - o.w, cx - o.w / 2)));
    o.y = Math.round(Math.max(0, Math.min(W.h - o.h, cy - o.h / 2)));
    if (o.fixed) { o.x = 10; o.y = 10; }
    P.objects.push(normalize({ objects: [o] }).objects[0]);
    selId = o.id; codeId = o.id;
    for (const needed of needsVars(o)) if (!P.variables.includes(needed)) P.variables.push(needed);
    dirty(); renderScene();
    toast(o.name + ' added');
  }
  function needsVars(o) {
    const out = new Set();
    CKL.walk(o.script.blocks, (b) => { const d = CKL.BY_ID[b.t]; if (!d) return; for (const s of CKL.argSpecs(d)) if (s.t === 'var' && b.a[s.k]) out.add(b.a[s.k]); });
    return out;
  }

  function renderProps() {
    const box = $('#props'); box.replaceChildren();
    const o = objById(selId);
    if (!o) return;
    const upd = (fn, redraw) => (e) => { fn(e.target); dirty(); if (redraw !== false) drawScene(); };
    const numF = (label, key, step) => h('label', { class: 'field' }, label, h('input', { type: 'number', step: step || 'any', value: o[key], onchange: upd((t) => { o[key] = Number(t.value) || 0; if ((key === 'w' || key === 'h') && o[key] < 2) o[key] = 2; }) }));
    const sw = (label, key, hint) => h('label', {}, h('input', { type: 'checkbox', checked: o[key] !== false && !!o[key], onchange: upd((t) => { o[key] = t.checked; }) }), h('span', {}, label, hint ? h('small', {}, ' – ' + hint) : null));
    box.append(h('div', { class: 'panel' },
      h('div', { class: 'fields' },
        h('label', { class: 'field' }, 'Name', h('input', { type: 'text', value: o.name, maxlength: 24, onchange: (e) => renameObject(o, e.target.value) })),
        h('label', { class: 'field' }, 'Looks like',
          h('select', { value: o.shape, onchange: (e) => { o.shape = e.target.value; if (o.shape === 'text' && !o.text) o.text = 'Text'; dirty(); renderScene(); } },
            h('option', { value: 'emoji' }, 'Picture (emoji)'), h('option', { value: 'rect' }, 'Box'), h('option', { value: 'circle' }, 'Circle'), h('option', { value: 'text' }, 'Text only'))),
        o.shape === 'emoji'
          ? h('div', { class: 'field' }, 'Picture', h('button', { class: 'btn sm', onclick: () => pickEmoji((e) => { o.emoji = e; dirty(); renderScene(); }) }, o.emoji + '  change'))
          : h('label', { class: 'field' }, 'Color', h('input', { type: 'color', value: o.color, onchange: upd((t) => { o.color = t.value; }) })),
        h('label', { class: 'field' }, 'Text on it', h('input', { type: 'text', value: o.text, onchange: upd((t) => { o.text = t.value; }) })),
        numF('x (from left)', 'x'), numF('y (from top)', 'y'), numF('Width', 'w'), numF('Height', 'h')),
      h('div', { class: 'switches' },
        sw('Gravity', 'gravity', 'falls down'), sw('Solid', 'solid', 'others cannot pass'), sw('Hits solid things', 'collide', 'stops at walls'),
        sw('Stays on screen', 'fixed', 'for scores & buttons'), sw('Visible at start', 'visible')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', onclick: () => { codeId = o.id; setTab('code'); } }, '🧩 Edit blocks'),
        h('button', { class: 'btn sm', onclick: () => { const i = P.objects.indexOf(o); if (i < P.objects.length - 1) { P.objects.splice(i, 1); P.objects.push(o); dirty(); renderScene(); } }, title: 'Draw in front' }, '⬆ Front'),
        h('button', { class: 'btn sm', onclick: () => { const i = P.objects.indexOf(o); if (i > 0) { P.objects.splice(i, 1); P.objects.unshift(o); dirty(); renderScene(); } }, title: 'Draw behind' }, '⬇ Back'),
        h('button', { class: 'btn sm', onclick: () => { const c = JSON.parse(JSON.stringify(o)); c.id = Templates.uid('o'); c.x += 20; c.y += 20; P.objects.push(c); selId = c.id; dirty(); renderScene(); } }, '📋 Copy'),
        h('button', { class: 'btn sm danger', onclick: () => confirmBox('Delete ' + o.name + '?', 'This object and its blocks will be removed.', 'Delete', () => { P.objects.splice(P.objects.indexOf(o), 1); selId = P.objects.length ? P.objects[0].id : null; codeId = selId; dirty(); renderScene(); }) }, '🗑 Delete'))));
  }
  function renameObject(o, nameRaw) {
    const name = String(nameRaw).trim().slice(0, 24) || o.name;
    const old = o.name;
    if (name === old) return;
    // other objects' blocks refer to objects by name: keep them in sync for every object that shared the old name
    const stillUsed = P.objects.some((x) => x !== o && x.name === old);
    o.name = name;
    if (!stillUsed) {
      for (const x of P.objects) CKL.walk(x.script.blocks, (b) => { const d = CKL.BY_ID[b.t]; if (!d) return; for (const s of CKL.argSpecs(d)) if (s.t === 'obj' && b.a[s.k] === old) b.a[s.k] = name; });
    }
    dirty(); renderChips();
  }

  // ------------------------------------------------------------------ CODE: blocks
  function curObj() { return objById(codeId) || P.objects[0] || null; }
  function renderCode() {
    const sc = $('#tab-code'), top = sc.scrollTop;
    const sel = $('#codeObj'); sel.replaceChildren();
    for (const o of P.objects) sel.append(h('option', { value: o.id }, (o.shape === 'emoji' ? o.emoji : '▭') + ' ' + o.name + (P.objects.filter((x) => x.name === o.name).length > 1 ? ' (' + (P.objects.filter((x) => x.name === o.name).indexOf(o) + 1) + ')' : '')));
    const o = curObj();
    if (o) { codeId = o.id; sel.value = o.id; }
    $('#modeBlocks').classList.toggle('on', !!o && o.script.mode === 'blocks');
    $('#modeLua').classList.toggle('on', !!o && o.script.mode === 'lua');
    const body = $('#codeBody'); body.replaceChildren();
    if (!o) { body.append(h('div', { class: 'empty' }, 'Add an object in the Scene tab first, then come back to give it blocks.')); return; }
    if (o.script.mode === 'lua') renderLua(o, body); else renderBlocks(o, body);
    sc.scrollTop = top;
  }
  function setMode(mode) {
    const o = curObj(); if (!o) return;
    if (mode === 'lua' && !o.script.lua.trim() && o.script.blocks.length) o.script.lua = '-- Made from your blocks. Change it however you like!\n' + CKL.generate(o.script.blocks);
    o.script.mode = mode; dirty(); renderCode();
  }

  function labelNodes(def, b) {
    return def.label.map((p) => (typeof p === 'string' ? h('span', { class: 'w' }, p) : renderArg(b, p)));
  }
  function blockColor(def) { return CKL.CATS.find((c) => c.id === def.cat).color; }

  function renderReporter(b, onRemove) {
    const def = CKL.BY_ID[b.t];
    if (!def) return h('span', { class: 'blk rep' }, '?', h('button', { class: 'mini f', onclick: onRemove }, '✕'));
    return h('span', { class: 'blk rep' + (def.kind === 'bool' ? ' q' : ''), style: '--c:' + blockColor(def) }, labelNodes(def, b), h('button', { class: 'mini f', title: 'Take this block out', onclick: onRemove }, '✕'));
  }

  function renderArg(b, spec) {
    const v = b.a[spec.k];
    const reset = () => { b.a[spec.k] = spec.t === 'bool' ? false : (spec.d === undefined ? '' : spec.d); dirty(); renderCode(); };
    if (CKL.isBlock(v)) return renderReporter(v, reset);
    const set = (val) => { b.a[spec.k] = val; dirty(); };
    const fbtn = () => h('button', { class: 'mini f', title: 'Put another block here', onclick: () => pickValue(spec.t, (nb) => { b.a[spec.k] = nb; dirty(); renderCode(); }) }, 'ƒ');
    switch (spec.t) {
      case 'num': return h('span', { class: 'w' }, h('input', { type: 'number', step: 'any', value: v === undefined ? spec.d : v, oninput: (e) => set(e.target.value === '' ? 0 : Number(e.target.value)) }), ' ', fbtn());
      case 'text': case 'val': return h('span', { class: 'w' }, h('input', { type: 'text', value: v === undefined || v === null ? '' : v, oninput: (e) => set(e.target.value) }), ' ', fbtn());
      case 'bool': return h('button', { class: 'mini ph', title: 'Put a yes/no block here', onclick: () => pickValue('bool', (nb) => { b.a[spec.k] = nb; dirty(); renderCode(); }) }, '◇ yes / no?');
      case 'dd': return h('select', { value: v, onchange: (e) => set(e.target.value) }, spec.opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
      case 'obj': {
        const names = uniqueNames();
        if (v && v !== '*' && !names.includes(v)) names.push(v);
        return h('select', { value: v || (spec.any ? '*' : names[0] || ''), onchange: (e) => set(e.target.value) },
          spec.any ? h('option', { value: '*' }, 'anything') : null,
          names.map((n) => h('option', { value: n }, n)),
          !names.length && !spec.any ? h('option', { value: '' }, '(no objects)') : null);
      }
      case 'var': {
        const vars = P.variables.slice();
        if (v && !vars.includes(v)) vars.push(v);
        return h('select', { value: v || vars[0] || '', onchange: (e) => { if (e.target.value === '__new') { ask('New variable', '', (name) => { addVariable(name); b.a[spec.k] = name; dirty(); renderCode(); }); renderCode(); } else set(e.target.value); } },
          vars.map((n) => h('option', { value: n }, n)), h('option', { value: '__new' }, '＋ New variable…'));
      }
      case 'color': return h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#ff5252', oninput: (e) => set(e.target.value) });
      case 'emoji': return h('button', { class: 'mini ph', style: 'font-size:20px', onclick: () => pickEmoji((e) => { set(e); renderCode(); }) }, v || '😀');
      default: return h('span', {}, String(v));
    }
  }
  function addVariable(name) {
    name = String(name).trim().slice(0, 30);
    if (name && !P.variables.includes(name)) { P.variables.push(name); dirty(); }
    return name;
  }

  function renderBlocks(o, body) {
    const stacks = o.script.blocks;
    if (!stacks.length) body.append(h('div', { class: 'hint' }, 'Every script starts with a yellow event block, like “When game starts”. Tap the button below to add one.'));
    stacks.forEach((st, i) => body.append(renderBlock(st, stacks, i)));
    body.append(h('button', { class: 'add', onclick: () => openPalette('hat', null, (id) => { makeBlock(id, (nb) => { stacks.push(nb); dirty(); renderCode(); }); }) }, '＋ Add event'));
    body.append(h('details', {}, h('summary', {}, 'See the Lua code these blocks make'), h('pre', { style: 'overflow:auto;font-size:12px' }, CKL.generate(stacks) || '-- (nothing yet)')));
  }
  function renderList(list) {
    const box = h('div', {});
    list.forEach((b, i) => box.append(renderBlock(b, list, i)));
    box.append(h('button', { class: 'add', onclick: () => openPalette('stmt', null, (id) => makeBlock(id, (nb) => { list.push(nb); dirty(); renderCode(); })) }, '＋ Add block'));
    return box;
  }
  function renderBlock(b, list, i) {
    const def = CKL.BY_ID[b.t];
    if (!def) return h('div', { class: 'blk' }, 'Unknown block ', h('button', { class: 'mini menu-btn', onclick: () => { list.splice(i, 1); dirty(); renderCode(); } }, '✕'));
    const menu = h('button', { class: 'mini menu-btn', title: 'More', onclick: () => blockMenu(b, list, i) }, '⋮');
    const el = h('div', { class: 'blk ' + def.kind, style: '--c:' + blockColor(def) }, h('div', { class: 'line' }, labelNodes(def, b), menu));
    const bodies = CKL.bodiesOf(def);
    for (const bn of bodies) {
      if (bn === 'else') el.append(h('div', { class: 'elsew' }, def.elseLabel || 'else'));
      b[bn] = Array.isArray(b[bn]) ? b[bn] : [];
      el.append(h('div', { class: 'body' }, renderList(b[bn])));
    }
    return el;
  }
  function blockMenu(b, list, i) {
    const def = CKL.BY_ID[b.t];
    openSheet(def ? def.label.filter((p) => typeof p === 'string')[0] || 'Block' : 'Block', (box) => {
      const act = (t, f) => h('button', { class: 'btn act', onclick: () => { closeSheet(); f(); dirty(); renderCode(); } }, t);
      box.append(
        act('⬆ Move up', () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; } }),
        act('⬇ Move down', () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; } }),
        act('📋 Copy this block', () => { list.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); }),
        act('🗑 Delete', () => { list.splice(i, 1); }));
    });
  }
  function makeBlock(id, done) {
    const def = CKL.BY_ID[id];
    const needsVar = CKL.argSpecs(def).some((s) => s.t === 'var');
    const go = () => done(CKL.newBlock(id, ctxNames()));
    if (needsVar && P.variables.length === 0) ask('Name your first variable', 'score', (n) => { addVariable(n); go(); }); else go();
  }
  function pickValue(slotType, cb) {
    openPalette('value', slotType, (id) => makeBlock(id, cb));
  }

  function previewText(def) {
    return def.label.map((p) => {
      if (typeof p === 'string') return p;
      if (p.t === 'dd') { const o = p.opts.find((x) => (Array.isArray(x) ? x[0] : x) === p.d) || p.opts[0]; return '‹' + (Array.isArray(o) ? o[1] : o) + '›'; }
      if (p.t === 'bool') return '‹yes/no›';
      if (p.t === 'obj') return '‹object›';
      if (p.t === 'var') return '‹variable›';
      if (p.t === 'color') return '‹color›';
      if (p.t === 'emoji') return '‹picture›';
      return '‹' + (p.d === '' ? '…' : p.d) + '›';
    }).join(' ');
  }
  function openPalette(kind, slotType, cb) {
    const kinds = kind === 'hat' ? ['hat'] : kind === 'stmt' ? ['stmt', 'c'] : (slotType === 'bool' ? ['bool', 'val'] : ['val', 'bool']);
    const all = CKL.BLOCKS.filter((d) => kinds.includes(d.kind));
    const cats = CKL.CATS.filter((c) => all.some((d) => d.cat === c.id));
    let cat = cats[0].id, q = '';
    const title = kind === 'hat' ? 'Pick an event' : kind === 'stmt' ? 'Pick a block' : 'Pick a value block';
    openSheet(title, (box) => {
      const catRow = h('div', { class: 'cats' }), list = h('div', { class: 'pal' });
      const search = h('input', { type: 'search', placeholder: 'Search blocks…', style: 'width:100%;margin-bottom:8px', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
      const draw = () => {
        catRow.replaceChildren(); list.replaceChildren();
        for (const c of cats) catRow.append(h('button', { class: 'cat' + (c.id === cat && !q ? ' on' : ''), style: 'background:' + c.color, onclick: () => { cat = c.id; q = ''; search.value = ''; draw(); } }, c.icon + ' ' + c.title));
        const shown = all.filter((d) => (q ? (previewText(d) + ' ' + d.desc).toLowerCase().includes(q) : d.cat === cat));
        if (!shown.length) list.append(h('div', { class: 'empty' }, 'No blocks found.'));
        for (const d of shown) {
          list.append(h('button', { style: '--c:' + blockColor(d), onclick: () => { closeSheet(); cb(d.id); } }, previewText(d), h('small', {}, d.desc.split('. ')[0].replace(/\.$/, '') + '.')));
        }
      };
      box.append(search, catRow, list);
      draw();
    });
  }

  // ------------------------------------------------------------------ CODE: Lua
  function renderLua(o, body) {
    const status = h('div', { class: 'status' });
    const ta = h('textarea', { class: 'lua', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' });
    ta.value = o.script.lua;
    const check = () => {
      try { new Lua.Interp().compile(ta.value, o.name); status.textContent = '✓ No mistakes found'; status.className = 'status good'; }
      catch (e) { status.textContent = '✗ ' + e.message.replace(/^[^:]*:/, 'line '); status.className = 'status bad'; }
    };
    ta.addEventListener('input', () => { o.script.lua = ta.value; dirty(); clearTimeout(ta._t); ta._t = setTimeout(check, 300); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } });
    body.append(
      h('div', { class: 'hint' }, 'This object runs your Lua code. Its blocks are kept safe but not used while Lua mode is on.'),
      ta, status,
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: () => confirmBox('Replace your Lua?', 'The code will be replaced with the Lua made from this object\'s blocks.', 'Replace', () => { o.script.lua = CKL.generate(o.script.blocks); dirty(); renderCode(); }) }, '🧩→📝 Fill from my blocks'),
        h('button', { class: 'btn sm', onclick: () => { ta.setRangeText(LUA_SNIPPET, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); } }, '＋ Insert example')),
      h('details', {}, h('summary', {}, 'Lua cheat sheet'),
        h('p', {}, 'Write functions with these names and the game calls them for you:'),
        h('p', {}, h('code', {}, 'start()'), ' ', h('code', {}, 'update(dt)'), ' ', h('code', {}, 'tapped()'), ' ', h('code', {}, 'touching(other)'), ' ', h('code', {}, 'pressed(button)'), ' ', h('code', {}, 'message(name)'), ' ', h('code', {}, 'screen_tapped(x, y)')),
        h('p', {}, 'Useful: ', h('code', {}, 'move(dx, dy)'), ' ', h('code', {}, 'jump(power)'), ' ', h('code', {}, 'say(text, secs)'), ' ', h('code', {}, 'play("coin")'), ' ', h('code', {}, 'spawn("Coin", x, y)'), ' ', h('code', {}, 'destroy()'), ' ', h('code', {}, 'button("Left")'), ' ', h('code', {}, 'vars.score'), ' ', h('code', {}, 'me.x'), ' ', h('code', {}, 'me.y'), ' ', h('code', {}, 'game_over("text")')),
        h('p', {}, 'Open the 📖 Block guide and scroll to “Lua guide” for every function.')));
    check();
  }
  const LUA_SNIPPET = `function update(dt)
  if button("Left") then move(-3, 0) end
  if button("Right") then move(3, 0) end
end

function pressed(b)
  if b == "A" then jump(12) play("jump") end
end
`;

  // ------------------------------------------------------------------ PLAY
  function startPlay() {
    stopPlay();
    const probs = Engine.checkProject(P);
    const pb = $('#playProblems'); pb.replaceChildren();
    $('#log').textContent = '';
    $('#stage').style.display = probs.length ? 'none' : '';
    if (probs.length) {
      for (const pr of probs) pb.append(h('div', { class: 'panel' }, h('b', {}, '“' + pr.name + '” has a problem'), h('div', {}, pr.message), h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: () => { codeId = pr.id; setTab('code'); } }, 'Fix it'))));
      return;
    }
    if (!P.objects.length) pb.append(h('div', { class: 'empty' }, 'Your game is empty. Add objects in the Scene tab.'));
    const cv = $('#playCanvas');
    game = new Engine.Game(cv, P, {
      onLog: (s) => { const l = $('#log'); l.textContent += s + '\n'; if (l.textContent.length > 6000) l.textContent = l.textContent.slice(-4000); l.scrollTop = l.scrollHeight; },
      onError: (er) => { pb.replaceChildren(h('div', { class: 'panel' }, h('b', {}, '“' + er.name + '” stopped the game'), h('div', {}, er.message), h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: () => { codeId = er.id; setTab('code'); } }, 'Fix it')))); },
    });
    game.start();
    controls = Engine.mountControls($('#stage'), game);
    $('#playHint').textContent = 'Arrow keys / WASD · Space = A · X = B';
  }
  function stopPlay() {
    if (game) { game.stop(); game = null; }
    if (controls) { controls.destroy(); controls = null; }
  }

  // ------------------------------------------------------------------ GAME settings, export, APK
  function renderGame() {
    const box = $('#gameBody'); box.replaceChildren();
    const S = P.settings;
    const fld = (label, el) => h('label', { class: 'field' }, label, el);
    const num = (key, min, max, step) => h('input', { type: 'number', value: S[key], step: step || 'any', onchange: (e) => { S[key] = Math.max(min, Math.min(max, Number(e.target.value) || 0)); e.target.value = S[key]; dirty(); } });
    box.append(h('div', { class: 'panel' },
      h('div', { class: 'fields' },
        fld('Game name (also the app name)', h('input', { type: 'text', value: P.name, maxlength: 40, onchange: (e) => { P.name = e.target.value.trim() || 'My game'; $('#projName').value = P.name; dirty(); } })),
        fld('Screen shape', h('select', { value: S.orientation, onchange: (e) => { S.orientation = e.target.value; if (e.target.value === 'portrait' && S.worldWidth > 360 && S.worldWidth === 640) { S.worldWidth = 360; S.worldHeight = 640; } else if (e.target.value === 'landscape' && S.worldWidth === 360 && S.worldHeight === 640) { S.worldWidth = 640; S.worldHeight = 360; } dirty(); renderGame(); } }, h('option', { value: 'landscape' }, 'Wide (landscape)'), h('option', { value: 'portrait' }, 'Tall (portrait)'))),
        fld('World width', num('worldWidth', 100, 6000, 10)), fld('World height', num('worldHeight', 100, 6000, 10)),
        fld('Gravity', num('gravity', 0, 3, 0.05)),
        fld('Sky color', h('input', { type: 'color', value: S.background, onchange: (e) => { S.background = e.target.value; dirty(); } })),
        fld('On-screen buttons', h('select', { value: S.controls, onchange: (e) => { S.controls = e.target.value; dirty(); } }, h('option', { value: 'lr' }, '◀ ▶ + A B'), h('option', { value: 'dpad' }, 'D-pad + A B'), h('option', { value: 'none' }, 'None (taps only)')))),
      h('div', { class: 'hint' }, 'The world can be bigger than the screen. Use “Camera follows me” on your hero to scroll.')));

    const vlist = h('div', {});
    const drawVars = () => {
      vlist.replaceChildren();
      if (!P.variables.length) vlist.append(h('div', { class: 'empty' }, 'No variables yet.'));
      P.variables.forEach((v, i) => vlist.append(h('div', { class: 'item', style: 'display:flex;align-items:center;gap:8px;margin:4px 0' }, h('span', { class: 'grow' }, '📦 ' + v),
        h('button', { class: 'btn sm danger', onclick: () => { P.variables.splice(i, 1); dirty(); drawVars(); } }, 'Remove'))));
    };
    drawVars();
    box.append(h('h2', {}, 'Variables'), h('div', { class: 'panel' }, vlist, h('button', { class: 'btn sm', onclick: () => ask('New variable', '', (n) => { addVariable(n); drawVars(); }) }, '＋ New variable')));

    box.append(h('h2', {}, 'Share & build'), h('div', { class: 'panel' },
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: exportCkl }, '📤 Export .ckl project'),
        h('button', { class: 'btn', onclick: importCkl }, '📥 Import .ckl'),
        h('button', { class: 'btn', onclick: buildApk }, '📦 Build Android app (.apk)')),
      h('div', { class: 'hint' }, Native ? 'The app you build is a normal Android app with your game inside. You can install it or send it to friends.' : 'Building an .apk only works inside the Android app. Export a .ckl here and open it there.')));
    box.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: openGuide }, '📖 Block guide'), h('button', { class: 'btn danger', onclick: () => confirmBox('Delete this game?', 'It will be removed from this device.', 'Delete', () => { const id = P.id; clearTimeout(saveTimer); stopPlay(); Store.del(id); P = null; renderHome(); }) }, '🗑 Delete game')));
  }
  function safeName(s) { return String(s || 'game').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'game'; }
  function exportCkl() {
    saveNow();
    const json = JSON.stringify(P, null, 1);
    if (Native) { Native.exportProject(safeName(P.name), json); return; }
    const a = h('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: safeName(P.name) + '.ckl' });
    document.body.append(a); a.click(); a.remove();
  }
  function importCkl() {
    if (Native) { Native.importProject(); return; }
    const inp = h('input', { type: 'file', accept: '.ckl,application/json' });
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => gotImported(String(r.result)); r.readAsText(f); };
    inp.click();
  }
  function gotImported(text) {
    let p;
    try { p = JSON.parse(text); } catch (e) { toast('That file is not a .ckl project'); return; }
    if (!p || !Array.isArray(p.objects)) { toast('That file is not a .ckl project'); return; }
    p.id = Templates.uid('p');
    p = normalize(p);
    const probs = Engine.checkProject(p);
    Store.save(p);
    openProject(p);
    toast(probs.length ? 'Opened, but some scripts have mistakes' : 'Project opened');
  }
  function buildApk() {
    if (!Native) { toast('Building an .apk only works inside the Android app'); return; }
    const probs = Engine.checkProject(P);
    if (probs.length) { toast('Fix the script problems first (see the Play tab)'); return; }
    saveNow();
    openSheet('Building your app…', (b) => { b.append(h('p', { id: 'apkMsg' }, 'This takes a few seconds. Please wait…')); });
    Native.buildApk(JSON.stringify(P));
  }
  function apkResult(r) {
    openSheet(r.ok ? 'Your app is ready! 🎉' : 'Could not build the app', (b) => {
      b.append(h('p', {}, r.message || ''));
      if (r.ok) b.append(h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => Native.installApk() }, '📲 Install now'),
        h('button', { class: 'btn', onclick: () => Native.shareApk() }, '📤 Share / save .apk')),
      h('p', { class: 'hint' }, 'If Android asks, allow “install unknown apps” for Block Game Maker.'));
    });
  }

  function openGuide() { const f = $('#guideFrame'); if (!f.getAttribute('src')) f.setAttribute('src', 'docs/blocks.html'); $('#guide').classList.remove('hidden'); }
  function closeGuide() { $('#guide').classList.add('hidden'); }

  // ------------------------------------------------------------------ native bridge
  window.onNative = function (name, data) {
    let d = data;
    if (typeof data === 'string' && (name === 'apk')) { try { d = JSON.parse(data); } catch (e) { d = { ok: false, message: data }; } }
    if (name === 'imported') gotImported(String(data));
    else if (name === 'apk') apkResult(d);
    else if (name === 'toast') toast(String(data));
  };
  window.handleBack = function () {
    if (!$('#guide').classList.contains('hidden')) { closeGuide(); return true; }
    if (!$('#overlay').classList.contains('hidden')) { closeSheet(); return true; }
    if (P) { closeProject(); return true; }
    return false;
  };

  // ------------------------------------------------------------------ boot
  function boot() {
    wireScene();
    $('#backBtn').onclick = closeProject;
    $('#projName').addEventListener('change', (e) => { P.name = e.target.value.trim() || 'My game'; e.target.value = P.name; dirty(); });
    $$('#tabbar button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
    $('#codeObj').onchange = (e) => { codeId = e.target.value; renderCode(); };
    $('#modeBlocks').onclick = () => setMode('blocks');
    $('#modeLua').onclick = () => setMode('lua');
    $('#playRestart').onclick = startPlay;
    $('#sheetClose').onclick = closeSheet;
    $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeSheet(); });
    $('#guideBtn').onclick = openGuide; $('#homeGuide').onclick = openGuide; $('#homeGuide2').onclick = openGuide;
    $('#guideClose').onclick = closeGuide;
    $('#importBtn').onclick = importCkl;
    window.addEventListener('resize', () => { if (P && tab === 'scene') { Scene.z = null; renderScene(); } });
    window.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
    renderHome();
  }
  window.CKLEditor = { get project() { return P; }, openProject, setTab, normalize, Store };
  boot();
})();
