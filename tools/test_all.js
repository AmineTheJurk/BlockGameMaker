// Headless tests: every block compiles + runs, every starter game runs, gameplay scenarios work.
// Run: node tools/test_all.js
const assert = require('assert');
const CKL = require('../web/blocks.js');
const Engine = require('../web/engine.js');
const T = require('../web/templates.js');
const { Interp } = require('../web/lua.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. every block: sample Lua compiles
for (const d of CKL.BLOCKS) {
  const src = CKL.sampleLua(d);
  const code = d.kind === 'val' || d.kind === 'bool' ? 'local _x = ' + src : src;
  try { new Interp().compile(code, d.id); n++; }
  catch (e) { assert.fail(`block ${d.id} generates bad Lua:\n${code}\n${e.message}`); }
}

// 2. every block can be placed in a real script and run for some frames without an error
const blank = { name: 'T', emoji: '🐱', shape: 'emoji', w: 30, h: 30, x: 10, y: 10 };
for (const d of CKL.BLOCKS) {
  if (d.kind === 'hat') continue;
  const ctx = { objects: ['T'], variables: ['score'] };
  const stackBlock = (d.kind === 'val' || d.kind === 'bool') ? CKL.newBlock('set_text', ctx) : CKL.newBlock(d.id, ctx);
  if (d.kind === 'val') stackBlock.a.v = CKL.newBlock(d.id, ctx);
  if (d.kind === 'bool') { const w = CKL.newBlock('if', ctx); w.a.cond = CKL.newBlock(d.id, ctx); w.do = [CKL.newBlock('note', ctx)]; stackBlock.a.v = 'x'; }
  const stacks = [{ t: 'every_frame', a: {}, do: [d.kind === 'bool' ? (() => { const w = CKL.newBlock('if', ctx); w.a.cond = CKL.newBlock(d.id, ctx); return w; })() : stackBlock] }];
  const proj = { id: 'x', name: 'x', settings: {}, variables: ['score'], objects: [Object.assign({ id: 'a' }, blank, { script: { mode: 'blocks', blocks: stacks } })] };
  const g = new Engine.Game(null, proj);
  for (let i = 0; i < 5; i++) g.step(Engine.STEP);
  if (['game_over', 'win', 'restart'].includes(d.id)) continue;
  ok(g.state === 'playing', `block ${d.id} broke the game: ${g.error && g.error.message}`);
}

// 3. every starter game runs 600 frames with no errors, and its scripts compile
for (const gm of T.GAMES) {
  const p = T.newProject(gm.key);
  ok(Engine.checkProject(p).length === 0, `game ${gm.key} has script errors`);
  const g = new Engine.Game(null, p);
  for (let i = 0; i < 300; i++) g.step(Engine.STEP);
  ok(g.state === 'playing' || g.state === 'over' || g.state === 'won', `game ${gm.key} state ${g.state} ${g.error && g.error.message}`);
}
// every object template compiles
for (const t of T.OBJECTS) ok(Engine.checkProject({ objects: [T.makeObject(t.key, 0, 0)] }).length === 0, 'template ' + t.key);

// 4. platformer gameplay: hero falls onto ground, walks right, jumps, collects a coin
{
  const p = T.newProject('platformer');
  const g = new Engine.Game(null, p);
  const hero = () => g.findAll('Hero')[0];
  for (let i = 0; i < 60; i++) g.step(Engine.STEP);
  ok(hero().t.get('on_ground') === true, 'hero should stand on the ground');
  const y0 = hero().t.get('y');
  ok(Math.abs(y0 - 296) < 1, 'hero rests on the ground top, y=' + y0);
  const x0 = hero().t.get('x');
  g.press('Right');
  for (let i = 0; i < 30; i++) g.step(Engine.STEP);
  ok(hero().t.get('x') > x0 + 80, 'hero moves right');
  g.release('Right');
  g.press('A'); g.step(Engine.STEP); g.release('A');
  for (let i = 0; i < 6; i++) g.step(Engine.STEP);
  ok(hero().t.get('y') < y0 - 20, 'hero jumped: y=' + hero().t.get('y'));
  // teleport the hero onto a coin
  const coins = g.findAll('Coin').length;
  const coin = g.findAll('Coin')[0];
  hero().t.set('x', coin.t.get('x')); hero().t.set('y', coin.t.get('y'));
  g.step(Engine.STEP); g.step(Engine.STEP);
  ok(g.findAll('Coin').length === coins - 1, 'coin collected');
  ok(g.G.get('vars').get('score') === 1, 'score is 1');
  // fall in the pit -> game over
  hero().t.set('x', 560); hero().t.set('y', 330);
  for (let i = 0; i < 90; i++) g.step(Engine.STEP);
  ok(g.state === 'over', 'falling ends the game, state=' + g.state);
  g.endAt = 0; g.tapAt(10, 10);
  ok(g.state === 'playing', 'tap restarts');
  ok(g.G.get('vars').get('score') === 0, 'score reset');
}

// 5. catch game: stars spawn and fall; basket catches
{
  const g = new Engine.Game(null, T.newProject('catch'));
  for (let i = 0; i < 125; i++) g.step(Engine.STEP);
  ok(g.findAll('Star').length >= 1, 'stars spawn');
  const star = g.findAll('Star')[0];
  const bask = g.findAll('Basket')[0];
  star.t.set('x', bask.t.get('x')); star.t.set('y', bask.t.get('y') - 10);
  g.step(Engine.STEP); g.step(Engine.STEP);
  ok(g.G.get('vars').get('score') >= 1, 'basket caught star');
}

// 6. chase game: ghost reaches hero -> game over
{
  const g = new Engine.Game(null, T.newProject('topdown'));
  for (let i = 0; i < 1200 && g.state === 'playing'; i++) g.step(Engine.STEP);
  ok(g.state === 'over', 'ghost catches the idle hero');
}

// 7. Lua mode: user script with messages, timers, spawn, errors
{
  const lua = `
    function start()
      me.x = 5
      after(0.05, function() vars.done = (vars.done or 0) + 1 end)
      every(0.1, function() vars.ticks = vars.ticks + 1 end)
    end
    function update(dt) if button("Right") then move(2, 0) end end
    function pressed(b) if b == "A" then send("hello") end end
    function message(name) if name == "hello" then vars.got = 1 end end
  `;
  const p = { id: 'l', name: 'l', settings: {}, variables: ['ticks', 'got'], objects: [Object.assign({ id: 'a', script: { mode: 'lua', lua } }, blank)] };
  const g = new Engine.Game(null, p);
  g.press('Right'); g.press('A');
  for (let i = 0; i < 70; i++) g.step(Engine.STEP);
  ok(g.G.get('vars').get('done') === 1, 'after() ran once');
  ok(g.G.get('vars').get('ticks') >= 9, 'every() ran: ' + g.G.get('vars').get('ticks'));
  ok(g.G.get('vars').get('got') === 1, 'message delivered');
  ok(g.findAll('T')[0].t.get('x') > 50, 'update moved');
}
{
  const bad = { id: 'e', name: 'e', settings: {}, variables: [], objects: [Object.assign({ id: 'a', script: { mode: 'lua', lua: 'function update() nothing() end' } }, blank)] };
  const g = new Engine.Game(null, bad);
  g.step(Engine.STEP);
  ok(g.state === 'error' && /nothing/.test(g.error.message), 'runtime error is reported: ' + (g.error && g.error.message));
  const syn = { objects: [Object.assign({ id: 'a', script: { mode: 'lua', lua: 'function start(' } }, blank)] };
  ok(Engine.checkProject(syn).length === 1, 'syntax error is reported');
  const loop = { id: 'e', name: 'e', settings: {}, variables: [], objects: [Object.assign({ id: 'a', script: { mode: 'lua', lua: 'function start() while true do end end' } }, blank)] };
  const g2 = new Engine.Game(null, loop);
  ok(g2.state === 'error' && /ran too long/.test(g2.error.message), 'endless loop is stopped');
}

// 8. code generator details
{
  const g = CKL.generate([{ t: 'when_button', a: { button: 'A' }, do: [{ t: 'jump', a: { n: 12 } }] }, { t: 'when_button', a: { button: 'B' }, do: [{ t: 'play', a: { sound: 'coin' } }] }]);
  ok(g.split('function pressed(button)').length === 2, 'same events are merged into one function');
  ok(/move\(-3, 0\)/.test(CKL.generate([{ t: 'every_frame', a: {}, do: [{ t: 'move', a: { dir: 'left', n: 3 } }] }])), 'move left negates');
  ok(/vars\["my score"\]/.test(CKL.generate([{ t: 'when_start', a: {}, do: [{ t: 'var_set', a: { name: 'my score', v: 1 } }] }])), 'odd variable names are quoted');
  ok(/move\(0, -\(vars\.n\)\)|move\(0, -\(/.test(CKL.generate([{ t: 'every_frame', a: {}, do: [{ t: 'move', a: { dir: 'up', n: { t: 'var_get', a: { name: 'n' } } } }] }])), 'reporter in a negated slot');
}

console.log(`blocks/engine/templates: ${n} checks passed (${CKL.BLOCKS.length} blocks, ${T.OBJECTS.length} object templates, ${T.GAMES.length} starter games)`);
