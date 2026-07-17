/**
 * NCGAS Expression Engine — safe, deterministic evaluator for declarative rule strings.
 *
 * Runs unchanged in three environments:
 *   1. Vue 3 editor / compiled SPA (browser)
 *   2. Google Apps Script V8 server runtime
 *   3. Node (unit tests)
 *
 * SECURITY MODEL (the reason this file exists instead of eval/new Function):
 *   - Tokenizer -> Pratt parser -> tree-walking interpreter. No code generation, ever.
 *   - Function calls are only allowed on bare identifiers resolved against the
 *     built-in FUNCTIONS registry. Member calls (`x.constructor()`, `''.concat()`)
 *     are rejected at parse time, which closes every prototype-gadget escape route.
 *   - Member access denies __proto__ / prototype / constructor and only reads
 *     own-properties of plain objects, numeric indexes + length of arrays,
 *     and length of strings.
 *   - Hard budgets: expression length, token count, AST depth, interpreter steps.
 *
 * Deliberate language subset:
 *   literals: numbers, 'strings' "strings", true/false/null, [array, literals]
 *   operators: + - * / %   == != === !== < <= > >=   && || ?? !   ?:   ( )  [index]  .member
 *   `==`/`!=` are compiled to STRICT equality — documented footgun removal.
 */

