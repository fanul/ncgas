import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/expression-engine.js'; // UMD-lite: registers globalThis.NCGASExpression

const E = globalThis.NCGASExpression;

const scope = {
  state: { userAge: 21, employees: [{ name: 'Ani', salary: 5000000 }, { name: 'Budi', salary: 7000000 }] },
  user: { role: 'HR_Manager', email: 'izza@example.com', roles: ['HR_Manager', 'Employee'] },
  self: { value: 150000 },
  comp_input_salary: { value: 6000000 }
};

test('sample expressions from the blueprint contract', () => {
  assert.equal(E.evaluate('state.userAge >= 18', scope), true);
  assert.equal(E.evaluate("user.role === 'Admin' || user.role === 'HR_Manager'", scope), true);
  assert.equal(E.evaluate('self.value > 0', scope), true);
  assert.equal(E.evaluate("user.role === 'Admin' && comp_input_salary.value > 5000000", scope), false);
});

test('literals and arithmetic precedence', () => {
  assert.equal(E.evaluate('1 + 2 * 3', {}), 7);
  assert.equal(E.evaluate('(1 + 2) * 3', {}), 9);
  assert.equal(E.evaluate('10 % 3', {}), 1);
  assert.equal(E.evaluate('-4 + 2', {}), -2);
  assert.equal(E.evaluate('1.5 * 2', {}), 3);
  assert.equal(E.evaluate("'a' + 'b' + 1", {}), 'ab1');
});

test('== is strict equality', () => {
  assert.equal(E.evaluate("1 == '1'", {}), false);
  assert.equal(E.evaluate('1 === 1', {}), true);
  assert.equal(E.evaluate("1 != '1'", {}), true);
});

test('logical short-circuit and nullish', () => {
  assert.equal(E.evaluate('false && missing.x', {}), false); // right side never runs
  assert.equal(E.evaluate('true || missing.x', {}), true);
  assert.equal(E.evaluate('state.nothing ?? 42', { state: {} }), 42);
  assert.equal(E.evaluate('0 ?? 42', {}), 0);
  assert.equal(E.evaluate('!false', {}), true);
});

test('ternary', () => {
  assert.equal(E.evaluate("state.userAge >= 18 ? 'adult' : 'minor'", scope), 'adult');
  assert.equal(E.evaluate('true ? false ? 1 : 2 : 3', {}), 2);
});

test('member, index and array literals', () => {
  assert.equal(E.evaluate('state.employees[1].name', scope), 'Budi');
  assert.equal(E.evaluate('state.employees.length', scope), 2);
  assert.equal(E.evaluate("['a','b','c'][2]", {}), 'c');
  assert.equal(E.evaluate("'hello'.length", {}), 5);
  assert.equal(E.evaluate('state.employees[0]["salary"]', scope), 5000000);
});

test('built-in functions', () => {
  assert.equal(E.evaluate('round(3.14159, 2)', {}), 3.14);
  assert.equal(E.evaluate("upper('abc')", {}), 'ABC');
  assert.equal(E.evaluate("includes(user.roles, 'HR_Manager')", scope), true);
  assert.equal(E.evaluate("coalesce(null, '', 'x')", {}), 'x');
  assert.equal(E.evaluate('sum([1,2,3])', {}), 6);
  assert.equal(E.evaluate("sum(pluck(state.employees, 'salary'))", scope), 12000000);
  assert.throws(() => E.evaluate("pluck(state.employees, 'constructor')", scope), /SECURITY/);
  assert.equal(E.evaluate('formatNumber(1234567.5, 1)', {}), '1.234.567,5');
  assert.equal(E.evaluate('formatIDR(5000000)', {}), 'Rp 5.000.000');
  assert.equal(E.evaluate("len('abc') + len([1,2])", {}), 5);
  assert.equal(E.evaluate("isEmpty('')", {}), true);
});

test('SECURITY: prototype escape routes are closed', () => {
  assert.throws(() => E.evaluate('user.constructor', scope), /SECURITY/);
  assert.throws(() => E.evaluate('user.__proto__', scope), /SECURITY/);
  assert.throws(() => E.evaluate('user.prototype', scope), /SECURITY/);
  assert.throws(() => E.evaluate("user['const' + 'ructor']", scope), /SECURITY/);
  assert.throws(() => E.evaluate("user.email.constructor", scope), /SECURITY/);
  assert.throws(() => E.evaluate("upper.call", {}), /RUNTIME|SECURITY/); // no function objects in scope
});

test('SECURITY: method calls are rejected at parse time', () => {
  assert.throws(() => E.parse('user.email.toString()'), /SECURITY/);
  assert.throws(() => E.parse("state.employees.map(x)"), /SECURITY/);
  assert.throws(() => E.parse("(user.email)('x')"), /SECURITY/); // member expression as callee
  assert.equal(E.evaluate("(upper)('a')", {}), 'A'); // parens collapse to a bare ident — still registry-only
});

test('SECURITY: no assignment, no statements, no lambda', () => {
  assert.throws(() => E.parse('user.role = "Admin"'), /SYNTAX/);
  assert.throws(() => E.parse('a; b'), /SYNTAX/);
  assert.throws(() => E.parse('() => 1'), /SYNTAX/);
  assert.throws(() => E.parse('new Date()'), /SYNTAX|SECURITY|RUNTIME/);
});

test('unknown identifiers are actionable, lenient mode opt-in', () => {
  assert.throws(() => E.evaluate('missing_root', { user: {} }), /Unknown identifier `missing_root`/);
  assert.equal(E.evaluate('missing_root', { user: {} }, { lenient: true }), undefined);
  // unknown *property* of a known object is undefined (not an error)
  assert.equal(E.evaluate('user.nickname', scope), undefined);
});

test('runtime errors are explicit', () => {
  assert.throws(() => E.evaluate('1 / 0', {}), /Division by zero/);
  assert.throws(() => E.evaluate("5 > 'a'", {}), /needs two numbers or two strings/);
  assert.throws(() => E.evaluate('state.ghost.deep', { state: {} }), /Cannot read `deep` of undefined/);
  assert.throws(() => E.evaluate('nope()', {}), /Unknown function `nope\(\)`/);
});

test('limits: length, depth, tokens', () => {
  assert.throws(() => E.parse('1 + '.repeat(600) + '1'), /LIMIT/);
  assert.throws(() => E.parse('('.repeat(40) + '1' + ')'.repeat(40)), /LIMIT/);
  assert.throws(() => E.parse('x'.repeat(3000)), /LIMIT/);
});

test('validate() never throws', () => {
  assert.deepEqual(E.validate('user.role === "Admin"'), { ok: true });
  const bad = E.validate('user.role ===');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unexpected token/);
  assert.equal(typeof bad.position, 'number');
});

test('evaluateRule fails closed by default', () => {
  assert.equal(E.evaluateRule('broken.ref.here', {}), false);
  assert.equal(E.evaluateRule('broken.ref.here', {}, true), true);
  assert.equal(E.evaluateRule('1 < 2', {}), true);
});

test('string escapes', () => {
  assert.equal(E.evaluate("'it\\'s'", {}), "it's");
  assert.equal(E.evaluate('"line\\nbreak"', {}), 'line\nbreak');
  assert.throws(() => E.parse("'unterminated"), /Unterminated string/);
});

test('compile() returns a reusable function', () => {
  const fn = E.compile('self.value * 2');
  assert.equal(fn({ self: { value: 21 } }), 42);
  assert.equal(fn({ self: { value: 100 } }), 200);
});
