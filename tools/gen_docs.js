// Builds the "every single block" guide: web/docs/blocks.html (+ a copy at ../BlockGuide.html).
// Run: node tools/gen_docs.js      It FAILS if any block has no explanation or is missing from the page.
const fs = require('fs');
const path = require('path');
const CKL = require('../web/blocks.js');
const T = require('../web/templates.js');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KIND_NAME = { hat: 'Event block', stmt: 'Step block', c: 'Wrapper block', val: 'Value block', bool: 'Yes/No block' };
const KIND_HELP = {
  hat: 'Starts a script. Nothing can go above it.', stmt: 'Does one thing. Snaps into a script.', c: 'Holds other blocks inside it.',
  val: 'Gives back a number or some words. Plugs into a round hole.', bool: 'Answers yes or no. Plugs into an “If” or a yes/no hole.',
};

function labelHtml(def) {
  return def.label.map((p) => {
    if (typeof p === 'string') return `<span class="w">${esc(p)}</span>`;
    switch (p.t) {
      case 'dd': return `<span class="a dd">${esc(optLabel(p))} ▾</span>`;
      case 'obj': return `<span class="a dd">${p.any ? 'anything' : 'object'} ▾</span>`;
      case 'var': return '<span class="a dd">variable ▾</span>';
      case 'bool': return '<span class="a q">yes/no</span>';
      case 'color': return `<span class="a col" style="background:${esc(p.d)}"></span>`;
      case 'emoji': return `<span class="a">${esc(p.d)}</span>`;
      default: return `<span class="a">${esc(p.d === '' ? '…' : p.d)}</span>`;
    }
  }).join(' ');
}
function optLabel(p) { const o = p.opts.find((x) => (Array.isArray(x) ? x[0] : x) === p.d) || p.opts[0]; return Array.isArray(o) ? o[1] : o; }
function optionsList(def) {
  const out = [];
  for (const p of CKL.argSpecs(def)) {
    if (p.t === 'dd') out.push(`<li><b>${esc(guessName(def, p))}:</b> ${p.opts.map((o) => esc(Array.isArray(o) ? o[1] : o)).join(', ')}</li>`);
    if (p.t === 'obj') out.push(`<li><b>Which object:</b> pick one of the objects in your game${p.any ? ' (or “anything”)' : ''}.</li>`);
    if (p.t === 'var') out.push('<li><b>Which variable:</b> pick one of your variables, or make a new one.</li>');
  }
  return out.length ? `<ul class="opts">${out.join('')}</ul>` : '';
}
function guessName(def, p) {
  const names = { dir: 'Direction', mode: 'Which walls', flag: 'Ability', state: 'On or off', button: 'Button', sound: 'Sound', op: 'Operation', fn: 'What to do', prop: 'What fact', dim: 'Which size', axis: 'Which one', v: 'Value' };
  return names[p.k] || p.k;
}

