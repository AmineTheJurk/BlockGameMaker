// Tests for web/lua.js — run with: node tools/test_lua.js
const assert = require('assert');
const { Interp, LuaTable, LuaError } = require('../web/lua.js');

let passed = 0;
function run(src) {
  const I = new Interp();
  const out = [];
  I.onPrint = (s) => out.push(s);
  I.resetBudget(2e6);
  I.run(src, 'test');
  return out.join('\n');
}
function eq(name, src, expected) {
  let got;
  try { got = run(src); } catch (e) { got = 'ERR ' + e.message; }
  assert.strictEqual(got, expected, `${name}\n  got:      ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expected)}`);
  passed++;
}
function err(name, src, fragment) {
  let got = 'no error';
  try { run(src); } catch (e) { got = e.message; }
  assert.ok(got.includes(fragment), `${name}\n  got: ${got}\n  wanted fragment: ${fragment}`);
  passed++;
}

eq('arith', 'print(1+2*3, 10/4, 7%3, -7%3, 2^10, 7//2)', '7\t2.5\t1\t2\t1024\t3');
eq('strings', 'print("a".."b"..1 ..2, #"hello", ("x"):upper())', 'ab12\t5\tX');
eq('locals+if', 'local x=5 if x>3 then print("big") elseif x>1 then print("mid") else print("small") end', 'big');
eq('while+break', 'local i=0 while true do i=i+1 if i>=4 then break end end print(i)', '4');
eq('numeric for', 'local s=0 for i=1,10 do s=s+i end print(s)', '55');
eq('for step', 'for i=10,1,-3 do io=nil print(i) end', '10\n7\n4\n1');
eq('repeat scope', 'local n=0 repeat local k=n+1 n=k until k>=3 print(n)', '3');
eq('functions', 'local function fact(n) if n<=1 then return 1 end return n*fact(n-1) end print(fact(10))', '3628800');
eq('closures', 'local function mk() local c=0 return function() c=c+1 return c end end local a=mk() a() a() print(a())', '3');
eq('varargs', 'local function f(...) return select("#",...), ... end print(f(1,2,3))', '3\t1\t2\t3');
eq('tables', 'local t={10,20,30,x=1,["y z"]=2} print(#t, t[2], t.x, t["y z"])', '3\t20\t1\t2');
eq('table.insert/remove', 'local t={} table.insert(t,"a") table.insert(t,"b") table.insert(t,1,"z") print(table.concat(t,","), table.remove(t), #t)', 'z,a,b\tb\t2');
eq('pairs', 'local t={1,2,a=3} local n=0 for k,v in pairs(t) do n=n+v end print(n)', '6');
eq('ipairs', 'local s="" for i,v in ipairs({"a","b","c"}) do s=s..i..v end print(s)', '1a2b3c');
eq('sort', 'local t={3,1,2} table.sort(t) print(table.concat(t," ")) table.sort(t,function(a,b) return a>b end) print(table.concat(t," "))', '1 2 3\n3 2 1');
eq('methods', 'local o={v=2} function o:add(n) return self.v+n end print(o:add(5))', '7');
eq('metatables', 'local mt={__index=function(t,k) return k.."!" end} local t=setmetatable({},mt) print(t.foo)', 'foo!');
eq('__index table', 'local base={hi=1} local t=setmetatable({},{__index=base}) print(t.hi)', '1');
eq('__newindex', 'local log="" local t=setmetatable({},{__newindex=function(t,k,v) log=k end}) t.zzz=1 print(log, rawget(t,"zzz"))', 'zzz\tnil');
eq('pcall', 'print(pcall(function() error("boom") end))', 'false\ttest:1: boom');
eq('pcall ok', 'print(pcall(function(a) return a*2 end, 4))', 'true\t8');
eq('and/or', 'print(nil or "d", false and 1, 1 and 2, nil and nil)', 'd\tfalse\t2\tnil');
eq('compare', 'print(1<2, "a"<"b", 1==1.0, "1"==1, nil==false)', 'true\ttrue\ttrue\tfalse\tfalse');
eq('tostring numbers', 'print(5, 5.0, 0.1+0.2, 1e3, 2^53, 1/0, -1/0)', '5\t5\t0.3\t1000\t9007199254740992\tinf\t-inf');
eq('string.format', 'print(string.format("%d %5.2f %s %05d %x|%-4s|", 42, 3.14159, "hi", 7, 255, "ab"))', '42  3.14 hi 00007 ff|ab  |');
eq('string funcs', 'print(("hello"):sub(2,3), ("abc"):rep(2), ("a,b"):find(","), string.len("xyz"), ("Hi"):lower())', 'el\tabcabc\t2\t3\thi');
eq('math', 'print(math.floor(3.7), math.ceil(3.2), math.max(1,9,4), math.min(3,2), math.abs(-3), math.sqrt(16))', '3\t4\t9\t2\t3\t4');
eq('multi assign', 'local a,b=1,2 a,b=b,a print(a,b)', '2\t1');
eq('nested tables', 'local t={a={b={c=5}}} t.a.b.c=t.a.b.c+1 print(t.a.b.c)', '6');
eq('long string', 'print([[line1\nline2]])', 'line1\nline2');
eq('comment', '-- hi\nprint(1) --[[ block\n comment ]] print(2)', '1\n2');
eq('hex+escape', 'print(0xff, "a\\tb", "\\65")', '255\ta\tb\tA');
eq('goto-free nested break', 'for i=1,3 do for j=1,3 do if j==2 then break end print(i..j) end end', '11\n21\n31');
eq('upvalue per iteration', 'local fs={} for i=1,3 do fs[i]=function() return i end end print(fs[1](),fs[2](),fs[3]())', '1\t2\t3');
eq('env table', (() => '')(), '');

// env (per-object style) with __index fallthrough
{
  const I = new Interp();
  const env = new LuaTable();
  const mt = new LuaTable();
  mt.set('__index', I.globals);
  env.meta = mt;
  I.globals.set('shared', 7);
  I.run('function start() return shared + 1 end counter = 5', 'obj', env);
  assert.strictEqual(I.call(env.get('start'), [])[0], 8);
  assert.strictEqual(env.get('counter'), 5);
  assert.strictEqual(I.globals.get('counter'), undefined);
  passed++;
}

err('nil call', 'foo()', "attempt to call a nil value (global 'foo')");
err('nil index', 'local t=nil print(t.x)', "attempt to index a nil value (local 't')");
err('field call', 'local t={} t.go()', "attempt to call a nil value (field 'go')");
err('arith nil', 'local a print(a+1)', "attempt to perform arithmetic on a nil value (local 'a')");
err('concat nil', 'print("a"..nil)', 'attempt to concatenate a nil value');
err('compare', 'print(1<"x")', 'attempt to compare number with string');
err('syntax', 'if x then', "'end' expected");
err('syntax2', 'x = = 1', 'unexpected symbol');
err('unfinished', 'print("abc', 'unfinished string');
err('endless', 'while true do end', 'ran too long');
err('error with line', 'local x = 1\nerror("bad")', 'test:2: bad');
err('stack', 'local function f() return 1 + f() end f()', 'stack overflow');

// stack overflow is a RangeError internally; make sure it is converted by pcall
eq('pcall stack', 'local function f() return 1 + f() end print(pcall(f))', 'false\tstack overflow');
// budget errors cannot be swallowed by pcall
err('pcall budget', 'pcall(function() while true do end end)', 'ran too long');

console.log(`lua.js: ${passed} tests passed`);
