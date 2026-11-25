/* templates.js — ready-made objects ("template items") and starter games. All scripts are real blocks. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const CKL = isNode ? require('./blocks.js') : root.CKL;

  let counter = 0;
  const uid = (p) => (p || 'o') + Date.now().toString(36) + (counter++).toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const b = (t, a, kids) => Object.assign({ t, a: a || {} }, kids || {});
  const script = (stacks) => ({ mode: 'blocks', blocks: stacks, lua: '' });
  const btn = (name, then) => b('if', { cond: b('button_down', { button: name }) }, { do: then });

  // ------------------------------------------------------------------ object templates
  const OBJECTS = [
    { key: 'hero_platformer', title: 'Hero (jumper)', emoji: '🐱', desc: 'Walks left and right, jumps with button A, falls with gravity. Camera follows. Game over if it falls off the world.',
      make: () => ({ name: 'Hero', emoji: '🐱', shape: 'emoji', w: 32, h: 32, gravity: true, collide: true,
        script: script([
          b('when_start', {}, { do: [b('camera_follow')] }),
          b('every_frame', {}, { do: [
            btn('Left', [b('move', { dir: 'left', n: 3 }), b('face', { dir: 'left' })]),
            btn('Right', [b('move', { dir: 'right', n: 3 }), b('face', { dir: 'right' })]),
            b('if', { cond: b('compare', { a: b('my_prop', { prop: 'x' }), op: '<', b: 0 }) }, { do: [b('set_x', { x: 0 })] }),
            b('if', { cond: b('compare', { a: b('my_prop', { prop: 'y' }), op: '>', b: 420 }) }, { do: [b('play', { sound: 'lose' }), b('game_over', { text: 'You fell!' })] }),
          ] }),
          b('when_button', { button: 'A' }, { do: [b('if', { cond: b('on_ground') }, { do: [b('jump', { n: 12 }), b('play', { sound: 'jump' })] })] }),
        ]) }) },
    { key: 'hero_topdown', title: 'Hero (top-down)', emoji: '🧑', desc: 'Walks in four directions, no gravity. Great for mazes and chase games.',
      make: () => ({ name: 'Hero', emoji: '🧑', shape: 'emoji', w: 30, h: 30, collide: true,
        script: script([
          b('every_frame', {}, { do: [
            btn('Left', [b('move', { dir: 'left', n: 3 })]), btn('Right', [b('move', { dir: 'right', n: 3 })]),
            btn('Up', [b('move', { dir: 'up', n: 3 })]), btn('Down', [b('move', { dir: 'down', n: 3 })]),
            b('keep_inside'),
          ] }),
        ]) }) },
    { key: 'catcher', title: 'Catcher basket', emoji: '🧺', desc: 'Slides left and right along the bottom. Catches things that fall.',
      make: () => ({ name: 'Basket', emoji: '🧺', shape: 'emoji', w: 56, h: 44, collide: true,
        script: script([b('every_frame', {}, { do: [btn('Left', [b('move', { dir: 'left', n: 5 })]), btn('Right', [b('move', { dir: 'right', n: 5 })]), b('keep_inside')] })]) }) },
    { key: 'platform', title: 'Platform / ground', emoji: '🟩', desc: 'A solid green block. Other objects can stand on it and cannot walk through it.',
      make: () => ({ name: 'Platform', shape: 'rect', color: '#5cb85c', w: 120, h: 24, solid: true, script: script([]) }) },
    { key: 'rock', title: 'Rock (wall)', emoji: '🪨', desc: 'A solid rock. Blocks the way. Enemies turn around when they hit it.',
      make: () => ({ name: 'Rock', emoji: '🪨', shape: 'emoji', w: 32, h: 32, solid: true, script: script([]) }) },
    { key: 'coin', title: 'Coin', emoji: '🪙', desc: 'When the Hero touches it: +1 score, a coin sound, and the coin disappears.',
      make: () => ({ name: 'Coin', emoji: '🪙', shape: 'emoji', w: 26, h: 26,
        script: script([b('when_touching', { obj: 'Hero' }, { do: [b('var_change', { name: 'score', n: 1 }), b('play', { sound: 'coin' }), b('destroy')] })]) }) },
    { key: 'enemy', title: 'Walking enemy', emoji: '👾', desc: 'Walks back and forth and turns around at walls. Game over if it touches the Hero.',
      make: () => ({ name: 'Enemy', emoji: '👾', shape: 'emoji', w: 30, h: 30, gravity: true, collide: true,
        script: script([
          b('when_start', {}, { do: [b('set_speed_x', { n: 1.5 })] }),
          b('every_frame', {}, { do: [b('bounce', { mode: 'sides' })] }),
          b('when_touching', { obj: 'Hero' }, { do: [b('play', { sound: 'hit' }), b('game_over', { text: 'Caught!' })] }),
        ]) }) },
    { key: 'ghost', title: 'Chasing ghost', emoji: '👻', desc: 'Floats toward the Hero all the time. Game over when it catches the Hero.',
      make: () => ({ name: 'Ghost', emoji: '👻', shape: 'emoji', w: 30, h: 30,
        script: script([
          b('every_frame', {}, { do: [b('move_toward', { obj: 'Hero', n: 1 })] }),
          b('when_touching', { obj: 'Hero' }, { do: [b('play', { sound: 'hit' }), b('game_over', { text: 'The ghost got you!' })] }),
        ]) }) },
    { key: 'spike', title: 'Spikes', emoji: '🔺', desc: 'Dangerous! Game over if the Hero touches it.',
      make: () => ({ name: 'Spike', emoji: '🔺', shape: 'emoji', w: 28, h: 24,
        script: script([b('when_touching', { obj: 'Hero' }, { do: [b('play', { sound: 'hit' }), b('game_over', { text: 'Ouch!' })] })]) }) },
    { key: 'flag', title: 'Goal flag', emoji: '🚩', desc: 'Touch it to win the game.',
      make: () => ({ name: 'Flag', emoji: '🚩', shape: 'emoji', w: 32, h: 40,
        script: script([b('when_touching', { obj: 'Hero' }, { do: [b('play', { sound: 'win' }), b('win', { text: 'You made it!' })] })]) }) },
    { key: 'star', title: 'Falling star', emoji: '⭐', desc: 'Falls down. Caught by the Basket: +1 score. If it reaches the bottom, game over. Use with the Star maker.',
      make: () => ({ name: 'Star', emoji: '⭐', shape: 'emoji', w: 28, h: 28,
        script: script([
          b('when_start', {}, { do: [b('set_speed_y', { n: 3 })] }),
          b('every_frame', {}, { do: [b('if', { cond: b('compare', { a: b('my_prop', { prop: 'y' }), op: '>', b: 640 }) }, { do: [b('play', { sound: 'lose' }), b('game_over', { text: 'You missed one!' })] })] }),
          b('when_touching', { obj: 'Basket' }, { do: [b('var_change', { name: 'score', n: 1 }), b('play', { sound: 'coin' }), b('destroy')] }),
        ]) }) },
    { key: 'spawner', title: 'Star maker', emoji: '✨', desc: 'Invisible. Makes a new Star at a random place at the top every second.',
      make: () => ({ name: 'StarMaker', emoji: '✨', shape: 'emoji', w: 20, h: 20, visible: false,
        script: script([b('every_secs', { secs: 1 }, { do: [b('spawn', { obj: 'Star', x: b('random', { a: 0, b: 320 }), y: -30 })] })]) }) },
    { key: 'ball', title: 'Bouncy ball', emoji: '⚽', desc: 'Flies around and bounces off all the walls.',
      make: () => ({ name: 'Ball', emoji: '⚽', shape: 'emoji', w: 30, h: 30,
        script: script([b('when_start', {}, { do: [b('set_speed_x', { n: 3 }), b('set_speed_y', { n: 2 })] }), b('every_frame', {}, { do: [b('bounce', { mode: 'all' }), b('turn', { deg: 6 })] })]) }) },
    { key: 'score', title: 'Score text', emoji: '🔢', desc: 'Shows the score on the screen. It stays in place even when the camera moves.',
      make: () => ({ name: 'ScoreText', shape: 'text', text: 'Score: 0', color: '#1b1b1b', w: 200, h: 26, fixed: true,
        script: script([b('every_frame', {}, { do: [b('set_text', { v: b('join', { a: 'Score: ', b: b('var_get', { name: 'score' }) }) })] })]) }) },
    { key: 'restart', title: 'Restart button', emoji: '🔄', desc: 'A button on the screen. Tap it to restart the game.',
      make: () => ({ name: 'RestartButton', shape: 'rect', color: '#ff7043', text: 'Restart', w: 90, h: 30, fixed: true,
        script: script([b('when_tapped', {}, { do: [b('restart')] })]) }) },
    { key: 'label', title: 'Text label', emoji: '🔤', desc: 'Plain text on the screen. Change the words in the Text box.',
      make: () => ({ name: 'Label', shape: 'text', text: 'Hello!', color: '#1b1b1b', w: 200, h: 28, fixed: true, script: script([]) }) },
    { key: 'blank', title: 'Blank box', emoji: '⬜', desc: 'An empty object. Give it a look and some blocks.',
      make: () => ({ name: 'Thing', emoji: '😀', shape: 'emoji', w: 32, h: 32, script: script([]) }) },
  ];
  const OBJ_BY_KEY = {};
  OBJECTS.forEach((o) => { OBJ_BY_KEY[o.key] = o; });

  function makeObject(key, x, y) {
    const t = OBJ_BY_KEY[key];
    if (!t) throw new Error('unknown template ' + key);
    const d = t.make();
    return Object.assign({ id: uid('o'), x: x || 0, y: y || 0, w: 32, h: 32, shape: 'emoji', emoji: '😀', color: '#888888', text: '', solid: false, gravity: false, collide: false, fixed: false, visible: true }, d);
  }

  // ------------------------------------------------------------------ starter games
  function place(key, x, y, over) {
    const o = makeObject(key, x, y);
    return Object.assign(o, over || {});
  }
  const GAMES = [
    { key: 'platformer', title: 'Jumping game', emoji: '🏃', desc: 'A platformer: collect coins, jump over the pit, avoid the walking enemy, reach the flag.',
      make: () => ({
        settings: { orientation: 'landscape', worldWidth: 1280, worldHeight: 360, gravity: 0.6, background: '#87ceeb', controls: 'lr' },
        variables: ['score'],
        objects: [
          place('hero_platformer', 40, 260),
          place('platform', 0, 328, { name: 'Ground', w: 520, h: 32 }), place('platform', 640, 328, { name: 'Ground', w: 640, h: 32 }),
          place('platform', 300, 250, { w: 110, h: 18 }), place('platform', 700, 240, { w: 110, h: 18 }), place('platform', 900, 180, { w: 110, h: 18 }),
          place('coin', 340, 210), place('coin', 560, 230), place('coin', 740, 200), place('coin', 940, 140), place('coin', 1050, 290),
          place('rock', 700, 296), place('rock', 1110, 296), place('enemy', 850, 296),
          place('flag', 1220, 288), place('score', 10, 8),
        ],
      }) },
    { key: 'topdown', title: 'Chase game', emoji: '👻', desc: 'Top-down: collect all the coins while a ghost chases you.',
      make: () => ({
        settings: { orientation: 'landscape', worldWidth: 640, worldHeight: 360, gravity: 0.6, background: '#cfe8cf', controls: 'dpad' },
        variables: ['score'],
        objects: [
          place('hero_topdown', 300, 170),
          place('coin', 80, 60), place('coin', 540, 60), place('coin', 80, 280), place('coin', 540, 280), place('coin', 300, 40),
          place('rock', 200, 120), place('rock', 400, 220), place('rock', 300, 280),
          place('ghost', 560, 30), place('score', 10, 8),
        ],
      }) },
    { key: 'catch', title: 'Catch game', emoji: '🧺', desc: 'Move the basket and catch the falling stars. Miss one and it is game over.',
      make: () => ({
        settings: { orientation: 'portrait', worldWidth: 360, worldHeight: 640, gravity: 0.6, background: '#1b2a5c', controls: 'lr' },
        variables: ['score'],
        objects: [
          place('catcher', 150, 540), place('spawner', 170, -60), place('star', 160, -200),
          place('score', 10, 10, { color: '#ffffff' }),
        ],
      }) },
    { key: 'empty', title: 'Empty game', emoji: '✨', desc: 'Start from nothing. Add your own objects.',
      make: () => ({ settings: { orientation: 'landscape', worldWidth: 640, worldHeight: 360, gravity: 0.6, background: '#87ceeb', controls: 'lr' }, variables: ['score'], objects: [] }) },
  ];

  function newProject(key, name) {
    const g = GAMES.find((x) => x.key === key) || GAMES[GAMES.length - 1];
    const d = g.make();
    return { format: 'ckl', version: 1, id: uid('p'), name: name || g.title, settings: d.settings, variables: d.variables, objects: d.objects, updated: Date.now() };
  }

  const api = { OBJECTS, GAMES, makeObject, newProject, uid };
  root.Templates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