// ------------------------------------------------------------------ Lua API reference (checked against the real engine below)
const LUA_FUNCS = [
  ['Moving', [
    ['move(dx, dy)', 'Move by dx sideways and dy down. Stops at solid things if “Hits solid things” is on.'],
    ['go_to(x, y)', 'Jump to a place.'], ['jump(power)', 'Jump up (only on the ground).'], ['bounce(mode)', 'Turn around at walls. mode is "sides", "top" or "all".'],
    ['keep_inside()', 'Push back into the world.'], ['move_toward(name, amount)', 'Step toward the nearest object with that name.'],
    ['set_size(percent)', 'Change size (100 is normal).'], ['face("left" or "right")', 'Flip the picture.'],
  ]],
  ['Looks & sound', [
    ['say(text, seconds)', 'Speech bubble.'], ['play(name)', 'Sound: "jump", "coin", "hit", "win", "lose", "beep".'], ['set_background(color)', 'Change the sky color, like "#000000".'],
  ]],
  ['Time & other objects', [
    ['after(seconds, fn)', 'Run fn once later.'], ['every(seconds, fn)', 'Run fn again and again.'], ['send(text)', 'Tell all objects. They get it in message(name).'],
    ['spawn(name, x, y)', 'Make a copy of an object. Returns the new object.'], ['destroy()', 'Delete this object.'],
    ['get(name)', 'The first object with that name (or nil).'], ['count(name)', 'How many objects have that name.'],
    ['is_touching(name)', 'true if touching an object with that name (nil = anything).'], ['distance_to(name)', 'Distance to the nearest one.'],
    ['prop_of(name, property)', 'A property of another object.'], ['set_prop_of(name, property, value)', 'Change a property of another object.'],
  ]],
  ['Game', [
    ['game_over(text)', 'Game over screen.'], ['win(text)', 'You win screen.'], ['restart()', 'Start again.'], ['camera_follow()', 'Scroll the screen to follow me.'],
    ['set_gravity(number)', 'Change gravity.'], ['button(name)', 'true while that button is held: "Left", "Right", "Up", "Down", "A", "B".'],
    ['random(a, b)', 'Random whole number from a to b.'], ['game_time()', 'Seconds since the game started.'], ['save(key, value)', 'Remember a value on this device.'],
    ['saved(key, backup)', 'Read a remembered value.'], ['log(value)', 'Write to the log under the play screen.'],
  ]],
  ['Special values', [
    ['me', 'This object. Properties: x, y, w, h, vx, vy, angle, flip, visible, solid, gravity, collide, fixed, shape, emoji, color, text, on_ground.'],
    ['vars', 'Your variables: vars.score. A variable you never set is 0.'], ['screen.width, screen.height', 'Size of the screen.'], ['tap.x, tap.y', 'Where the player last tapped.'],
  ]],
  ['Your functions (the game calls them)', [
    ['function start()', 'When the game starts.'], ['function update(dt)', 'Every frame. dt is the time since last frame.'], ['function tapped()', 'When this object is tapped.'],
    ['function touching(other)', 'While touching another object. other.name tells you who.'], ['function pressed(button)', 'When a button is pressed.'],
    ['function message(name)', 'When a message arrives.'], ['function screen_tapped(x, y)', 'When the screen is tapped.'],
  ]],
  ['Lua basics', [
    ['local x = 5', 'Make a variable that only this script can see.'], ['if a then ... elseif b then ... else ... end', 'Decide.'],
    ['for i = 1, 10 do ... end', 'Count.'], ['while cond do ... end', 'Repeat while true.'], ['function name(a, b) ... end', 'Make your own function.'],
    ['{1, 2, 3}  and  {x = 1}', 'Lists and records (tables). #list is the length.'], ['a .. b', 'Join text.'], ['-- note', 'A comment.'],
    ['math.floor, math.sqrt, math.abs, math.max, math.min, math.sin …', 'Math helpers.'], ['string.format("%d", n), ("x"):upper() …', 'Text helpers.'], ['table.insert, table.remove, ipairs, pairs', 'List helpers.'],
  ]],
];

// ------------------------------------------------------------------ build page
const cats = CKL.CATS.map((c) => ({ ...c, blocks: CKL.BLOCKS.filter((b) => b.cat === c.id) }));
for (const b of CKL.BLOCKS) {
  if (!b.desc || b.desc.trim().length < 20) throw new Error('Block "' + b.id + '" has no explanation');
  if (!b.ex) throw new Error('Block "' + b.id + '" has no example');
  if (!CKL.CATS.some((c) => c.id === b.cat)) throw new Error('Block "' + b.id + '" is in an unknown category');
}

const blockHtml = (b) => {
  const color = cats.find((c) => c.id === b.cat).color;
  return `<article class="block" id="b-${b.id}" data-block="${b.id}" style="--c:${color}">
  <div class="pic"><div class="pill ${b.kind}" style="background:${color}">${labelHtml(b)}${b.bodies ? '<div class="inner">…</div>' : ''}${b.kind === 'hat' ? '<div class="inner">…</div>' : ''}</div><span class="kind">${KIND_NAME[b.kind]}</span></div>
  <div class="txt">
    <p class="what">${esc(b.desc)}</p>
    ${optionsList(b)}
    <p class="ex"><b>Example:</b> ${esc(b.ex)}</p>
    <details><summary>Show the Lua code</summary><pre>${esc(CKL.sampleLua(b))}</pre></details>
  </div>
</article>`;
};

const toc = cats.map((c) => `<a href="#c-${c.id}" style="--c:${c.color}">${c.icon} ${c.title} <small>${c.blocks.length}</small></a>`).join('');
const sections = cats.map((c) => `<section id="c-${c.id}" style="--c:${c.color}"><h2><span class="ci">${c.icon}</span> ${c.title}</h2><p class="blurb">${esc(c.blurb)}</p>${c.blocks.map(blockHtml).join('\n')}</section>`).join('\n');