(function (global) {
  'use strict';

  var LIMITS = {
    MAX_EXPR_LENGTH: 2000,
    MAX_TOKENS: 500,
    MAX_DEPTH: 32,
    MAX_STEPS: 20000
  };

  var DENIED_KEYS = { __proto__: true, prototype: true, constructor: true };
  // Object literal above cannot carry a real __proto__ key; use explicit checks.
  function isDeniedKey(key) {
    return key === '__proto__' || key === 'prototype' || key === 'constructor';
  }

  // ---------------------------------------------------------------- errors --

  function ExpressionError(code, message, position, expression) {
    var snippet = '';
    if (typeof expression === 'string' && typeof position === 'number') {
      var start = Math.max(0, position - 20);
      snippet = expression.slice(start, position) + ' »HERE» ' + expression.slice(position, position + 20);
    }
    var err = new Error('[' + code + '] ' + message + (snippet ? ' | near: `' + snippet + '`' : ''));
    err.name = 'ExpressionError';
    err.code = code;
    err.position = position;
    err.isExpressionError = true;
    return err;
  }

  // ------------------------------------------------------------- tokenizer --

  var PUNCT3 = ['===', '!=='];
  var PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||', '??'];
  var PUNCT1 = ['+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', ',', '.', '{', '}'];
  var KEYWORDS = { 'true': true, 'false': false, 'null': null };

  function tokenize(src) {
    if (typeof src !== 'string') {
      throw ExpressionError('SYNTAX', 'Expression must be a string, got ' + typeof src);
    }
    if (src.length > LIMITS.MAX_EXPR_LENGTH) {
      throw ExpressionError('LIMIT', 'Expression exceeds ' + LIMITS.MAX_EXPR_LENGTH + ' characters');
    }
    var tokens = [];
    var i = 0;
    var n = src.length;

    while (i < n) {
      var ch = src[i];

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

      // numbers: 12, 12.5  (no leading-dot, no exponent — keep the grammar boring)
      if (ch >= '0' && ch <= '9') {
        var startNum = i;
        while (i < n && src[i] >= '0' && src[i] <= '9') i++;
        if (src[i] === '.' && src[i + 1] >= '0' && src[i + 1] <= '9') {
          i++;
          while (i < n && src[i] >= '0' && src[i] <= '9') i++;
        }
        tokens.push({ type: 'num', value: parseFloat(src.slice(startNum, i)), pos: startNum });
        continue;
      }

      // strings
      if (ch === '"' || ch === "'") {
        var quote = ch;
        var startStr = i;
        i++;
        var out = '';
        var closed = false;
        while (i < n) {
          var c = src[i];
          if (c === '\\') {
            var esc = src[i + 1];
            if (esc === 'n') out += '\n';
            else if (esc === 't') out += '\t';
            else if (esc === '\\') out += '\\';
            else if (esc === quote) out += quote;
            else throw ExpressionError('SYNTAX', 'Unknown escape sequence \\' + esc, i, src);
            i += 2;
            continue;
          }
          if (c === quote) { closed = true; i++; break; }
          out += c;
          i++;
        }
        if (!closed) throw ExpressionError('SYNTAX', 'Unterminated string literal', startStr, src);
        tokens.push({ type: 'str', value: out, pos: startStr });
        continue;
      }

      // identifiers / keywords
      if (/[A-Za-z_$]/.test(ch)) {
        var startId = i;
        while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
        var word = src.slice(startId, i);
        if (Object.prototype.hasOwnProperty.call(KEYWORDS, word)) {
          tokens.push({ type: 'lit', value: KEYWORDS[word], pos: startId });
        } else {
          tokens.push({ type: 'ident', value: word, pos: startId });
        }
        continue;
      }

      // punctuation, longest match first
      var matched = null;
      var three = src.substr(i, 3);
      var two = src.substr(i, 2);
      if (PUNCT3.indexOf(three) !== -1) matched = three;
      else if (PUNCT2.indexOf(two) !== -1) matched = two;
      else if (PUNCT1.indexOf(ch) !== -1) matched = ch;

      if (matched) {
        tokens.push({ type: 'punct', value: matched, pos: i });
        i += matched.length;
        continue;
      }

      throw ExpressionError('SYNTAX', 'Unexpected character `' + ch + '`', i, src);
    }

    if (tokens.length > LIMITS.MAX_TOKENS) {
      throw ExpressionError('LIMIT', 'Expression exceeds ' + LIMITS.MAX_TOKENS + ' tokens');
    }
    tokens.push({ type: 'eof', value: null, pos: n });
    return tokens;
  }

  // ---------------------------------------------------------------- parser --
  // Pratt parser. Binding powers (higher binds tighter):

  var BINARY_BP = {
    '??': 3,
    '||': 4,
    '&&': 5,
    '==': 8, '!=': 8, '===': 8, '!==': 8,
    '<': 9, '<=': 9, '>': 9, '>=': 9,
    '+': 10, '-': 10,
    '*': 11, '/': 11, '%': 11
  };
  var TERNARY_BP = 2;
  var UNARY_BP = 13;
  var POSTFIX_BP = 15;

  function Parser(src) {
    this.src = src;
    this.tokens = tokenize(src);
    this.idx = 0;
  }

  Parser.prototype.peek = function () { return this.tokens[this.idx]; };
  Parser.prototype.next = function () { return this.tokens[this.idx++]; };
  Parser.prototype.expect = function (value) {
    var t = this.next();
    if (t.type !== 'punct' || t.value !== value) {
      throw ExpressionError('SYNTAX', 'Expected `' + value + '` but found `' + (t.value === null ? 'end of expression' : t.value) + '`', t.pos, this.src);
    }
    return t;
  };

  Parser.prototype.parseExpression = function (minBp, depth) {
    if (depth > LIMITS.MAX_DEPTH) {
      throw ExpressionError('LIMIT', 'Expression nesting exceeds depth ' + LIMITS.MAX_DEPTH);
    }
    var left = this.parsePrefix(depth);

    for (;;) {
      var t = this.peek();
      if (t.type !== 'punct') break;

      // postfix: member / index / call
      if (t.value === '.' || t.value === '[' || t.value === '(') {
        if (POSTFIX_BP < minBp) break;
        if (t.value === '.') {
          this.next();
          var prop = this.next();
          if (prop.type !== 'ident') {
            throw ExpressionError('SYNTAX', 'Expected property name after `.`', prop.pos, this.src);
          }
          if (isDeniedKey(prop.value)) {
            throw ExpressionError('SECURITY', 'Access to `' + prop.value + '` is forbidden', prop.pos, this.src);
          }
          left = { t: 'member', obj: left, key: prop.value, pos: prop.pos };
        } else if (t.value === '[') {
          this.next();
          var idxExpr = this.parseExpression(0, depth + 1);
          this.expect(']');
          left = { t: 'index', obj: left, idx: idxExpr, pos: t.pos };
        } else { // '('
          if (left.t !== 'ident') {
            throw ExpressionError('SECURITY', 'Only built-in functions may be called; method calls are forbidden', t.pos, this.src);
          }
          this.next();
          var args = [];
          if (!(this.peek().type === 'punct' && this.peek().value === ')')) {
            for (;;) {
              args.push(this.parseExpression(0, depth + 1));
              var sep = this.peek();
              if (sep.type === 'punct' && sep.value === ',') { this.next(); continue; }
              break;
            }
          }
          this.expect(')');
          left = { t: 'call', name: left.name, args: args, pos: t.pos };
        }
        continue;
      }

      // ternary
      if (t.value === '?') {
        if (TERNARY_BP < minBp) break;
        this.next();
        var cons = this.parseExpression(0, depth + 1);
        this.expect(':');
        var alt = this.parseExpression(TERNARY_BP, depth + 1); // right-assoc
        left = { t: 'ternary', cond: left, cons: cons, alt: alt, pos: t.pos };
        continue;
      }

      // binary
      var bp = BINARY_BP[t.value];
      if (bp === undefined || bp < minBp) break;
      this.next();
      var right = this.parseExpression(bp + 1, depth + 1); // left-assoc
      left = { t: 'binary', op: t.value, left: left, right: right, pos: t.pos };
    }

    return left;
  };

  Parser.prototype.parsePrefix = function (depth) {
    var t = this.next();

    if (t.type === 'num') return { t: 'num', value: t.value, pos: t.pos };
    if (t.type === 'str') return { t: 'str', value: t.value, pos: t.pos };
    if (t.type === 'lit') return { t: 'lit', value: t.value, pos: t.pos };
    if (t.type === 'ident') return { t: 'ident', name: t.value, pos: t.pos };

    if (t.type === 'punct') {
      if (t.value === '(') {
        var inner = this.parseExpression(0, depth + 1);
        this.expect(')');
        return inner;
      }
      if (t.value === '[') {
        var items = [];
        if (!(this.peek().type === 'punct' && this.peek().value === ']')) {
          for (;;) {
            items.push(this.parseExpression(0, depth + 1));
            var sep = this.peek();
            if (sep.type === 'punct' && sep.value === ',') { this.next(); continue; }
            break;
          }
        }
        this.expect(']');
        return { t: 'array', items: items, pos: t.pos };
      }
      if (t.value === '{') {
        var pairs = [];
        if (!(this.peek().type === 'punct' && this.peek().value === '}')) {
          for (;;) {
            var keyTok = this.next();
            var key;
            if (keyTok.type === 'ident' || keyTok.type === 'str') key = String(keyTok.value);
            else throw ExpressionError('SYNTAX', 'Expected a property name in object literal', keyTok.pos, this.src);
            if (isDeniedKey(key)) throw ExpressionError('SECURITY', 'Object literal key `' + key + '` is forbidden', keyTok.pos, this.src);
            this.expect(':');
            var value = this.parseExpression(0, depth + 1);
            pairs.push({ key: key, value: value });
            var sep2 = this.peek();
            if (sep2.type === 'punct' && sep2.value === ',') { this.next(); continue; }
            break;
          }
        }
        this.expect('}');
        return { t: 'object', pairs: pairs, pos: t.pos };
      }
      if (t.value === '!' || t.value === '-' || t.value === '+') {
        var operand = this.parseExpression(UNARY_BP, depth + 1);
        return { t: 'unary', op: t.value, operand: operand, pos: t.pos };
      }
    }

    throw ExpressionError('SYNTAX', 'Unexpected token `' + (t.value === null ? 'end of expression' : t.value) + '`', t.pos, this.src);
  };

  function parse(src) {
    var p = new Parser(src);
    var ast = p.parseExpression(0, 0);
    var trailing = p.peek();
    if (trailing.type !== 'eof') {
      throw ExpressionError('SYNTAX', 'Unexpected trailing input `' + trailing.value + '`', trailing.pos, src);
    }
    return ast;
  }

  // ------------------------------------------------------ function registry --
  // Every function is pure, validates its inputs, and throws actionable errors.

  function num(x, fn) {
    var v = Number(x);
    if (typeof x === 'boolean' || x === null || x === undefined || x === '' || isNaN(v)) {
      throw ExpressionError('RUNTIME', fn + '() expects a number, got ' + describe(x));
    }
    return v;
  }
  function str(x, fn) {
    if (typeof x !== 'string') throw ExpressionError('RUNTIME', fn + '() expects a string, got ' + describe(x));
    return x;
  }
  function arr(x, fn) {
    if (!Array.isArray(x)) throw ExpressionError('RUNTIME', fn + '() expects an array, got ' + describe(x));
    return x;
  }
  function describe(x) {
    if (x === null) return 'null';
    if (x === undefined) return 'undefined';
    if (Array.isArray(x)) return 'array';
    return typeof x;
  }
  function padZero(v) { return (v < 10 ? '0' : '') + v; }

  var FUNCTIONS = {
    // math
    abs: function (a) { return Math.abs(num(a, 'abs')); },
    round: function (a, d) { var f = Math.pow(10, d === undefined ? 0 : num(d, 'round')); return Math.round(num(a, 'round') * f) / f; },
    floor: function (a) { return Math.floor(num(a, 'floor')); },
    ceil: function (a) { return Math.ceil(num(a, 'ceil')); },
    min: function () { return Math.min.apply(null, Array.prototype.map.call(arguments, function (x) { return num(x, 'min'); })); },
    max: function () { return Math.max.apply(null, Array.prototype.map.call(arguments, function (x) { return num(x, 'max'); })); },
    sum: function (a) { return arr(a, 'sum').reduce(function (acc, x) { return acc + num(x, 'sum'); }, 0); },
    pluck: function (a, key) {
      var k = str(key, 'pluck');
      if (isDeniedKey(k)) throw ExpressionError('SECURITY', 'pluck() key `' + k + '` is forbidden');
      return arr(a, 'pluck').map(function (row) {
        return row !== null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, k) ? row[k] : undefined;
      });
    },
    avg: function (a) { var list = arr(a, 'avg'); if (!list.length) return 0; return FUNCTIONS.sum(list) / list.length; },
    count: function (a) { return arr(a, 'count').length; },
    /** Declarative row filter — no lambdas allowed in this language, so the comparison is fixed (strict-ish ==) and native. */
    whereEquals: function (a, key, value) {
      var k = str(key, 'whereEquals');
      if (isDeniedKey(k)) throw ExpressionError('SECURITY', 'whereEquals() key `' + k + '` is forbidden');
      return arr(a, 'whereEquals').filter(function (row) {
        return row !== null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, k) && row[k] === value;
      });
    },
    /** [{key,total}] — sums valueKey per distinct groupKey. For CHART data / dashboards. */
    groupBySum: function (a, groupKey, valueKey) {
      var gk = str(groupKey, 'groupBySum');
      var vk = str(valueKey, 'groupBySum');
      if (isDeniedKey(gk) || isDeniedKey(vk)) throw ExpressionError('SECURITY', 'groupBySum() key is forbidden');
      var order = [];
      var totals = {};
      arr(a, 'groupBySum').forEach(function (row) {
        if (row === null || typeof row !== 'object') return;
        var k = String(row[gk]);
        if (!Object.prototype.hasOwnProperty.call(totals, k)) { totals[k] = 0; order.push(k); }
        totals[k] += num(row[vk], 'groupBySum');
      });
      return order.map(function (k) { return { key: k, total: totals[k] }; });
    },
    /** [{key,count}] — counts rows per distinct groupKey. For CHART data / dashboards. */
    groupByCount: function (a, groupKey) {
      var gk = str(groupKey, 'groupByCount');
      if (isDeniedKey(gk)) throw ExpressionError('SECURITY', 'groupByCount() key is forbidden');
      var order = [];
      var counts = {};
      arr(a, 'groupByCount').forEach(function (row) {
        if (row === null || typeof row !== 'object') return;
        var k = String(row[gk]);
        if (!Object.prototype.hasOwnProperty.call(counts, k)) { counts[k] = 0; order.push(k); }
        counts[k] += 1;
      });
      return order.map(function (k) { return { key: k, count: counts[k] }; });
    },
    /** sum(row[keyA] * row[keyB]) across rows — e.g. cart total = sumProduct(state.cart, 'qty', 'harga'). */
    sumProduct: function (a, keyA, keyB) {
      var ka = str(keyA, 'sumProduct');
      var kb = str(keyB, 'sumProduct');
      if (isDeniedKey(ka) || isDeniedKey(kb)) throw ExpressionError('SECURITY', 'sumProduct() key is forbidden');
      return arr(a, 'sumProduct').reduce(function (acc, row) {
        if (row === null || typeof row !== 'object') return acc;
        return acc + num(row[ka], 'sumProduct') * num(row[kb], 'sumProduct');
      }, 0);
    },

    // strings
    len: function (a) {
      if (typeof a === 'string' || Array.isArray(a)) return a.length;
      throw ExpressionError('RUNTIME', 'len() expects a string or array, got ' + describe(a));
    },
    lower: function (a) { return str(a, 'lower').toLowerCase(); },
    upper: function (a) { return str(a, 'upper').toUpperCase(); },
    trim: function (a) { return str(a, 'trim').trim(); },
    concat: function () { return Array.prototype.map.call(arguments, function (x) { return x === null || x === undefined ? '' : String(x); }).join(''); },
    includes: function (a, b) {
      if (typeof a === 'string') return a.indexOf(str(b, 'includes')) !== -1;
      if (Array.isArray(a)) return a.indexOf(b) !== -1;
      throw ExpressionError('RUNTIME', 'includes() expects a string or array as first argument, got ' + describe(a));
    },
    startsWith: function (a, b) { return str(a, 'startsWith').indexOf(str(b, 'startsWith')) === 0; },
    endsWith: function (a, b) { var s = str(a, 'endsWith'); var t = str(b, 'endsWith'); return s.length >= t.length && s.lastIndexOf(t) === s.length - t.length; },
    split: function (a, sep) { return str(a, 'split').split(str(sep, 'split')); },
    join: function (a, sep) { return arr(a, 'join').join(str(sep, 'join')); },

    // conversion / null handling
    number: function (a) { return num(a, 'number'); },
    string: function (a) { return a === null || a === undefined ? '' : String(a); },
    boolean: function (a) { return !!a; },
    coalesce: function () {
      for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] !== null && arguments[i] !== undefined && arguments[i] !== '') return arguments[i];
      }
      return null;
    },
    iif: function (cond, a, b) { return cond ? a : b; },
    isEmpty: function (a) {
      return a === null || a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
    },

    // formatting (manual implementation => identical output in browser and GAS)
    formatNumber: function (a, decimals) {
      var v = num(a, 'formatNumber');
      var d = decimals === undefined ? 0 : num(decimals, 'formatNumber');
      var neg = v < 0;
      var fixed = Math.abs(v).toFixed(d);
      var parts = fixed.split('.');
      var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      var out = intPart + (parts[1] ? ',' + parts[1] : '');
      return (neg ? '-' : '') + out;
    },
    formatIDR: function (a) { return 'Rp ' + FUNCTIONS.formatNumber(a, 0); },

    // time (wall clock is acceptable inside generated apps)
    now: function () { return new Date().toISOString(); },
    today: function () {
      var d = new Date();
      return d.getFullYear() + '-' + padZero(d.getMonth() + 1) + '-' + padZero(d.getDate());
    }
  };

  // ----------------------------------------------------------- interpreter --

  function getMember(parent, key, pos, src) {
    if (isDeniedKey(key)) {
      throw ExpressionError('SECURITY', 'Access to `' + key + '` is forbidden', pos, src);
    }
    if (parent === null || parent === undefined) {
      throw ExpressionError('RUNTIME', 'Cannot read `' + key + '` of ' + describe(parent), pos, src);
    }
    if (Array.isArray(parent)) {
      if (key === 'length') return parent.length;
      var n = Number(key);
      if (Number.isInteger(n) && n >= 0 && n < parent.length) return parent[n];
      return undefined;
    }
    if (typeof parent === 'string') {
      if (key === 'length') return parent.length;
      throw ExpressionError('RUNTIME', 'Strings only expose `length` (tried `' + key + '`)', pos, src);
    }
    if (typeof parent === 'object') {
      return Object.prototype.hasOwnProperty.call(parent, key) ? parent[key] : undefined;
    }
    throw ExpressionError('RUNTIME', 'Cannot read `' + key + '` of a ' + describe(parent), pos, src);
  }

  function Interpreter(scope, opts) {
    this.scope = scope || {};
    this.opts = opts || {};
    this.steps = 0;
  }

  Interpreter.prototype.run = function (node) {
    if (++this.steps > LIMITS.MAX_STEPS) {
      throw ExpressionError('LIMIT', 'Expression evaluation exceeded ' + LIMITS.MAX_STEPS + ' steps');
    }
    var self = this;
    switch (node.t) {
      case 'num':
      case 'str':
      case 'lit':
        return node.value;

      case 'array':
        return node.items.map(function (item) { return self.run(item); });

      case 'object': {
        var obj = {};
        node.pairs.forEach(function (pair) { obj[pair.key] = self.run(pair.value); });
        return obj;
      }

      case 'ident': {
        var name = node.name;
        if (this.scope !== null && typeof this.scope === 'object' &&
            Object.prototype.hasOwnProperty.call(this.scope, name)) {
          return this.scope[name];
        }
        if (this.opts.lenient) return undefined;
        var roots = Object.keys(this.scope).slice(0, 20).join(', ');
        throw ExpressionError('RUNTIME', 'Unknown identifier `' + name + '`. Available: ' + (roots || '(empty scope)'), node.pos);
      }

      case 'member':
        return getMember(this.run(node.obj), node.key, node.pos);

      case 'index': {
        var idx = this.run(node.idx);
        if (typeof idx !== 'string' && typeof idx !== 'number') {
          throw ExpressionError('RUNTIME', 'Index must be a string or number, got ' + describe(idx), node.pos);
        }
        return getMember(this.run(node.obj), String(idx), node.pos);
      }

      case 'call': {
        var fns = this.opts.functions || FUNCTIONS;
        if (!Object.prototype.hasOwnProperty.call(fns, node.name)) {
          throw ExpressionError('RUNTIME', 'Unknown function `' + node.name + '()`. Available: ' + Object.keys(fns).join(', '), node.pos);
        }
        var args = node.args.map(function (a) { return self.run(a); });
        return fns[node.name].apply(null, args);
      }

      case 'unary': {
        if (node.op === '!') return !this.run(node.operand);
        var v = this.run(node.operand);
        if (typeof v !== 'number') {
          throw ExpressionError('RUNTIME', 'Unary `' + node.op + '` expects a number, got ' + describe(v), node.pos);
        }
        return node.op === '-' ? -v : +v;
      }

      case 'binary': {
        var op = node.op;
        // short-circuit family
        if (op === '&&') { var l = this.run(node.left); return l ? this.run(node.right) : l; }
        if (op === '||') { var l2 = this.run(node.left); return l2 ? l2 : this.run(node.right); }
        if (op === '??') { var l3 = this.run(node.left); return (l3 === null || l3 === undefined) ? this.run(node.right) : l3; }

        var a = this.run(node.left);
        var b = this.run(node.right);

        if (op === '==' || op === '===') return a === b;
        if (op === '!=' || op === '!==') return a !== b;

        if (op === '+') {
          if (typeof a === 'string' || typeof b === 'string') {
            return FUNCTIONS.concat(a, b);
          }
          return num(a, 'operator +') + num(b, 'operator +');
        }
        if (op === '-') return num(a, 'operator -') - num(b, 'operator -');
        if (op === '*') return num(a, 'operator *') * num(b, 'operator *');
        if (op === '/') {
          var divisor = num(b, 'operator /');
          if (divisor === 0) throw ExpressionError('RUNTIME', 'Division by zero', node.pos);
          return num(a, 'operator /') / divisor;
        }
        if (op === '%') {
          var mod = num(b, 'operator %');
          if (mod === 0) throw ExpressionError('RUNTIME', 'Modulo by zero', node.pos);
          return num(a, 'operator %') % mod;
        }

        // relational: numbers with numbers, strings with strings
        var bothNum = typeof a === 'number' && typeof b === 'number';
        var bothStr = typeof a === 'string' && typeof b === 'string';
        if (!bothNum && !bothStr) {
          throw ExpressionError('RUNTIME', 'Operator `' + op + '` needs two numbers or two strings, got ' + describe(a) + ' and ' + describe(b), node.pos);
        }
        if (op === '<') return a < b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        if (op === '>=') return a >= b;

        throw ExpressionError('RUNTIME', 'Unhandled operator `' + op + '`', node.pos);
      }

      case 'ternary':
        return this.run(node.cond) ? this.run(node.cons) : this.run(node.alt);

      default:
        throw ExpressionError('RUNTIME', 'Unknown AST node `' + node.t + '`');
    }
  };

  // -------------------------------------------------------------- public API --

  var astCache = {};
  var astCacheSize = 0;

  function parseCached(src) {
    if (Object.prototype.hasOwnProperty.call(astCache, src)) return astCache[src];
    var ast = parse(src);
    if (astCacheSize > 500) { astCache = {}; astCacheSize = 0; } // crude but bounded
    astCache[src] = ast;
    astCacheSize++;
    return ast;
  }

  /** evaluate('user.role === "Admin"', { user: {...} }) -> boolean/value. Throws ExpressionError. */
  function evaluate(exprOrAst, scope, opts) {
    var ast = typeof exprOrAst === 'string' ? parseCached(exprOrAst) : exprOrAst;
    return new Interpreter(scope, opts).run(ast);
  }

  /** compile(expr) -> reusable fn(scope, opts). Parse errors throw immediately. */
  function compile(expr) {
    var ast = parseCached(expr);
    return function (scope, opts) { return new Interpreter(scope, opts).run(ast); };
  }

  /** validate(expr) -> { ok: true } | { ok: false, error, code, position } — never throws. */
  function validate(expr) {
    try {
      parse(expr);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code || 'SYNTAX', position: e.position };
    }
  }

  /** Boolean convenience for rule conditions: errors become `fallback` (default false = fail closed). */
  function evaluateRule(expr, scope, fallback) {
    try {
      return !!evaluate(expr, scope);
    } catch (e) {
      return fallback === undefined ? false : fallback;
    }
  }

  var api = {
    parse: parse,
    compile: compile,
    evaluate: evaluate,
    evaluateRule: evaluateRule,
    validate: validate,
    FUNCTIONS: FUNCTIONS,
    LIMITS: LIMITS,
    _tokenize: tokenize // exposed for tests
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.NCGASExpression = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
