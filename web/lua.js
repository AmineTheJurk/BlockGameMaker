/* lua.js — a small Lua interpreter (Lua 5.1 style + // and integer-looking numbers) in plain JavaScript.
 * No dependencies. Works in browsers, Android WebView and Node.
 *
 * Supported: local/global variables, functions & closures, varargs, tables, metatables
 * (__index, __newindex, __call, __tostring), if/while/repeat/for (numeric + generic),
 * break, return, method calls (a:b()), string methods (("x"):upper()), pcall/error.
 * Standard library subset: base, math, string (no patterns), table, os.time/clock.
 * Not supported: goto, coroutines, Lua patterns (string.match/gmatch/gsub patterns), integer division of ints as ints.
 */
(function (root) {
  'use strict';

  class LuaError extends Error {
    constructor(msg, value) {
      super(msg);
      this.name = 'LuaError';
      this.luaValue = value === undefined ? msg : value;
    }
  }

  const isNil = (v) => v === undefined || v === null;
  const truthy = (v) => !(v === undefined || v === null || v === false);

  class LuaTable {
    constructor() { this.hash = new Map(); this.arr = []; this.meta = null; }
    get(k) {
      if (typeof k === 'number') {
        if (Number.isInteger(k) && k >= 1 && k <= this.arr.length) return this.arr[k - 1];
      } else if (k === undefined || k === null) return undefined;
      return this.hash.get(k);
    }
    set(k, v) {
      if (k === undefined || k === null) throw new LuaError('table index is nil');
      if (typeof k === 'number') {
        if (Number.isNaN(k)) throw new LuaError('table index is NaN');
        if (Number.isInteger(k) && k >= 1) {
          const n = this.arr.length;
          if (k <= n) {
            if (isNil(v)) {
              if (k === n) {
                this.arr.pop();
                while (this.arr.length && this.arr[this.arr.length - 1] === undefined) this.arr.pop();
              } else this.arr[k - 1] = undefined;
            } else this.arr[k - 1] = v;
            return;
          }
          if (k === n + 1) {
            if (isNil(v)) { this.hash.delete(k); return; }
            this.arr.push(v);
            this.hash.delete(k);
            let nk = k + 1;
            while (this.hash.has(nk)) { this.arr.push(this.hash.get(nk)); this.hash.delete(nk); nk++; }
            return;
          }
        }
      }
      if (isNil(v)) this.hash.delete(k); else this.hash.set(k, v);
    }
    length() { return this.arr.length; }
    keys() {
      const out = [];
      for (let i = 0; i < this.arr.length; i++) if (this.arr[i] !== undefined) out.push(i + 1);
      for (const k of this.hash.keys()) out.push(k);
      return out;
    }
  }

  function typeName(v) {
    if (isNil(v)) return 'nil';
    switch (typeof v) {
      case 'boolean': return 'boolean';
      case 'number': return 'number';
      case 'string': return 'string';
      case 'function': return 'function';
    }
    return v instanceof LuaTable ? 'table' : 'userdata';
  }

  function fmtNum(n) {
    if (Number.isInteger(n)) return Math.abs(n) < 1e15 ? String(n === 0 ? 0 : n) : String(n);
    if (n !== n) return 'nan';
    if (n === Infinity) return 'inf';
    if (n === -Infinity) return '-inf';
    return String(parseFloat(n.toPrecision(14)));
  }

  const ids = new WeakMap();
  let idCounter = 0x1000;
  function addrOf(o) {
    if (!ids.has(o)) ids.set(o, (idCounter += 0x28));
    return '0x' + ids.get(o).toString(16).padStart(8, '0');
  }

  function tostr(interp, v) {
    if (isNil(v)) return 'nil';
    switch (typeof v) {
      case 'boolean': return v ? 'true' : 'false';
      case 'number': return fmtNum(v);
      case 'string': return v;
      case 'function': return 'function: ' + addrOf(v);
    }
    if (v instanceof LuaTable) {
      if (v.meta) {
        const h = v.meta.get('__tostring');
        if (typeof h === 'function') return tostr(interp, (h([v])[0]));
      }
      return 'table: ' + addrOf(v);
    }
    return String(v);
  }

  const NUM_RE = /^\s*[-+]?(?:0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)\s*$/;
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && NUM_RE.test(v)) {
      const s = v.trim();
      if (/^[-+]?0[xX]/.test(s)) return s[0] === '-' ? -parseInt(s.slice(3), 16) : parseInt(s.replace(/^\+?0[xX]/, ''), 16);
      return Number(s);
    }
    return undefined;
  }

  // ---------------------------------------------------------------- Lexer
  const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in',
    'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);

  function lex(src, chunk) {
    const toks = [];
    let i = 0, line = 1;
    const n = src.length;
    const err = (m) => { throw new LuaError(`${chunk}:${line}: ${m}`); };
    const isDigit = (c) => c >= '0' && c <= '9';
    const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
    const longLevel = () => { let j = i + 1, l = 0; while (src[j] === '=') { l++; j++; } return src[j] === '[' ? l : -1; };
    const readLong = (lvl) => {
      i += lvl + 2;
      if (src[i] === '\r') i++;
      if (src[i] === '\n') { line++; i++; }
      const close = ']' + '='.repeat(lvl) + ']';
      const end = src.indexOf(close, i);
      if (end < 0) err('unfinished long string/comment');
      const s = src.slice(i, end);
      for (const ch of s) if (ch === '\n') line++;
      i = end + close.length;
      return s;
    };
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
      if (c === '-' && src[i + 1] === '-') {
        i += 2;
        if (src[i] === '[') { const l = longLevel(); if (l >= 0) { readLong(l); continue; } }
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      const startLine = line;
      if (isAlpha(c)) {
        let j = i + 1;
        while (j < n && (isAlpha(src[j]) || isDigit(src[j]))) j++;
        const w = src.slice(i, j); i = j;
        toks.push({ t: KEYWORDS.has(w) ? 'kw' : 'name', v: w, line: startLine });
        continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
        let j = i, v;
        if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
          j = i + 2;
          while (/[0-9a-fA-F]/.test(src[j] || '')) j++;
          v = parseInt(src.slice(i + 2, j), 16);
        } else {
          while (isDigit(src[j] || '')) j++;
          if (src[j] === '.') { j++; while (isDigit(src[j] || '')) j++; }
          if (src[j] === 'e' || src[j] === 'E') {
            let k = j + 1;
            if (src[k] === '+' || src[k] === '-') k++;
            if (isDigit(src[k] || '')) { j = k; while (isDigit(src[j] || '')) j++; }
          }
          v = Number(src.slice(i, j));
        }
        if (isAlpha(src[j] || '')) err(`malformed number near '${src.slice(i, j + 1)}'`);
        i = j;
        toks.push({ t: 'num', v, line: startLine });
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c; i++;
        let s = '';
        for (;;) {
          if (i >= n || src[i] === '\n') err('unfinished string');
          const ch = src[i];
          if (ch === q) { i++; break; }
          if (ch === '\\') {
            i++;
            const e = src[i];
            const map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
            if (e === '\n') { line++; s += '\n'; i++; }
            else if (e in map) { s += map[e]; i++; }
            else if (isDigit(e)) {
              let d = '';
              while (d.length < 3 && isDigit(src[i] || '')) d += src[i++];
              s += String.fromCharCode(parseInt(d, 10));
            } else if (e === 'x') {
              s += String.fromCharCode(parseInt(src.substr(i + 1, 2), 16)); i += 3;
            } else err('invalid escape sequence');
          } else { s += ch; i++; }
        }
        toks.push({ t: 'str', v: s, line: startLine });
        continue;
      }
      if (c === '[') {
        const l = longLevel();
        if (l >= 0) { const s = readLong(l); toks.push({ t: 'str', v: s, line: startLine }); continue; }
      }
      const three = src.substr(i, 3);
      if (three === '...') { toks.push({ t: 'op', v: '...', line }); i += 3; continue; }
      const two = src.substr(i, 2);
      if (two === '==' || two === '~=' || two === '<=' || two === '>=' || two === '..' || two === '//') {
        toks.push({ t: 'op', v: two, line }); i += 2; continue;
      }
      if ('+-*/%^#<>=(){}[];:,.'.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
      err(`unexpected symbol near '${c}'`);
    }
    toks.push({ t: 'eof', v: '<eof>', line });
    return toks;
  }

  // ---------------------------------------------------------------- Parser
  const BINPRI = {
    'or': [1, 1], 'and': [2, 2],
    '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
    '..': [5, 4], '+': [6, 6], '-': [6, 6],
    '*': [7, 7], '/': [7, 7], '%': [7, 7], '//': [7, 7], '^': [10, 9],
  };
  const UNARY_PRI = 8;

  class Parser {
    constructor(toks, chunk) { this.toks = toks; this.p = 0; this.chunk = chunk; }
    get tok() { return this.toks[this.p]; }
    err(msg, tok) {
      tok = tok || this.tok;
      throw new LuaError(`${this.chunk}:${tok.line}: ${msg} near ${tok.t === 'eof' ? '<eof>' : "'" + tok.v + "'"}`);
    }
    check(v) { const t = this.tok; return (t.t === 'op' || t.t === 'kw') && t.v === v; }
    accept(v) { if (this.check(v)) { this.p++; return true; } return false; }
    expect(v, closing, openLine) {
      if (this.accept(v)) return;
      let m = `'${v}' expected`;
      if (closing && openLine && openLine !== this.tok.line) m += ` (to close '${closing}' at line ${openLine})`;
      this.err(m);
    }
    name() { const t = this.tok; if (t.t !== 'name') this.err('<name> expected'); this.p++; return t.v; }
    blockFollow() {
      const t = this.tok;
      return t.t === 'eof' || (t.t === 'kw' && (t.v === 'end' || t.v === 'else' || t.v === 'elseif' || t.v === 'until'));
    }
    chunkAst() {
      const body = this.block();
      if (this.tok.t !== 'eof') this.err("'<eof>' expected");
      return { type: 'Chunk', body, chunk: this.chunk };
    }
    block() {
      const stmts = [];
      let scoped = false;
      while (!this.blockFollow()) {
        if (this.check('return')) {
          const line = this.tok.line; this.p++;
          let exprs = [];
          if (!this.blockFollow() && !this.check(';')) exprs = this.exprList();
          this.accept(';');
          stmts.push({ type: 'Return', exprs, line });
          break;
        }
        const st = this.statement();
        if (st) { stmts.push(st); if (st.type === 'Local' || st.type === 'LocalFunc') scoped = true; }
      }
      return { stmts, scoped };
    }
    statement() {
      const t = this.tok, line = t.line;
      if (t.t === 'op' && t.v === ';') { this.p++; return null; }
      if (t.t === 'kw') {
        switch (t.v) {
          case 'if': return this.ifStat();
          case 'while': {
            this.p++;
            const cond = this.expr();
            this.expect('do');
            const body = this.block();
            this.expect('end', 'while', line);
            return { type: 'While', cond, body, line };
          }
          case 'do': {
            this.p++;
            const body = this.block();
            this.expect('end', 'do', line);
            return { type: 'Do', body, line };
          }
          case 'for': return this.forStat();
          case 'repeat': {
            this.p++;
            const body = this.block();
            this.expect('until', 'repeat', line);
            const cond = this.expr();
            return { type: 'Repeat', body, cond, line };
          }
          case 'function': {
            this.p++;
            let target = { type: 'Name', name: this.name(), line };
            let isMethod = false;
            while (this.check('.') || this.check(':')) {
              const colon = this.check(':');
              this.p++;
              const key = { type: 'Str', v: this.name(), line };
              target = { type: 'Index', obj: target, key, line };
              if (colon) { isMethod = true; break; }
            }
            const fn = this.funcBody(isMethod, line);
            fn.name = target.type === 'Name' ? target.name : (target.key.v);
            return { type: 'Assign', targets: [target], exprs: [fn], line };
          }
          case 'local': {
            this.p++;
            if (this.accept('function')) {
              const name = this.name();
              const fn = this.funcBody(false, line);
              fn.name = name;
              return { type: 'LocalFunc', name, fn, line };
            }
            const names = [this.name()];
            while (this.accept(',')) names.push(this.name());
            let exprs = [];
            if (this.accept('=')) exprs = this.exprList();
            return { type: 'Local', names, exprs, line };
          }
          case 'break': this.p++; return { type: 'Break', line };
        }
      }
      const e = this.suffixedExp();
      if (this.check('=') || this.check(',')) {
        const targets = [e];
        while (this.accept(',')) targets.push(this.suffixedExp());
        this.expect('=');
        const exprs = this.exprList();
        for (const tg of targets) if (tg.type !== 'Name' && tg.type !== 'Index') this.err('syntax error');
        return { type: 'Assign', targets, exprs, line };
      }
      if (e.type !== 'Call' && e.type !== 'Method') this.err('syntax error');
      return { type: 'CallStmt', expr: e, line };
    }
    ifStat() {
      const line = this.tok.line;
      const clauses = [];
      let orelse = null;
      this.p++;
      let cond = this.expr();
      this.expect('then');
      clauses.push({ cond, body: this.block() });
      for (;;) {
        if (this.accept('elseif')) {
          cond = this.expr();
          this.expect('then');
          clauses.push({ cond, body: this.block() });
        } else if (this.accept('else')) {
          orelse = this.block();
          this.expect('end', 'if', line);
          break;
        } else { this.expect('end', 'if', line); break; }
      }
      return { type: 'If', clauses, orelse, line };
    }
    forStat() {
      const line = this.tok.line;
      this.p++;
      const n1 = this.name();
      if (this.accept('=')) {
        const start = this.expr();
        this.expect(',');
        const stop = this.expr();
        const step = this.accept(',') ? this.expr() : null;
        this.expect('do');
        const body = this.block();
        this.expect('end', 'for', line);
        return { type: 'NumFor', name: n1, start, stop, step, body, line };
      }
      const names = [n1];
      while (this.accept(',')) names.push(this.name());
      this.expect('in');
      const exprs = this.exprList();
      this.expect('do');
      const body = this.block();
      this.expect('end', 'for', line);
      return { type: 'GenFor', names, exprs, body, line };
    }
    funcBody(isMethod, line) {
      const params = isMethod ? ['self'] : [];
      let vararg = false;
      this.expect('(');
      if (!this.check(')')) {
        do {
          if (this.accept('...')) { vararg = true; break; }
          params.push(this.name());
        } while (this.accept(','));
      }
      this.expect(')');
      const body = this.block();
      this.expect('end', 'function', line);
      return { type: 'Func', params, vararg, body, line, name: null };
    }
    exprList() {
      const l = [this.expr()];
      while (this.accept(',')) l.push(this.expr());
      return l;
    }
    expr() { return this.subexpr(0); }
    subexpr(limit) {
      let left;
      const t = this.tok;
      if ((t.t === 'kw' && t.v === 'not') || (t.t === 'op' && (t.v === '-' || t.v === '#'))) {
        this.p++;
        const e = this.subexpr(UNARY_PRI);
        left = (t.v === '-' && e.type === 'Num') ? { type: 'Num', v: -e.v, line: t.line } : { type: 'Un', op: t.v, e, line: t.line };
      } else left = this.simple();
      for (;;) {
        const o = this.tok;
        if (o.t !== 'op' && o.t !== 'kw') break;
        const pri = BINPRI[o.v];
        if (!pri || pri[0] <= limit) break;
        this.p++;
        const right = this.subexpr(pri[1]);
        left = { type: (o.v === 'and' || o.v === 'or') ? 'Logic' : 'Bin', op: o.v, l: left, r: right, line: o.line };
      }
      return left;
    }
    simple() {
      const t = this.tok;
      switch (t.t) {
        case 'num': this.p++; return { type: 'Num', v: t.v, line: t.line };
        case 'str': this.p++; return { type: 'Str', v: t.v, line: t.line };
        case 'kw':
          if (t.v === 'nil') { this.p++; return { type: 'Nil', line: t.line }; }
          if (t.v === 'true') { this.p++; return { type: 'True', line: t.line }; }
          if (t.v === 'false') { this.p++; return { type: 'False', line: t.line }; }
          if (t.v === 'function') { this.p++; return this.funcBody(false, t.line); }
          break;
        case 'op':
          if (t.v === '...') { this.p++; return { type: 'Vararg', line: t.line }; }
          if (t.v === '{') return this.tableCons();
          break;
      }
      return this.suffixedExp();
    }
    primaryExp() {
      const t = this.tok;
      if (t.t === 'name') { this.p++; return { type: 'Name', name: t.v, line: t.line }; }
      if (t.t === 'op' && t.v === '(') {
        this.p++;
        const e = this.expr();
        this.expect(')', '(', t.line);
        return { type: 'Paren', e, line: t.line };
      }
      this.err('unexpected symbol');
    }
    suffixedExp() {
      let e = this.primaryExp();
      for (;;) {
        const t = this.tok;
        if (t.t === 'op') {
          if (t.v === '.') { this.p++; e = { type: 'Index', obj: e, key: { type: 'Str', v: this.name(), line: t.line }, line: t.line }; continue; }
          if (t.v === '[') { this.p++; const k = this.expr(); this.expect(']'); e = { type: 'Index', obj: e, key: k, line: t.line }; continue; }
          if (t.v === ':') { this.p++; const name = this.name(); const args = this.callArgs(); e = { type: 'Method', obj: e, name, args, line: t.line }; continue; }
          if (t.v === '(' || t.v === '{') { const args = this.callArgs(); e = { type: 'Call', fn: e, args, line: t.line }; continue; }
        } else if (t.t === 'str') { const args = this.callArgs(); e = { type: 'Call', fn: e, args, line: t.line }; continue; }
        return e;
      }
    }
    callArgs() {
      const t = this.tok;
      if (t.t === 'str') { this.p++; return [{ type: 'Str', v: t.v, line: t.line }]; }
      if (t.t === 'op' && t.v === '{') return [this.tableCons()];
      if (t.t === 'op' && t.v === '(') {
        this.p++;
        if (this.accept(')')) return [];
        const l = this.exprList();
        this.expect(')', '(', t.line);
        return l;
      }
      this.err('function arguments expected');
    }
    tableCons() {
      const line = this.tok.line;
      this.expect('{');
      const fields = [];
      while (!this.check('}')) {
        if (this.check('[')) {
          this.p++;
          const k = this.expr();
          this.expect(']');
          this.expect('=');
          fields.push({ kind: 'keyed', k, v: this.expr() });
        } else if (this.tok.t === 'name' && this.toks[this.p + 1].t === 'op' && this.toks[this.p + 1].v === '=') {
          const k = { type: 'Str', v: this.tok.v, line: this.tok.line };
          this.p += 2;
          fields.push({ kind: 'keyed', k, v: this.expr() });
        } else fields.push({ kind: 'pos', v: this.expr() });
        if (!this.accept(',') && !this.accept(';')) break;
      }
      this.expect('}', '{', line);
      return { type: 'Table', fields, line };
    }
  }

  // ---------------------------------------------------------------- Interpreter
  const BREAK = { brk: true };

  class Scope {
    constructor(parent, env) {
      this.v = new Map();
      this.parent = parent || null;
      this.env = env || (parent ? parent.env : null);
      this.chunk = parent ? parent.chunk : null;
      this.varargs = parent ? parent.varargs : null;
    }
    lookup(name) {
      for (let s = this; s; s = s.parent) if (s.v.has(name)) return s;
      return null;
    }
  }

  class Interp {
    constructor() {
      this.steps = 0;
      this.limit = Infinity;
      this.line = 0;
      this.chunk = '?';
      this.onPrint = (s) => { if (typeof console !== 'undefined') console.log(s); };
      this.globals = new LuaTable();
      installStdlib(this);
    }

    // ----- public API
    compile(src, chunk) {
      chunk = chunk || 'chunk';
      return new Parser(lex(String(src), chunk), chunk).chunkAst();
    }
    runChunk(ast, env) {
      const s = new Scope(null, env || this.globals);
      s.chunk = ast.chunk;
      s.varargs = [];
      try {
        const r = this.execStmts(ast.body.stmts, s);
        return (r && r.ret) || [];
      } catch (e) { throw this.wrapJsError(e); }
    }
    run(src, chunk, env) { return this.runChunk(this.compile(src, chunk), env); }
    call(f, args) {
      try { return this.callValue(f, args || [], null, null); }
      catch (e) { throw this.wrapJsError(e); }
    }
    // A JS stack overflow (a Lua function calling itself forever) becomes a normal, readable Lua error.
    wrapJsError(e) {
      if (e instanceof RangeError) {
        const le = new LuaError(`${this.chunk}:${this.line}: stack overflow (does a function call itself forever?)`);
        le.fatal = true;
        return le;
      }
      return e;
    }
    resetBudget(limit) { this.steps = 0; this.limit = limit === undefined ? Infinity : limit; }

    // ----- errors
    rtErr(msg) { throw new LuaError(`${this.chunk}:${this.line}: ${msg}`); }
    describe(node, scope) {
      if (!node) return '';
      if (node.type === 'Name') return scope && scope.lookup(node.name) ? ` (local '${node.name}')` : ` (global '${node.name}')`;
      if (node.type === 'Index' && node.key.type === 'Str') return ` (field '${node.key.v}')`;
      if (node.type === 'Method') return ` (method '${node.name}')`;
      return '';
    }
    tick() {
      if (++this.steps > this.limit) {
        const e = new LuaError(`${this.chunk}:${this.line}: script ran too long (is there an endless loop?)`);
        e.fatal = true;
        throw e;
      }
    }

    // ----- metatable-aware access
    index(o, k, node, scope) {
      if (o instanceof LuaTable) {
        const v = o.get(k);
        if (v !== undefined) return v;
        const mt = o.meta;
        if (!mt) return undefined;
        const h = mt.get('__index');
        if (h === undefined) return undefined;
        if (typeof h === 'function') return h([o, k])[0];
        return this.index(h, k);
      }
      if (typeof o === 'string') return this.globals.get('string') instanceof LuaTable ? this.globals.get('string').get(k) : undefined;
      this.rtErr(`attempt to index a ${typeName(o)} value${this.describe(node, scope)}`);
    }
    setindex(o, k, v, node, scope) {
      if (o instanceof LuaTable) {
        const mt = o.meta;
        if (mt && o.get(k) === undefined) {
          const h = mt.get('__newindex');
          if (h !== undefined) {
            if (typeof h === 'function') { h([o, k, v]); return; }
            this.setindex(h, k, v); return;
          }
        }
        try { o.set(k, v); } catch (e) { if (e instanceof LuaError && !/^.*:\d+:/.test(e.message)) this.rtErr(e.message); throw e; }
        return;
      }
      this.rtErr(`attempt to index a ${typeName(o)} value${this.describe(node, scope)}`);
    }
    callValue(f, args, node, scope) {
      if (typeof f === 'function') return f(args);
      if (f instanceof LuaTable && f.meta) {
        const h = f.meta.get('__call');
        if (typeof h === 'function') return h([f].concat(args));
      }
      this.rtErr(`attempt to call a ${typeName(f)} value${this.describe(node, scope)}`);
    }

    // ----- statements
    execStmts(stmts, scope) {
      for (let i = 0; i < stmts.length; i++) {
        const r = this.exec(stmts[i], scope);
        if (r !== undefined) return r;
      }
      return undefined;
    }
    runBody(body, scope) {
      return this.execStmts(body.stmts, body.scoped ? new Scope(scope) : scope);
    }
    exec(st, scope) {
      this.line = st.line;
      this.chunk = scope.chunk;
      this.tick();
      switch (st.type) {
        case 'CallStmt': this.evMulti(st.expr, scope); return undefined;
        case 'Local': {
          const vals = this.evList(st.exprs, scope);
          for (let i = 0; i < st.names.length; i++) scope.v.set(st.names[i], vals[i]);
          return undefined;
        }
        case 'LocalFunc':
          scope.v.set(st.name, undefined);
          scope.v.set(st.name, this.makeFunc(st.fn, scope));
          return undefined;
        case 'Assign': {
          if (st.targets.length === 1 && st.exprs.length === 1) {
            this.assign(st.targets[0], this.ev(st.exprs[0], scope), scope);
            return undefined;
          }
          const vals = this.evList(st.exprs, scope);
          for (let i = 0; i < st.targets.length; i++) this.assign(st.targets[i], vals[i], scope);
          return undefined;
        }
        case 'Return': {
          if (st.exprs.length === 1 && st.exprs[0].type === 'Call') return { ret: this.evMulti(st.exprs[0], scope) };
          return { ret: this.evList(st.exprs, scope) };
        }
        case 'Break': return BREAK;
        case 'Do': return this.runBody(st.body, scope);
        case 'If': {
          for (const c of st.clauses) {
            if (truthy(this.ev(c.cond, scope))) return this.runBody(c.body, scope);
          }
          if (st.orelse) return this.runBody(st.orelse, scope);
          return undefined;
        }
        case 'While': {
          while (truthy(this.ev(st.cond, scope))) {
            this.tick();
            const r = this.runBody(st.body, scope);
            if (r !== undefined) { if (r === BREAK) break; return r; }
          }
          return undefined;
        }
        case 'Repeat': {
          for (;;) {
            this.tick();
            const s = new Scope(scope);
            const r = this.execStmts(st.body.stmts, s);
            if (r !== undefined) { if (r === BREAK) break; return r; }
            if (truthy(this.ev(st.cond, s))) break;
          }
          return undefined;
        }
        case 'NumFor': {
          const a = this.forNum(this.ev(st.start, scope), 'initial');
          const b = this.forNum(this.ev(st.stop, scope), 'limit');
          const c = st.step ? this.forNum(this.ev(st.step, scope), 'step') : 1;
          if (c === 0) this.rtErr("'for' step is zero");
          for (let i = a; c > 0 ? i <= b : i >= b; i += c) {
            this.tick();
            const s = new Scope(scope);
            s.v.set(st.name, i);
            const r = this.runBody(st.body, s);
            if (r !== undefined) { if (r === BREAK) break; return r; }
          }
          return undefined;
        }
        case 'GenFor': {
          const init = this.evList(st.exprs, scope);
          const f = init[0], state = init[1];
          let ctl = init[2];
          for (;;) {
            this.tick();
            const rs = this.callValue(f, [state, ctl], null, scope);
            if (rs[0] === undefined || rs[0] === null) break;
            ctl = rs[0];
            const s = new Scope(scope);
            for (let i = 0; i < st.names.length; i++) s.v.set(st.names[i], rs[i]);
            const r = this.runBody(st.body, s);
            if (r !== undefined) { if (r === BREAK) break; return r; }
          }
          return undefined;
        }
      }
      throw new Error('bad statement ' + st.type);
    }
    forNum(v, what) {
      const n = toNumber(v);
      if (n === undefined) this.rtErr(`'for' ${what} value must be a number`);
      return n;
    }
    assign(target, val, scope) {
      if (target.type === 'Name') {
        const s = scope.lookup(target.name);
        if (s) s.v.set(target.name, val);
        else this.setindex(scope.env, target.name, val);
      } else {
        const o = this.ev(target.obj, scope);
        const k = this.ev(target.key, scope);
        this.setindex(o, k, val, target.obj, scope);
      }
    }

    // ----- expressions
    evList(nodes, scope) {
      const n = nodes.length;
      if (n === 0) return [];
      if (n === 1) {
        const t = nodes[0].type;
        if (t === 'Call' || t === 'Method' || t === 'Vararg') return this.evMulti(nodes[0], scope);
        return [this.ev(nodes[0], scope)];
      }
      const out = [];
      for (let i = 0; i < n - 1; i++) out.push(this.ev(nodes[i], scope));
      const last = nodes[n - 1];
      if (last.type === 'Call' || last.type === 'Method' || last.type === 'Vararg') {
        const m = this.evMulti(last, scope);
        for (let i = 0; i < m.length; i++) out.push(m[i]);
      } else out.push(this.ev(last, scope));
      return out;
    }
    evMulti(node, scope) {
      switch (node.type) {
        case 'Call': {
          const f = this.ev(node.fn, scope);
          const args = this.evList(node.args, scope);
          this.line = node.line;
          return this.callValue(f, args, node.fn, scope);
        }
        case 'Method': {
          const o = this.ev(node.obj, scope);
          const args = this.evList(node.args, scope);
          this.line = node.line;
          const f = this.index(o, node.name, node.obj, scope);
          if (typeof f !== 'function' && !(f instanceof LuaTable)) this.rtErr(`attempt to call a ${typeName(f)} value (method '${node.name}')`);
          return this.callValue(f, [o].concat(args), node, scope);
        }
        case 'Vararg': return (scope.varargs || []).slice();
        default: return [this.ev(node, scope)];
      }
    }
    ev(node, scope) {
      switch (node.type) {
        case 'Num': case 'Str': return node.v;
        case 'Nil': return undefined;
        case 'True': return true;
        case 'False': return false;
        case 'Name': {
          const s = scope.lookup(node.name);
          if (s) return s.v.get(node.name);
          return this.index(scope.env, node.name);
        }
        case 'Paren': return this.ev(node.e, scope);
        case 'Index': {
          const o = this.ev(node.obj, scope);
          const k = this.ev(node.key, scope);
          this.line = node.line;
          return this.index(o, k, node.obj, scope);
        }
        case 'Call': case 'Method': return this.evMulti(node, scope)[0];
        case 'Vararg': return (scope.varargs || [])[0];
        case 'Func': return this.makeFunc(node, scope);
        case 'Logic': {
          const l = this.ev(node.l, scope);
          if (node.op === 'and') return truthy(l) ? this.ev(node.r, scope) : l;
          return truthy(l) ? l : this.ev(node.r, scope);
        }
        case 'Un': {
          const v = this.ev(node.e, scope);
          this.line = node.line;
          if (node.op === 'not') return !truthy(v);
          if (node.op === '-') {
            const n = toNumber(v);
            if (n === undefined) this.rtErr(`attempt to perform arithmetic on a ${typeName(v)} value${this.describe(node.e, scope)}`);
            return -n;
          }
          if (typeof v === 'string') return v.length;
          if (v instanceof LuaTable) return v.length();
          this.rtErr(`attempt to get length of a ${typeName(v)} value${this.describe(node.e, scope)}`);
          break;
        }
        case 'Bin': return this.binop(node, scope);
        case 'Table': {
          const t = new LuaTable();
          const fields = node.fields;
          for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            if (f.kind === 'pos') {
              if (i === fields.length - 1 && (f.v.type === 'Call' || f.v.type === 'Method' || f.v.type === 'Vararg')) {
                const m = this.evMulti(f.v, scope);
                for (const x of m) t.set(t.length() + 1, x);
              } else {
                const v = this.ev(f.v, scope);
                t.set(t.length() + 1, v);
              }
            } else {
              const k = this.ev(f.k, scope);
              const v = this.ev(f.v, scope);
              this.line = node.line;
              if (isNil(k)) this.rtErr('table index is nil');
              t.set(k, v);
            }
          }
          return t;
        }
      }
      throw new Error('bad expression ' + node.type);
    }
    binop(node, scope) {
      const a = this.ev(node.l, scope);
      const b = this.ev(node.r, scope);
      this.line = node.line;
      switch (node.op) {
        case '==': return a === b || (isNil(a) && isNil(b));
        case '~=': return !(a === b || (isNil(a) && isNil(b)));
        case '<': case '>': case '<=': case '>=': {
          let x = a, y = b;
          if (typeof x === 'number' && typeof y === 'number') { /* fast path */ }
          else if (typeof x === 'string' && typeof y === 'string') { /* string compare */ }
          else this.rtErr(`attempt to compare ${typeName(a)} with ${typeName(b)}`);
          switch (node.op) {
            case '<': return x < y;
            case '>': return x > y;
            case '<=': return x <= y;
            default: return x >= y;
          }
        }
        case '..': {
          const ta = typeof a, tb = typeof b;
          if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) return (ta === 'number' ? fmtNum(a) : a) + (tb === 'number' ? fmtNum(b) : b);
          const bad = (ta !== 'string' && ta !== 'number') ? node.l : node.r;
          const badv = (ta !== 'string' && ta !== 'number') ? a : b;
          this.rtErr(`attempt to concatenate a ${typeName(badv)} value${this.describe(bad, scope)}`);
          break;
        }
        default: {
          const x = typeof a === 'number' ? a : toNumber(a);
          const y = typeof b === 'number' ? b : toNumber(b);
          if (x === undefined) this.rtErr(`attempt to perform arithmetic on a ${typeName(a)} value${this.describe(node.l, scope)}`);
          if (y === undefined) this.rtErr(`attempt to perform arithmetic on a ${typeName(b)} value${this.describe(node.r, scope)}`);
          switch (node.op) {
            case '+': return x + y;
            case '-': return x - y;
            case '*': return x * y;
            case '/': return x / y;
            case '%': return y === 0 ? NaN : x - Math.floor(x / y) * y;
            case '//': return Math.floor(x / y);
            case '^': return Math.pow(x, y);
          }
        }
      }
      throw new Error('bad operator ' + node.op);
    }
    makeFunc(node, scope) {
      const interp = this;
      const params = node.params, np = params.length;
      const f = function (args) {
        const s = new Scope(scope);
        for (let i = 0; i < np; i++) s.v.set(params[i], args[i]);
        s.varargs = node.vararg ? args.slice(np) : null;
        const r = interp.execStmts(node.body.stmts, s);
        return (r && r.ret) || [];
      };
      f.luaName = node.name;
      return f;
    }
  }

  // ---------------------------------------------------------------- Standard library
  function installStdlib(I) {
    const G = I.globals;
    const lib = (name) => { const t = new LuaTable(); G.set(name, t); return t; };
    const reg = (t, name, fn) => t.set(name, fn);
    const argErr = (n, fname, expected, got) => I.rtErr(`bad argument #${n} to '${fname}' (${expected} expected, got ${got === undefined ? 'no value' : typeName(got)})`);
    const num = (v, n, fname) => { const x = toNumber(v); if (x === undefined) argErr(n, fname, 'number', v); return x; };
    const str = (v, n, fname) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return fmtNum(v);
      return argErr(n, fname, 'string', v);
    };
    const tbl = (v, n, fname) => { if (!(v instanceof LuaTable)) argErr(n, fname, 'table', v); return v; };

    G.set('_G', G);
    G.set('_VERSION', 'Lua 5.1 (CKL)');
    reg(G, 'print', (a) => { I.onPrint(a.map((v) => tostr(I, v)).join('\t')); return []; });
    reg(G, 'type', (a) => { if (a.length === 0) argErr(1, 'type', 'value'); return [typeName(a[0])]; });
    reg(G, 'tostring', (a) => [tostr(I, a[0])]);
    reg(G, 'tonumber', (a) => {
      if (a[1] !== undefined) {
        const b = num(a[1], 2, 'tonumber');
        const s = String(a[0]).trim().toLowerCase();
        const re = new RegExp('^[-+]?[' + '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, b) + ']+$');
        return [re.test(s) ? parseInt(s, b) : undefined];
      }
      return [toNumber(a[0])];
    });
    reg(G, 'rawget', (a) => [tbl(a[0], 1, 'rawget').get(a[1])]);
    reg(G, 'rawset', (a) => { tbl(a[0], 1, 'rawset').set(a[1], a[2]); return [a[0]]; });
    reg(G, 'rawequal', (a) => [a[0] === a[1]]);
    reg(G, 'rawlen', (a) => [a[0] instanceof LuaTable ? a[0].length() : String(a[0]).length]);
    reg(G, 'setmetatable', (a) => {
      tbl(a[0], 1, 'setmetatable');
      if (!isNil(a[1]) && !(a[1] instanceof LuaTable)) argErr(2, 'setmetatable', 'nil or table', a[1]);
      a[0].meta = isNil(a[1]) ? null : a[1];
      return [a[0]];
    });
    reg(G, 'getmetatable', (a) => [a[0] instanceof LuaTable ? (a[0].meta || undefined) : undefined]);
    reg(G, 'assert', (a) => {
      if (!truthy(a[0])) throw new LuaError(a[1] !== undefined ? tostr(I, a[1]) : 'assertion failed!', a[1]);
      return a;
    });
    reg(G, 'error', (a) => {
      const level = a[1] === undefined ? 1 : a[1];
      if (typeof a[0] === 'string' && level !== 0) throw new LuaError(`${I.chunk}:${I.line}: ${a[0]}`, `${I.chunk}:${I.line}: ${a[0]}`);
      throw new LuaError(tostr(I, a[0]), a[0]);
    });
    reg(G, 'pcall', (a) => {
      if (a.length === 0) argErr(1, 'pcall', 'value');
      try { return [true].concat(I.callValue(a[0], a.slice(1), null, null)); }
      catch (e) {
        if (e instanceof LuaError && !e.fatal) return [false, e.luaValue];
        if (e instanceof RangeError) return [false, 'stack overflow'];
        throw e;
      }
    });
    reg(G, 'select', (a) => {
      if (a[0] === '#') return [a.length - 1];
      let n = num(a[0], 1, 'select');
      if (n < 0) n = a.length + n; else n = n;
      if (n < 1) argErr(1, 'select', 'index out of range');
      return a.slice(n);
    });
    const iterNext = (t) => {
      const keys = t.keys(); let i = 0;
      return [(() => {
        while (i < keys.length) {
          const k = keys[i++];
          const v = t.get(k);
          if (v !== undefined) return [k, v];
        }
        return [undefined];
      }), t, undefined];
    };
    reg(G, 'pairs', (a) => {
      const t = tbl(a[0], 1, 'pairs');
      const [f] = iterNext(t);
      return [f, t, undefined];
    });
    reg(G, 'next', (a) => {
      const t = tbl(a[0], 1, 'next');
      const keys = t.keys();
      let i = a[1] === undefined ? 0 : keys.indexOf(a[1]) + 1;
      for (; i < keys.length; i++) { const v = t.get(keys[i]); if (v !== undefined) return [keys[i], v]; }
      return [undefined];
    });
    reg(G, 'ipairs', (a) => {
      const t = tbl(a[0], 1, 'ipairs');
      return [(args) => { const i = args[1] + 1; const v = I.index(t, i); return v === undefined ? [undefined] : [i, v]; }, t, 0];
    });
    const unpack = (a) => {
      const t = tbl(a[0], 1, 'unpack');
      const i = a[1] === undefined ? 1 : num(a[1], 2, 'unpack');
      const j = a[2] === undefined ? t.length() : num(a[2], 3, 'unpack');
      const out = [];
      for (let k = i; k <= j; k++) out.push(t.get(k));
      return out;
    };
    reg(G, 'unpack', unpack);

    // math
    const M = lib('math');
    M.set('pi', Math.PI);
    M.set('huge', Infinity);
    const m1 = (name, fn) => reg(M, name, (a) => [fn(num(a[0], 1, 'math.' + name))]);
    m1('floor', Math.floor); m1('ceil', Math.ceil); m1('abs', Math.abs); m1('sqrt', Math.sqrt);
    m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin); m1('acos', Math.acos);
    m1('exp', Math.exp); m1('deg', (x) => x * 180 / Math.PI); m1('rad', (x) => x * Math.PI / 180);
    reg(M, 'atan', (a) => [a[1] === undefined ? Math.atan(num(a[0], 1, 'math.atan')) : Math.atan2(num(a[0], 1, 'math.atan'), num(a[1], 2, 'math.atan'))]);
    reg(M, 'atan2', (a) => [Math.atan2(num(a[0], 1, 'math.atan2'), num(a[1], 2, 'math.atan2'))]);
    reg(M, 'log', (a) => [a[1] === undefined ? Math.log(num(a[0], 1, 'math.log')) : Math.log(num(a[0], 1, 'math.log')) / Math.log(num(a[1], 2, 'math.log'))]);
    reg(M, 'pow', (a) => [Math.pow(num(a[0], 1, 'math.pow'), num(a[1], 2, 'math.pow'))]);
    reg(M, 'fmod', (a) => [num(a[0], 1, 'math.fmod') % num(a[1], 2, 'math.fmod')]);
    reg(M, 'modf', (a) => { const x = num(a[0], 1, 'math.modf'); const i = Math.trunc(x); return [i, x - i]; });
    reg(M, 'min', (a) => { let r = num(a[0], 1, 'math.min'); for (let i = 1; i < a.length; i++) r = Math.min(r, num(a[i], i + 1, 'math.min')); return [r]; });
    reg(M, 'max', (a) => { let r = num(a[0], 1, 'math.max'); for (let i = 1; i < a.length; i++) r = Math.max(r, num(a[i], i + 1, 'math.max')); return [r]; });
    reg(M, 'random', (a) => {
      if (a.length === 0) return [Math.random()];
      let lo = 1, hi;
      if (a.length === 1) hi = num(a[0], 1, 'math.random');
      else { lo = num(a[0], 1, 'math.random'); hi = num(a[1], 2, 'math.random'); }
      lo = Math.floor(lo); hi = Math.floor(hi);
      if (lo > hi) I.rtErr("bad argument to 'random' (interval is empty)");
      return [Math.floor(Math.random() * (hi - lo + 1)) + lo];
    });
    reg(M, 'randomseed', () => []);

    // string (no Lua patterns: find/gsub work on plain text)
    const S = lib('string');
    reg(S, 'len', (a) => [str(a[0], 1, 'string.len').length]);
    reg(S, 'upper', (a) => [str(a[0], 1, 'string.upper').toUpperCase()]);
    reg(S, 'lower', (a) => [str(a[0], 1, 'string.lower').toLowerCase()]);
    reg(S, 'reverse', (a) => [Array.from(str(a[0], 1, 'string.reverse')).reverse().join('')]);
    reg(S, 'rep', (a) => {
      const s = str(a[0], 1, 'string.rep'); const n = Math.max(0, Math.floor(num(a[1], 2, 'string.rep')));
      if (s.length * n > 1e6) I.rtErr('string.rep result too large');
      const sep = a[2] === undefined ? '' : str(a[2], 3, 'string.rep');
      return [Array(n).fill(s).join(sep)];
    });
    reg(S, 'sub', (a) => {
      const s = str(a[0], 1, 'string.sub');
      let i = a[1] === undefined ? 1 : Math.floor(num(a[1], 2, 'string.sub'));
      let j = a[2] === undefined ? -1 : Math.floor(num(a[2], 3, 'string.sub'));
      const l = s.length;
      if (i < 0) i = Math.max(l + i + 1, 1); else if (i === 0) i = 1;
      if (j < 0) j = l + j + 1; else if (j > l) j = l;
      return [i > j ? '' : s.slice(i - 1, j)];
    });
    reg(S, 'byte', (a) => {
      const s = str(a[0], 1, 'string.byte');
      const i = a[1] === undefined ? 1 : num(a[1], 2, 'string.byte');
      const j = a[2] === undefined ? i : num(a[2], 3, 'string.byte');
      const out = [];
      for (let k = i; k <= j && k <= s.length; k++) out.push(s.charCodeAt(k - 1));
      return out;
    });
    reg(S, 'char', (a) => [a.map((c, i) => String.fromCharCode(num(c, i + 1, 'string.char'))).join('')]);
    reg(S, 'find', (a) => {
      const s = str(a[0], 1, 'string.find'), p = str(a[1], 2, 'string.find');
      let init = a[2] === undefined ? 1 : Math.floor(num(a[2], 3, 'string.find'));
      if (init < 0) init = Math.max(s.length + init + 1, 1);
      const idx = s.indexOf(p, init - 1);
      return idx < 0 ? [undefined] : [idx + 1, idx + p.length];
    });
    reg(S, 'gsub', (a) => {
      const s = str(a[0], 1, 'string.gsub'), p = str(a[1], 2, 'string.gsub'), r = str(a[2], 3, 'string.gsub');
      if (p === '') return [s, 0];
      const parts = s.split(p);
      return [parts.join(r), parts.length - 1];
    });
    reg(S, 'format', (a) => [sformat(I, a, argErr)]);

    // table
    const T = lib('table');
    reg(T, 'insert', (a) => {
      const t = tbl(a[0], 1, 'table.insert');
      if (a.length === 2) { t.set(t.length() + 1, a[1]); return []; }
      if (a.length !== 3) I.rtErr("wrong number of arguments to 'insert'");
      const pos = Math.floor(num(a[1], 2, 'table.insert'));
      for (let i = t.length(); i >= pos; i--) t.set(i + 1, t.get(i));
      t.set(pos, a[2]);
      return [];
    });
    reg(T, 'remove', (a) => {
      const t = tbl(a[0], 1, 'table.remove');
      const n = t.length();
      if (n === 0) return [undefined];
      const pos = a[1] === undefined ? n : Math.floor(num(a[1], 2, 'table.remove'));
      const v = t.get(pos);
      for (let i = pos; i < n; i++) t.set(i, t.get(i + 1));
      t.set(n, undefined);
      return [v];
    });
    reg(T, 'concat', (a) => {
      const t = tbl(a[0], 1, 'table.concat');
      const sep = a[1] === undefined ? '' : str(a[1], 2, 'table.concat');
      const i = a[2] === undefined ? 1 : num(a[2], 3, 'table.concat');
      const j = a[3] === undefined ? t.length() : num(a[3], 4, 'table.concat');
      const out = [];
      for (let k = i; k <= j; k++) {
        const v = t.get(k);
        if (typeof v !== 'string' && typeof v !== 'number') I.rtErr(`invalid value (at index ${k}) in table for 'concat'`);
        out.push(tostr(I, v));
      }
      return [out.join(sep)];
    });
    reg(T, 'sort', (a) => {
      const t = tbl(a[0], 1, 'table.sort');
      const cmp = a[1];
      const items = [];
      for (let i = 1; i <= t.length(); i++) items.push(t.get(i));
      items.sort((x, y) => {
        if (cmp !== undefined) {
          if (truthy(I.callValue(cmp, [x, y], null, null)[0])) return -1;
          if (truthy(I.callValue(cmp, [y, x], null, null)[0])) return 1;
          return 0;
        }
        if ((typeof x === 'number' && typeof y === 'number') || (typeof x === 'string' && typeof y === 'string')) return x < y ? -1 : x > y ? 1 : 0;
        return I.rtErr(`attempt to compare ${typeName(x)} with ${typeName(y)}`);
      });
      items.forEach((v, i) => t.set(i + 1, v));
      return [];
    });
    reg(T, 'unpack', unpack);
    reg(T, 'getn', (a) => [tbl(a[0], 1, 'table.getn').length()]);

    // os
    const O = lib('os');
    reg(O, 'time', () => [Math.floor(Date.now() / 1000)]);
    reg(O, 'clock', () => [(typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000]);
    reg(O, 'date', () => [new Date().toISOString()]);
  }

  function sformat(I, args, argErr) {
    const fmt = args[0];
    if (typeof fmt !== 'string') argErr(1, 'string.format', 'string', fmt);
    let ai = 1;
    return fmt.replace(/%([-+ #0]*)(\d+)?(?:\.(\d+))?([diouxXeEfgGcsq%])/g, (m, flags, width, prec, conv) => {
      if (conv === '%') return '%';
      const v = args[ai]; const argN = ai + 1; ai++;
      const needNum = () => { const x = toNumber(v); if (x === undefined) argErr(argN, 'string.format', 'number', v); return x; };
      let s;
      switch (conv) {
        case 'd': case 'i': { const x = Math.trunc(needNum()); s = String(Math.abs(x)); if (prec !== undefined) s = s.padStart(+prec, '0'); s = (x < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + s; break; }
        case 'u': s = String(Math.abs(Math.trunc(needNum()))); break;
        case 'o': s = (Math.trunc(needNum()) >>> 0).toString(8); break;
        case 'x': s = (Math.trunc(needNum()) >>> 0).toString(16); break;
        case 'X': s = (Math.trunc(needNum()) >>> 0).toString(16).toUpperCase(); break;
        case 'c': s = String.fromCharCode(needNum()); break;
        case 'f': { const x = needNum(); s = x.toFixed(prec === undefined ? 6 : +prec); if (flags.includes('+') && x >= 0) s = '+' + s; break; }
        case 'e': case 'E': { const x = needNum(); s = x.toExponential(prec === undefined ? 6 : +prec).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break; }
        case 'g': case 'G': { const x = needNum(); s = String(parseFloat(x.toPrecision(prec === undefined ? 6 : Math.max(1, +prec)))); break; }
        case 's': s = tostr(I, v); if (prec !== undefined) s = s.slice(0, +prec); break;
        case 'q': s = '"' + String(v).replace(/[\\"\n]/g, (c) => (c === '\n' ? '\\n' : '\\' + c)) + '"'; break;
        default: s = m;
      }
      if (width !== undefined && s.length < +width) {
        if (flags.includes('-')) s = s.padEnd(+width, ' ');
        else if (flags.includes('0') && conv !== 's' && conv !== 'c') {
          const sign = /^[-+ ]/.test(s) ? s[0] : '';
          s = sign + s.slice(sign.length).padStart(+width - sign.length, '0');
        } else s = s.padStart(+width, ' ');
      }
      return s;
    });
  }

  const exported = { Interp, LuaTable, LuaError, Parser, lex, tostr, toNumber, typeName, fmtNum, truthy, isNil };
  root.Lua = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