const kinds = Object.keys(KIND_NAME).map((k) => `<div class="kcard"><div class="pill ${k}" style="background:#777"><span class="w">${KIND_NAME[k]}</span></div><p>${KIND_HELP[k]}</p></div>`).join('');
const luaHtml = LUA_FUNCS.map(([title, rows]) => `<h3>${esc(title)}</h3><table>${rows.map(([n, d]) => `<tr><td><code>${esc(n)}</code></td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('');
const tplHtml = `<h3>Objects you can add</h3><div class="tpl">${T.OBJECTS.map((o) => `<div class="tcard"><div class="te">${esc(o.emoji)}</div><b>${esc(o.title)}</b><p>${esc(o.desc)}</p></div>`).join('')}</div>
<h3>Games you can start from</h3><div class="tpl">${T.GAMES.map((o) => `<div class="tcard"><div class="te">${esc(o.emoji)}</div><b>${esc(o.title)}</b><p>${esc(o.desc)}</p></div>`).join('')}</div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Block Game Maker – Block Guide</title>
<style>
:root{--bg:#f4f6fb;--panel:#fff;--ink:#1c2233;--mute:#667089;--line:#dfe3ee;--code:#10131d;--codeink:#cfe3ff}
@media (prefers-color-scheme:dark){:root{--bg:#141824;--panel:#1d2233;--ink:#eef1fa;--mute:#9aa4bf;--line:#2e3550}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:70px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header.hero{padding:28px 18px 8px;max-width:900px;margin:0 auto}
header.hero h1{margin:0 0 6px;font-size:30px}header.hero p{margin:6px 0;color:var(--mute)}
nav.toc{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:8px 12px;display:flex;gap:6px;overflow-x:auto}
nav.toc a{flex:none;background:var(--c,#555);color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:6px 12px;font-size:14px}
nav.toc a small{opacity:.8}
main{max-width:900px;margin:0 auto;padding:6px 14px 60px}
section{margin-top:30px}
h2{display:flex;align-items:center;gap:10px;margin:0;font-size:24px;border-bottom:4px solid var(--c);padding-bottom:6px}
h3{margin:22px 0 6px}
.ci{font-size:26px}.blurb{color:var(--mute);margin:8px 0 14px}
.block{display:grid;grid-template-columns:minmax(170px,300px) 1fr;gap:16px;background:var(--panel);border:1px solid var(--line);border-left:6px solid var(--c);border-radius:14px;padding:14px;margin:12px 0}
@media (max-width:640px){.block{grid-template-columns:1fr}}
.pill{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center;color:#fff;padding:8px 12px;border-radius:10px;font-weight:600;max-width:100%}
.pill.hat{border-radius:20px 20px 10px 10px;flex-direction:column;align-items:flex-start}
.pill.c{flex-direction:column;align-items:flex-start}
.pill.val{border-radius:999px}.pill.bool{border-radius:8px;clip-path:polygon(10px 0,calc(100% - 10px) 0,100% 50%,calc(100% - 10px) 100%,10px 100%,0 50%);padding:8px 20px}
.pill .inner{align-self:stretch;margin-top:4px;border-left:8px solid rgba(255,255,255,.55);background:rgba(0,0,0,.14);padding:4px 8px;border-radius:0 6px 6px 0}
.pill .a{background:#fffffff0;color:#222;border-radius:7px;padding:1px 8px;font-weight:600;min-width:22px;text-align:center}
.pill .a.dd{background:#ffffffd0}.pill .a.q{background:rgba(255,255,255,.35);color:#fff;border:1px dashed #fff}
.pill .a.col{display:inline-block;width:28px;height:20px;padding:0;border:2px solid #fff}
.pill .w{text-shadow:0 1px 0 rgba(0,0,0,.2)}
.kind{display:block;margin-top:8px;font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.05em}
.what{margin:0 0 6px;font-size:17px}.ex{margin:6px 0;color:var(--mute)}.ex b{color:var(--ink)}
ul.opts{margin:6px 0;padding-left:20px;color:var(--mute)}ul.opts b{color:var(--ink)}
details{margin-top:6px}summary{cursor:pointer;color:var(--mute);font-size:14px}
pre{background:var(--code);color:var(--codeink);padding:10px 12px;border-radius:10px;overflow:auto;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:6px 0 0}
code{font:14px ui-monospace,Menlo,Consolas,monospace;background:var(--line);padding:1px 6px;border-radius:6px}
.kinds{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.kcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}.kcard p{margin:8px 0 0;color:var(--mute);font-size:14px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}td:first-child{white-space:nowrap}
@media (max-width:640px){td:first-child{white-space:normal}}
.tpl{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
.tcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}.te{font-size:30px}.tcard p{margin:4px 0 0;color:var(--mute);font-size:14px}
.steps li{margin:6px 0}
</style></head>
<body>
<header class="hero">
<h1>🧱 Block Guide</h1>
<p>Every block in Block Game Maker, explained in plain words. There are <b>${CKL.BLOCKS.length} blocks</b> in ${cats.length} groups. Tap a group below to jump to it.</p>
</header>
<nav class="toc">${toc}<a href="#lua" style="--c:#444">📝 Lua guide</a><a href="#items" style="--c:#666">🎁 Template items</a></nav>
<main>
<section id="how" style="--c:#3d6bff"><h2><span class="ci">🧭</span> How it works</h2>
<ol class="steps">
<li>Every object in your game (the hero, a coin, an enemy…) has its own <b>script</b> made of blocks.</li>
<li>A script always starts with a yellow <b>event block</b> (like “When game starts” or “Every frame”). It says <i>when</i> the blocks below it run.</li>
<li>Tap <b>＋ Add block</b> to put a block inside. Tap <b>ƒ</b> next to a hole to plug a round <b>value block</b> or a pointy <b>yes/no block</b> into it.</li>
<li>Tap <b>⋮</b> on a block to move it up or down, copy it, or delete it.</li>
<li>Tap <b>▶ Play</b> to try your game. Tap <b>📝 Lua</b> if you want to write code instead.</li>
</ol>
<h3>The five kinds of block</h3><div class="kinds">${kinds}</div>
</section>
${sections}
<section id="lua" style="--c:#444"><h2><span class="ci">📝</span> Lua guide</h2>
<p class="blurb">Prefer typing code? Switch any object to <b>Lua</b> mode. Every block above turns into one of these functions. The 🧩→📝 button turns your blocks into Lua so you can learn from them.</p>${luaHtml}</section>
<section id="items" style="--c:#666"><h2><span class="ci">🎁</span> Template items</h2><p class="blurb">Ready-made objects (with blocks already inside) and starter games. Add objects with “＋ Add object” in the Scene tab.</p>${tplHtml}</section>
</main></body></html>`;

// ------------------------------------------------------------------ verify: every block appears, every Lua function exists
for (const b of CKL.BLOCKS) if (!html.includes(`data-block="${b.id}"`)) throw new Error('Block missing from guide: ' + b.id);
const found = (html.match(/data-block="/g) || []).length;
if (found !== CKL.BLOCKS.length) throw new Error(`Guide has ${found} blocks but there are ${CKL.BLOCKS.length}`);

const Engine = require('../web/engine.js');
const g = new Engine.Game(null, { id: 't', name: 't', settings: {}, variables: [], objects: [{ id: 'a', name: 'A', x: 0, y: 0, w: 10, h: 10, script: { mode: 'lua', lua: '' } }] });
const env = g.objects[0].env;
for (const [, rows] of LUA_FUNCS) for (const [sig] of rows) {
  const m = /^([a-z_]+)\(/.exec(sig);
  if (!m || sig.startsWith('function ') || sig.startsWith('math') || sig.startsWith('string') || sig.startsWith('table')) continue;
  const name = m[1];
  if (env.get(name) === undefined && g.G.get(name) === undefined) throw new Error('Lua guide documents ' + name + ' but the engine has no such function');
}
for (const name of ['move', 'go_to', 'jump', 'bounce', 'keep_inside', 'move_toward', 'say', 'play', 'after', 'every', 'send', 'spawn', 'destroy', 'game_over', 'win', 'restart', 'camera_follow', 'set_gravity', 'button', 'random', 'game_time', 'save', 'saved', 'log', 'set_size', 'face', 'set_background', 'count', 'get', 'prop_of', 'set_prop_of', 'is_touching', 'distance_to']) {
  if (env.get(name) === undefined && g.G.get(name) === undefined) throw new Error('Engine function missing: ' + name);
  if (!html.includes('<code>' + name + '(')) throw new Error('Lua guide does not document ' + name);
}

const out = path.join(__dirname, '..', 'web', 'docs', 'blocks.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
fs.writeFileSync(path.join(__dirname, '..', 'BlockGuide.html'), html);
console.log(`guide written: ${CKL.BLOCKS.length} blocks, ${(html.length / 1024).toFixed(0)} KB -> web/docs/blocks.html and BlockGuide.html`);
