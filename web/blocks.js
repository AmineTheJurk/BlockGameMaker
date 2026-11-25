/* blocks.js — every block in one table + the blocks -> Lua code generator.
 *
 * This table is the single source of truth: the editor builds its palette from it,
 * the game engine runs the Lua it generates, and tools/gen_docs.js builds the
 * "every single block" guide page from it (and refuses to build if a block has no explanation).
 *
 * A project script is a list of "stacks". Each stack starts with an event block (kind 'hat'):
 *   { t:'when_start', a:{}, do:[ {t:'move', a:{dir:'right', n:5}}, ... ] }
 * Values inside a block's `a` are either plain literals or another reporter block ({t:'random', a:{...}}).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ categories
  const CATS = [
    { id: 'events',  title: 'Events',    color: '#f5b100', icon: '⚡', blurb: 'Blocks that start a script. Every script begins with one of these.' },
    { id: 'move',    title: 'Move',      color: '#3d8bff', icon: '🏃', blurb: 'Make your object walk, jump, bounce and turn.' },
    { id: 'look',    title: 'Look',      color: '#9b6bff', icon: '🎨', blurb: 'Change how your object looks and what it says.' },
    { id: 'sound',   title: 'Sound',     color: '#e05cc8', icon: '🔊', blurb: 'Play short sound effects.' },
    { id: 'control', title: 'Control',   color: '#ff8c1a', icon: '🔁', blurb: 'Make decisions, repeat things, wait, and talk to other objects.' },
    { id: 'vars',    title: 'Variables', color: '#ff5c7a', icon: '📦', blurb: 'Boxes that remember numbers or words, like a score.' },
    { id: 'math',    title: 'Math',      color: '#3fb950', icon: '🧮', blurb: 'Do sums, pick random numbers, compare things and join words.' },
    { id: 'sense',   title: 'Sensing',   color: '#26b5d9', icon: '👀', blurb: 'Ask questions about the game: what is pressed, what is touching, where things are.' },
    { id: 'game',    title: 'Game',      color: '#14a89a', icon: '🎮', blurb: 'Win, lose, restart, camera, gravity and notes.' },
  ];

  const BUTTONS = ['Left', 'Right', 'Up', 'Down', 'A', 'B'];
  const SOUNDS = ['jump', 'coin', 'hit', 'win', 'lose', 'beep'];
  const PROPS = [['x', 'x'], ['y', 'y'], ['w', 'width'], ['h', 'height'], ['vx', 'sideways speed'], ['vy', 'up/down speed'], ['text', 'text']];
  const LUA_WORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

  // ------------------------------------------------------------ arg helpers
  const num = (k, d) => ({ k, t: 'num', d });
  const txt = (k, d) => ({ k, t: 'text', d });
  const val = (k, d) => ({ k, t: 'val', d });
  const bool = (k) => ({ k, t: 'bool', d: false });
  const dd = (k, opts, d) => ({ k, t: 'dd', opts, d: d === undefined ? (Array.isArray(opts[0]) ? opts[0][0] : opts[0]) : d });
  const obj = (k, any) => ({ k, t: 'obj', d: '', any: !!any });
  const vr = (k) => ({ k, t: 'var', d: '' });
  const col = (k, d) => ({ k, t: 'color', d });
  const emo = (k, d) => ({ k, t: 'emoji', d });

  const BLOCKS = [];
  const BY_ID = {};
  function B(def) {
    if (BY_ID[def.id]) throw new Error('duplicate block id ' + def.id);
    BLOCKS.push(def); BY_ID[def.id] = def;
  }

  // ------------------------------------------------------------ code helpers
  const I = (lines) => lines.map((l) => '  ' + l);
  const luaStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(parseFloat(n.toPrecision(12))));
  const NUMLIT = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
  const neg = (e) => (NUMLIT.test(e) ? (e[0] === '-' ? e.slice(1) : '-' + e) : '-(' + e + ')');
  const varRef = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !LUA_WORDS.has(name) ? 'vars.' + name : 'vars[' + luaStr(name) + ']');

  // ============================================================ EVENTS
  B({ id: 'when_start', cat: 'events', kind: 'hat', handler: 'start', label: ['When game starts'],
    lua: (a, r, body) => body.do,
    desc: 'Runs one time when the game begins (and again each time the game restarts). Use it to get things ready: set a starting position, reset the score, give the object a first speed.',
    ex: 'When game starts → Set score to 0 → Go to x 40 y 200.' });

  B({ id: 'every_frame', cat: 'events', kind: 'hat', handler: 'update', label: ['Every frame'],
    lua: (a, r, body) => body.do,
    desc: 'Runs again and again, about 60 times every second, for as long as the game is running. Put things here that must keep happening: moving while a button is held, checking if you fell off the screen, updating the score text.',
    ex: 'Every frame → If button Right is down → Move right by 3.' });

  B({ id: 'every_secs', cat: 'events', kind: 'hat', handler: 'start', label: ['Every', num('secs', 1), 'seconds'],
    lua: (a, r, body) => ['every(' + a.secs + ', function()', ...I(body.do), 'end)'],
    desc: 'Starts a timer. The blocks inside run once every N seconds, for as long as the game is running. Great for making enemies or coins appear now and then.',
    ex: 'Every 3 seconds → Make a copy of Enemy at x 600 y 250.' });

  B({ id: 'when_tapped', cat: 'events', kind: 'hat', handler: 'tapped', label: ['When I am tapped'],
    lua: (a, r, body) => body.do,
    desc: 'Runs when the player taps (or clicks) this object on the screen.',
    ex: 'When I am tapped → Change score by 1 → Play sound coin.' });

  B({ id: 'when_touching', cat: 'events', kind: 'hat', handler: 'touching', label: ['When I touch', obj('obj', true)],
    lua: (a, r, body) => (r.obj === '*' || r.obj === '' ? body.do : ['if other.name == ' + a.obj + ' then', ...I(body.do), 'end']),
    desc: 'Runs while this object overlaps the object you choose. It keeps running on every frame while they overlap, so it is best used for things that end the touching (like Delete me) or that are fine to repeat. Choose "anything" to react to every object.',
    ex: 'On a coin: When I touch Hero → Change score by 1 → Delete me.' });

  B({ id: 'when_button', cat: 'events', kind: 'hat', handler: 'pressed', label: ['When button', dd('button', BUTTONS), 'is pressed'],
    lua: (a, r, body) => ['if button == ' + a.button + ' then', ...I(body.do), 'end'],
    desc: 'Runs once at the moment the player presses the chosen on-screen button (or keyboard key). Buttons are Left, Right, Up, Down, A and B. On a computer: arrow keys or WASD, Space or Z for A, X for B.',
    ex: 'When button A is pressed → Jump with power 12.' });

  B({ id: 'when_message', cat: 'events', kind: 'hat', handler: 'message', label: ['When I get message', txt('msg', 'go')],
    lua: (a, r, body) => ['if name == ' + a.msg + ' then', ...I(body.do), 'end'],
    desc: 'Runs when any object uses "Send message" with the same word. Messages are how objects talk to each other.',
    ex: 'When I get message "boom" → Hide → Play sound hit.' });

  B({ id: 'when_screen_tap', cat: 'events', kind: 'hat', handler: 'screen_tapped', label: ['When the screen is tapped'],
    lua: (a, r, body) => body.do,
    desc: 'Runs when the player taps anywhere on the screen. Use the "Tap x" and "Tap y" blocks to find out where.',
    ex: 'When the screen is tapped → Go to x (Tap x) y (Tap y).' });

  // ============================================================ MOVE
  B({ id: 'move', cat: 'move', kind: 'stmt', label: ['Move', dd('dir', [['right', 'right'], ['left', 'left'], ['up', 'up'], ['down', 'down']]), 'by', num('n', 5)],
    lua: (a, r) => (r.dir === 'right' ? 'move(' + a.n + ', 0)' : r.dir === 'left' ? 'move(' + neg(a.n) + ', 0)' : r.dir === 'up' ? 'move(0, ' + neg(a.n) + ')' : 'move(0, ' + a.n + ')'),
    desc: 'Moves your object a few steps in a direction. If your object "hits solid things", it stops when it bumps into a solid object like a wall or platform.',
    ex: 'If button Left is down → Move left by 3.' });

  B({ id: 'go_to', cat: 'move', kind: 'stmt', label: ['Go to x', num('x', 0), 'y', num('y', 0)],
    lua: (a) => 'go_to(' + a.x + ', ' + a.y + ')',
    desc: 'Jumps your object straight to a place on the screen. x is how far from the left edge, y is how far from the top edge. It ignores walls.',
    ex: 'When game starts → Go to x 40 y 200.' });

  B({ id: 'set_x', cat: 'move', kind: 'stmt', label: ['Set x to', num('x', 0)],
    lua: (a) => 'me.x = ' + a.x,
    desc: 'Puts your object at this distance from the left edge of the screen, without changing its up/down position.',
    ex: 'If x is bigger than 640 → Set x to 0 (wrap around).' });

  B({ id: 'set_y', cat: 'move', kind: 'stmt', label: ['Set y to', num('y', 0)],
    lua: (a) => 'me.y = ' + a.y,
    desc: 'Puts your object at this distance from the top edge of the screen, without changing its left/right position.',
    ex: 'Set y to 0 puts the object at the very top.' });

  B({ id: 'set_speed_x', cat: 'move', kind: 'stmt', label: ['Set sideways speed to', num('n', 0)],
    lua: (a) => 'me.vx = ' + a.n,
    desc: 'Gives your object a sideways speed. It keeps moving by itself every frame. Positive goes right, negative goes left, 0 stops.',
    ex: 'On an enemy: When game starts → Set sideways speed to 1.5.' });

  B({ id: 'set_speed_y', cat: 'move', kind: 'stmt', label: ['Set up/down speed to', num('n', 0)],
    lua: (a) => 'me.vy = ' + a.n,
    desc: 'Gives your object an up/down speed. Positive goes down, negative goes up. Objects with gravity change this speed by themselves.',
    ex: 'Set up/down speed to -10 launches the object upward.' });

  B({ id: 'jump', cat: 'move', kind: 'stmt', label: ['Jump with power', num('n', 12)],
    lua: (a) => 'jump(' + a.n + ')',
    desc: 'Makes your object jump up — but only if it is standing on the ground (or on a solid object). Needs gravity turned on. Bigger power = higher jump.',
    ex: 'When button A is pressed → Jump with power 12.' });

  B({ id: 'bounce', cat: 'move', kind: 'stmt', label: ['Bounce off', dd('mode', [['sides', 'left & right walls'], ['top', 'top & bottom walls'], ['all', 'all walls']])],
    lua: (a) => 'bounce(' + a.mode + ')',
    desc: 'If your object reached the edge of the world or bumped into a solid object, it turns around (its speed flips). Use it with "Set sideways speed" to make something that walks back and forth or a bouncing ball.',
    ex: 'On a ball: Every frame → Bounce off all walls.' });

  B({ id: 'keep_inside', cat: 'move', kind: 'stmt', label: ['Stay inside the world'],
    lua: () => 'keep_inside()',
    desc: 'If your object is partly outside the world, push it back in. Handy so the player cannot walk off the edge.',
    ex: 'Every frame → Stay inside the world.' });

  B({ id: 'move_toward', cat: 'move', kind: 'stmt', label: ['Move toward', obj('obj'), 'by', num('n', 2)],
    lua: (a) => 'move_toward(' + a.obj + ', ' + a.n + ')',
    desc: 'Moves your object a little bit toward the nearest object with that name. Use it for enemies that chase the hero.',
    ex: 'On a ghost: Every frame → Move toward Hero by 1.' });

  B({ id: 'turn', cat: 'move', kind: 'stmt', label: ['Turn', num('deg', 15), 'degrees'],
    lua: (a) => 'me.angle = me.angle + ' + a.deg,
    desc: 'Spins your object clockwise by this many degrees (use a negative number to spin the other way). It only changes how the object looks — it does not change its hitbox.',
    ex: 'On a coin: Every frame → Turn 5 degrees.' });

  B({ id: 'set_flag', cat: 'move', kind: 'stmt', label: ['Turn', dd('flag', [['gravity', 'gravity'], ['solid', 'solid'], ['collide', 'hits solid things']]), dd('state', [['on', 'on'], ['off', 'off']])],
    lua: (a, r) => 'me.' + r.flag + ' = ' + (r.state === 'on' ? 'true' : 'false'),
    desc: 'Switches one of your object\'s abilities on or off while the game runs. Gravity: it falls. Solid: other objects cannot pass through it. Hits solid things: it stops when it bumps into solid objects.',
    ex: 'When I am tapped → Turn gravity on (the object falls).' });

  // ============================================================ LOOK
  B({ id: 'say', cat: 'look', kind: 'stmt', label: ['Say', txt('text', 'Hello!'), 'for', num('secs', 2), 'seconds'],
    lua: (a) => 'say(' + a.text + ', ' + a.secs + ')',
    desc: 'Shows a speech bubble above your object for a few seconds. The game keeps running while the bubble is shown.',
    ex: 'When I touch Hero → Say "Ouch!" for 1 seconds.' });

  B({ id: 'set_look', cat: 'look', kind: 'stmt', label: ['Change look to', emo('emoji', '😀')],
    lua: (a) => 'me.emoji = ' + a.emoji,
    desc: 'Changes the picture of your object to a different emoji. Tap the emoji box to pick one.',
    ex: 'When I am tapped → Change look to 💥.' });

  B({ id: 'set_color', cat: 'look', kind: 'stmt', label: ['Set color to', col('color', '#ff5252')],
    lua: (a) => 'me.color = ' + a.color,
    desc: 'Changes the color of your object. This is the fill color of boxes and circles, and the letter color of text.',
    ex: 'When I touch Hero → Set color to red.' });

  B({ id: 'set_size', cat: 'look', kind: 'stmt', label: ['Set size to', num('pct', 100), '%'],
    lua: (a) => 'set_size(' + a.pct + ')',
    desc: 'Makes your object bigger or smaller. 100 is normal size, 50 is half size, 200 is double size. The hitbox changes too.',
    ex: 'When I touch Mushroom → Set size to 150 %.' });

  B({ id: 'show', cat: 'look', kind: 'stmt', label: ['Show'],
    lua: () => 'me.visible = true',
    desc: 'Makes your object visible again. Visible objects can touch other objects and be tapped.',
    ex: 'When I get message "reveal" → Show.' });

  B({ id: 'hide', cat: 'look', kind: 'stmt', label: ['Hide'],
    lua: () => 'me.visible = false',
    desc: 'Makes your object invisible. A hidden object cannot be touched or tapped, but its scripts keep running.',
    ex: 'When game starts → Hide (until a message says to show it).' });

  B({ id: 'set_text', cat: 'look', kind: 'stmt', label: ['Set my text to', val('v', 'Score: 0')],
    lua: (a) => 'me.text = tostring(' + a.v + ')',
    desc: 'Changes the words shown on your object. Use it with a Text object to show the score. Drop a "Join" block in here to mix words and numbers.',
    ex: 'Every frame → Set my text to (Join "Score: " and score).' });

  B({ id: 'face', cat: 'look', kind: 'stmt', label: ['Face', dd('dir', [['right', 'right'], ['left', 'left']])],
    lua: (a) => 'face(' + a.dir + ')',
    desc: 'Flips the picture so your object looks to the left or to the right. Pictures start out facing right.',
    ex: 'If button Left is down → Face left.' });

  B({ id: 'set_background', cat: 'look', kind: 'stmt', label: ['Set background color to', col('color', '#87ceeb')],
    lua: (a) => 'set_background(' + a.color + ')',
    desc: 'Changes the color of the whole game background (the sky behind everything).',
    ex: 'When I touch Door → Set background color to black.' });

  // ============================================================ SOUND
  B({ id: 'play', cat: 'sound', kind: 'stmt', label: ['Play sound', dd('sound', SOUNDS)],
    lua: (a) => 'play(' + a.sound + ')',
    desc: 'Plays a short sound effect: jump, coin, hit, win, lose or beep. The game does not wait for the sound to finish.',
    ex: 'When I touch Hero → Play sound coin.' });

  // ============================================================ CONTROL
  B({ id: 'if', cat: 'control', kind: 'c', bodies: ['do'], label: ['If', bool('cond'), 'then'],
    lua: (a, r, body) => ['if ' + a.cond + ' then', ...I(body.do), 'end'],
    desc: 'Only runs the blocks inside if the question is true. Drop a yes/no block (like "Button Left is down") into the hole.',
    ex: 'If button Left is down then Move left by 3.' });

  B({ id: 'if_else', cat: 'control', kind: 'c', bodies: ['do', 'else'], label: ['If', bool('cond'), 'then'], elseLabel: 'else',
    lua: (a, r, body) => ['if ' + a.cond + ' then', ...I(body.do), 'else', ...I(body.else), 'end'],
    desc: 'Like "If", but with two parts. The top part runs when the question is true, the bottom part ("else") runs when it is not.',
    ex: 'If On the ground? then Set color to green else Set color to red.' });

  B({ id: 'repeat', cat: 'control', kind: 'c', bodies: ['do'], label: ['Repeat', num('n', 10), 'times'],
    lua: (a, r, body) => ['for _ = 1, ' + a.n + ' do', ...I(body.do), 'end'],
    desc: 'Runs the blocks inside again and again, the number of times you choose, all at once (not one per frame).',
    ex: 'Repeat 5 times → Make a copy of Star at x (Random 0 to 600) y 0.' });

  B({ id: 'while', cat: 'control', kind: 'c', bodies: ['do'], label: ['Repeat while', bool('cond')],
    lua: (a, r, body) => ['while ' + a.cond + ' do', ...I(body.do), 'end'],
    desc: 'Keeps running the blocks inside as long as the question is true. Make sure something inside changes the answer, or the game will stop with an "endless loop" message.',
    ex: 'Repeat while y is smaller than 300 → Change my y... (move down by 1).' });

  B({ id: 'after', cat: 'control', kind: 'c', bodies: ['do'], label: ['After', num('secs', 1), 'seconds'],
    lua: (a, r, body) => ['after(' + a.secs + ', function()', ...I(body.do), 'end)'],
    desc: 'Waits a little while and then runs the blocks inside, one time. The rest of your script does not wait — it carries on straight away.',
    ex: 'When I touch Hero → After 2 seconds → Delete me.' });

  B({ id: 'send', cat: 'control', kind: 'stmt', label: ['Send message', txt('msg', 'go')],
    lua: (a) => 'send(' + a.msg + ')',
    desc: 'Shouts a word to every object in the game. Every object with a matching "When I get message" block runs its script.',
    ex: 'When I touch Hero → Send message "open".' });

  B({ id: 'stop', cat: 'control', kind: 'stmt', label: ['Stop this script'],
    lua: () => 'do return end',
    desc: 'Stops the current script right here. Blocks after it do not run this time. Scripts start again on their next event.',
    ex: 'If score is 0 → Stop this script.' });

  B({ id: 'destroy', cat: 'control', kind: 'stmt', label: ['Delete me'],
    lua: () => 'destroy()',
    desc: 'Removes this object from the game for good (until the game restarts). Use it for collected coins, used-up bullets or defeated enemies.',
    ex: 'When I touch Hero → Delete me.' });

  B({ id: 'spawn', cat: 'control', kind: 'stmt', label: ['Make a copy of', obj('obj'), 'at x', num('x', 0), 'y', num('y', 0)],
    lua: (a) => 'spawn(' + a.obj + ', ' + a.x + ', ' + a.y + ')',
    desc: 'Creates a brand-new copy of an object you made, at the place you choose. The copy runs its own "When game starts" script right away.',
    ex: 'Every 2 seconds → Make a copy of Coin at x (Random 20 to 600) y 0.' });

  // ============================================================ VARIABLES
  B({ id: 'var_set', cat: 'vars', kind: 'stmt', label: ['Set', vr('name'), 'to', val('v', 0)],
    lua: (a, r) => varRef(r.name) + ' = ' + a.v,
    desc: 'Puts a value into a variable (a labeled box that remembers things). Every object can see the same variables. Make new ones with "＋ New variable".',
    ex: 'When game starts → Set score to 0.' });

  B({ id: 'var_change', cat: 'vars', kind: 'stmt', label: ['Change', vr('name'), 'by', num('n', 1)],
    lua: (a, r) => varRef(r.name) + ' = ' + varRef(r.name) + ' + ' + a.n,
    desc: 'Adds a number to a variable. Use a negative number to subtract.',
    ex: 'When I touch Hero → Change score by 1.' });

  B({ id: 'var_get', cat: 'vars', kind: 'val', label: [vr('name')],
    lua: (a, r) => (r.name ? varRef(r.name) : '0'),
    desc: 'The current value of a variable. Drop it into any block that has a round or white hole. A variable you never set counts as 0.',
    ex: 'Set my text to (Join "Score: " and (score)).' });

  B({ id: 'save', cat: 'vars', kind: 'stmt', label: ['Save', val('v', 0), 'as', txt('key', 'highscore')],
    lua: (a) => 'save(' + a.key + ', ' + a.v + ')',
    desc: 'Stores a value on the device so it is still there next time the game is played. Good for a high score.',
    ex: 'When game over → Save score as "highscore".' });

  B({ id: 'saved', cat: 'vars', kind: 'val', label: ['Saved value', txt('key', 'highscore'), 'or', val('d', 0), 'if none'],
    lua: (a) => 'saved(' + a.key + ', ' + a.d + ')',
    desc: 'Reads back a value you stored with "Save". If nothing was saved yet, you get the backup value you typed in.',
    ex: 'When game starts → Set best to (Saved value "highscore" or 0 if none).' });

  // ============================================================ MATH
  B({ id: 'arith', cat: 'math', kind: 'val', label: [num('a', 0), dd('op', [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['%', 'remainder']]), num('b', 0)],
    lua: (a, r) => '(' + a.a + ' ' + r.op + ' ' + a.b + ')',
    desc: 'Does a sum with two numbers: add, subtract, multiply, divide, or "remainder" (what is left over after dividing). You can put other blocks in the holes.',
    ex: '(score) × 10 gives ten points for each coin.' });

  B({ id: 'random', cat: 'math', kind: 'val', label: ['Random number from', num('a', 1), 'to', num('b', 10)],
    lua: (a) => 'random(' + a.a + ', ' + a.b + ')',
    desc: 'Picks a whole number at random between the two numbers (both can be picked). Different every time.',
    ex: 'Go to x (Random 0 to 600) y 0.' });

  B({ id: 'mathfn', cat: 'math', kind: 'val', label: [dd('fn', [['round', 'round'], ['floor', 'round down'], ['ceil', 'round up'], ['abs', 'positive of'], ['sqrt', 'square root of']]), 'of', num('x', 0)],
    lua: (a, r) => (r.fn === 'round' ? 'math.floor(' + a.x + ' + 0.5)' : 'math.' + r.fn + '(' + a.x + ')'),
    desc: 'Changes one number: round it to the nearest whole number, round down, round up, remove the minus sign, or take the square root.',
    ex: 'round of 3.7 is 4. positive of -5 is 5.' });

  B({ id: 'compare', cat: 'math', kind: 'bool', label: [val('a', 0), dd('op', [['==', '='], ['~=', '≠'], ['<', '<'], ['>', '>'], ['<=', '≤'], ['>=', '≥']]), val('b', 0)],
    lua: (a, r) => '(' + a.a + ' ' + r.op + ' ' + a.b + ')',
    desc: 'Compares two values and answers yes (true) or no (false). Use it in the hole of an "If" block.',
    ex: 'If (score) = 10 then You win.' });

  B({ id: 'and_or', cat: 'math', kind: 'bool', label: [bool('a'), dd('op', [['and', 'and'], ['or', 'or']]), bool('b')],
    lua: (a, r) => '(' + a.a + ' ' + r.op + ' ' + a.b + ')',
    desc: 'Joins two yes/no questions. "and" is yes only when both are yes. "or" is yes when at least one is yes.',
    ex: 'If (Button Left is down) or (Button A is down) ...' });

  B({ id: 'not', cat: 'math', kind: 'bool', label: ['not', bool('a')],
    lua: (a) => '(not ' + a.a + ')',
    desc: 'Flips a yes/no answer: yes becomes no, and no becomes yes.',
    ex: 'If not (On the ground?) then Say "Wheee!".' });

  B({ id: 'bool_val', cat: 'math', kind: 'bool', label: [dd('v', [['true', 'true'], ['false', 'false']])],
    lua: (a, r) => r.v,
    desc: 'A fixed yes (true) or no (false).',
    ex: 'Use true to make an "If" that always runs.' });

  B({ id: 'join', cat: 'math', kind: 'val', label: ['Join', txt('a', 'Score: '), 'and', txt('b', '')],
    lua: (a) => '(tostring(' + a.a + ') .. tostring(' + a.b + '))',
    desc: 'Sticks two pieces together into one piece of text. Numbers are turned into text, so you can put a variable in one of the holes.',
    ex: 'Join "Score: " and (score) makes Score: 3.' });

  // ============================================================ SENSING
  B({ id: 'button_down', cat: 'sense', kind: 'bool', label: ['Button', dd('button', BUTTONS), 'is down'],
    lua: (a) => 'button(' + a.button + ')',
    desc: 'Yes while the player is holding that button down. Use it inside "Every frame" for smooth movement.',
    ex: 'Every frame → If Button Right is down → Move right by 3.' });

  B({ id: 'touching', cat: 'sense', kind: 'bool', label: ['Touching', obj('obj', true), '?'],
    lua: (a, r) => 'is_touching(' + (r.obj === '*' || r.obj === '' ? 'nil' : a.obj) + ')',
    desc: 'Yes when this object overlaps an object with that name right now. Choose "anything" to check every object.',
    ex: 'If Touching Water? then Game over.' });

  B({ id: 'on_ground', cat: 'sense', kind: 'bool', label: ['On the ground?'],
    lua: () => 'me.on_ground',
    desc: 'Yes when this object is standing on something solid. Needs gravity turned on.',
    ex: 'If On the ground? then Set color to green.' });

  B({ id: 'my_prop', cat: 'sense', kind: 'val', label: ['My', dd('prop', PROPS)],
    lua: (a, r) => 'me.' + r.prop,
    desc: 'One fact about this object: where it is (x, y), how big it is, how fast it moves, or its text.',
    ex: 'If (My y) > 400 then Game over (fell off the world).' });

  B({ id: 'prop_of', cat: 'sense', kind: 'val', label: [dd('prop', PROPS), 'of', obj('obj')],
    lua: (a, r) => 'prop_of(' + a.obj + ', ' + a.prop + ')',
    desc: 'One fact about another object (the first one with that name): its position, size, speed or text. If it does not exist you get 0.',
    ex: 'Go to x (x of Hero) y (y of Hero).' });

  B({ id: 'distance', cat: 'sense', kind: 'val', label: ['Distance to', obj('obj')],
    lua: (a) => 'distance_to(' + a.obj + ')',
    desc: 'How far away the nearest object with that name is, measured from middle to middle. If there is none, you get a very big number.',
    ex: 'If (Distance to Hero) < 100 then Say "I see you!".' });

  B({ id: 'count_of', cat: 'sense', kind: 'val', label: ['How many', obj('obj'), 'exist'],
    lua: (a) => 'count(' + a.obj + ')',
    desc: 'Counts how many objects with that name are still in the game. Perfect for "collect all the coins".',
    ex: 'If (How many Coin exist) = 0 then You win.' });

  B({ id: 'screen_size', cat: 'sense', kind: 'val', label: ['Screen', dd('dim', [['width', 'width'], ['height', 'height']])],
    lua: (a, r) => 'screen.' + r.dim,
    desc: 'The width or height of the visible game screen, in game pixels.',
    ex: 'If (My y) > (Screen height) then Game over.' });

  B({ id: 'tap_pos', cat: 'sense', kind: 'val', label: ['Tap', dd('axis', [['x', 'x'], ['y', 'y']])],
    lua: (a, r) => 'tap.' + r.axis,
    desc: 'Where the player last tapped the screen. x counts from the left, y from the top.',
    ex: 'When the screen is tapped → Go to x (Tap x) y (Tap y).' });

  B({ id: 'game_time', cat: 'sense', kind: 'val', label: ['Seconds since start'],
    lua: () => 'game_time()',
    desc: 'How many seconds have passed since the game started (or restarted).',
    ex: 'Set my text to (Join "Time: " and (round of (Seconds since start))).' });

  // ============================================================ GAME
  B({ id: 'game_over', cat: 'game', kind: 'stmt', label: ['Game over:', txt('text', 'Try again!')],
    lua: (a) => 'game_over(' + a.text + ')',
    desc: 'Ends the game with a "game over" screen and your message. Tapping the screen starts the game again.',
    ex: 'When I touch Spike → Play sound lose → Game over: "Ouch!".' });

  B({ id: 'win', cat: 'game', kind: 'stmt', label: ['You win:', txt('text', 'Great job!')],
    lua: (a) => 'win(' + a.text + ')',
    desc: 'Ends the game with a "you win" screen and your message. Tapping the screen plays again.',
    ex: 'When I touch Flag → You win: "You made it!".' });

  B({ id: 'restart', cat: 'game', kind: 'stmt', label: ['Restart the game'],
    lua: () => 'restart()',
    desc: 'Starts the whole game over from the beginning: all objects go back to where you placed them and variables go back to 0.',
    ex: 'When button B is pressed → Restart the game.' });

  B({ id: 'camera_follow', cat: 'game', kind: 'stmt', label: ['Camera follows me'],
    lua: () => 'camera_follow()',
    desc: 'Makes the screen scroll to follow this object. Needs a world that is bigger than the screen (see Game settings).',
    ex: 'On the hero: When game starts → Camera follows me.' });

  B({ id: 'set_gravity', cat: 'game', kind: 'stmt', label: ['Set gravity to', num('g', 0.6)],
    lua: (a) => 'set_gravity(' + a.g + ')',
    desc: 'Changes how strongly gravity pulls objects that have gravity turned on. 0.6 is normal. 0.2 feels like the moon. 0 means floating.',
    ex: 'When I touch Moon → Set gravity to 0.2.' });

  B({ id: 'set_prop_of', cat: 'game', kind: 'stmt', label: ['Set', dd('prop', PROPS), 'of', obj('obj'), 'to', val('v', 0)],
    lua: (a) => 'set_prop_of(' + a.obj + ', ' + a.prop + ', ' + a.v + ')',
    desc: 'Changes one fact about another object (the first one with that name), like moving it or changing its text.',
    ex: 'Set text of ScoreBoard to (score).' });

  B({ id: 'note', cat: 'game', kind: 'stmt', label: ['Note:', txt('text', 'my note')],
    lua: (a, r) => '-- ' + String(r.text == null ? '' : r.text).replace(/[\r\n]+/g, ' '),
    desc: 'A reminder for yourself. It does nothing when the game runs. In the Lua version it becomes a comment.',
    ex: 'Note: "this part makes the hero jump".' });

  B({ id: 'log', cat: 'game', kind: 'stmt', label: ['Show', val('v', 'hi'), 'in the log'],
    lua: (a) => 'log(' + a.v + ')',
    desc: 'Writes a value into the log panel under the play screen. Handy for finding out what is going on inside your game.',
    ex: 'Show (My y) in the log.' });

  // ------------------------------------------------------------ helpers over the table
  function argSpecs(def) { return def.label.filter((p) => typeof p === 'object'); }
  const isBlock = (v) => v !== null && typeof v === 'object' && typeof v.t === 'string';

  function defaultFor(spec, ctx) {
    if (spec.t === 'obj') return (ctx && ctx.objects && ctx.objects[0]) || spec.d;
    if (spec.t === 'var') return (ctx && ctx.variables && ctx.variables[0]) || '';
    return spec.d;
  }
  function newBlock(id, ctx) {
    const d = BY_ID[id];
    if (!d) throw new Error('unknown block ' + id);
    const b = { t: id, a: {} };
    for (const s of argSpecs(d)) b.a[s.k] = defaultFor(s, ctx);
    for (const bn of d.bodies || (d.kind === 'hat' ? ['do'] : [])) b[bn] = [];
    return b;
  }
  const bodiesOf = (d) => d.bodies || (d.kind === 'hat' ? ['do'] : []);

  // ------------------------------------------------------------ code generation: blocks -> Lua
  function genLit(v, spec) {
    switch (spec.t) {
      case 'num': { const n = Number(v); return fmtNum(Number.isFinite(n) ? n : 0); }
      case 'bool': return 'false';
      case 'val': {
        if (typeof v === 'number') return fmtNum(v);
        const s = v == null ? '' : String(v);
        return s.trim() !== '' && Number.isFinite(Number(s)) ? fmtNum(Number(s)) : luaStr(s);
      }
      default: return luaStr(v == null ? '' : String(v));
    }
  }
  function genArg(v, spec, opts) {
    if (isBlock(v)) {
      const d = BY_ID[v.t];
      if (d && (d.kind === 'val' || d.kind === 'bool') && ['num', 'text', 'val', 'bool'].includes(spec.t)) return genExpr(v, opts);
      v = spec.d;
    }
    return genLit(v, spec);
  }
  function genExpr(b, opts) {
    const d = BY_ID[b.t];
    const { a, r } = collectArgs(d, b, opts);
    return d.lua(a, r, {});
  }
  function collectArgs(d, b, opts) {
    const a = {}, r = {};
    for (const s of argSpecs(d)) {
      const v = b.a ? b.a[s.k] : undefined;
      a[s.k] = genArg(v === undefined ? s.d : v, s, opts);
      r[s.k] = isBlock(v) ? null : (v === undefined ? s.d : v);
    }
    return { a, r };
  }
  function toLines(x) {
    if (x == null) return [];
    if (Array.isArray(x)) return x;
    return String(x).split('\n');
  }
  function genStack(list, opts) {
    const out = [];
    for (const b of list || []) {
      const d = BY_ID[b && b.t];
      if (!d) { out.push('-- (unknown block)'); continue; }
      if (d.kind !== 'stmt' && d.kind !== 'c') continue; // reporters or hats cannot stand in a stack
      const { a, r } = collectArgs(d, b, opts);
      const body = {};
      for (const bn of bodiesOf(d)) {
        const lines = genStack(b[bn], opts);
        body[bn] = lines.length === 0 && opts && opts.sample ? ['-- other blocks go here'] : lines;
      }
      out.push(...toLines(d.lua(a, r, body)));
    }
    return out;
  }
  const HANDLER_SIG = {
    start: 'start()', update: 'update(dt)', tapped: 'tapped()', touching: 'touching(other)',
    pressed: 'pressed(button)', message: 'message(name)', screen_tapped: 'screen_tapped(x, y)',
  };
  const HANDLER_ORDER = ['start', 'update', 'tapped', 'touching', 'pressed', 'message', 'screen_tapped'];

  /** Turns a list of stacks into Lua source. Event blocks of the same kind are merged into one handler. */
  function generate(stacks, opts) {
    const H = {};
    for (const h of HANDLER_ORDER) H[h] = [];
    for (const st of stacks || []) {
      const d = BY_ID[st && st.t];
      if (!d || d.kind !== 'hat') continue;
      const { a, r } = collectArgs(d, st, opts);
      const body = {};
      const lines = genStack(st.do, opts);
      body.do = lines.length === 0 && opts && opts.sample ? ['-- other blocks go here'] : lines;
      H[d.handler].push(...toLines(d.lua(a, r, body)));
    }
    const out = [];
    for (const h of HANDLER_ORDER) {
      if (H[h].length === 0) continue;
      out.push('function ' + HANDLER_SIG[h], ...I(H[h]), 'end', '');
    }
    return out.join('\n');
  }

  /** Lua code shown in the guide for one block, generated from the real code generator. */
  function sampleLua(def) {
    const ctx = { objects: ['Coin'], variables: ['score'] };
    const b = newBlock(def.id, ctx);
    const opts = { sample: true };
    if (def.kind === 'hat') return generate([b], opts).trim();
    if (def.kind === 'val' || def.kind === 'bool') return genExpr(b, opts);
    return genStack([b], opts).join('\n');
  }

  /** Walks every block (including nested ones) in a list of stacks. */
  function walk(stacks, fn) {
    const visit = (b, parent) => {
      if (!isBlock(b)) return;
      fn(b, parent);
      const d = BY_ID[b.t];
      if (!d) return;
      for (const s of argSpecs(d)) if (isBlock(b.a && b.a[s.k])) visit(b.a[s.k], b);
      for (const bn of bodiesOf(d)) for (const c of b[bn] || []) visit(c, b);
    };
    for (const st of stacks || []) visit(st, null);
  }

  const api = {
    CATS, BLOCKS, BY_ID, BUTTONS, SOUNDS, PROPS,
    argSpecs, bodiesOf, isBlock, newBlock, generate, genExpr, sampleLua, walk, luaStr, varRef,
  };
  root.CKL = Object.assign(root.CKL || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
