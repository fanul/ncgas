import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../shared/expression-engine.js'; // registers globalThis.NCGASExpression for rule validation
import '../shared/blueprint-utils.js';

const B = globalThis.NCGASBlueprint;

function sampleBlueprint() {
  const bp = B.createEmptyBlueprint('ncgas_demo', 'Demo App');
  const pageId = Object.keys(bp.pages)[0];
  bp.sharedServices.srv_fetch_profile = {
    type: 'GAS_RPC',
    functionName: 'getUserProfileData',
    cachePolicy: 'LOCAL_STORAGE_5M',
    allowedRoles: ['Admin', 'HR_Manager']
  };
  bp.sharedRules.rule_is_adult = { expression: 'state.userAge >= 18', errorMessage: 'Minimal 18 tahun.' };
  bp.pages[pageId].components.push({
    id: 'comp_input_salary',
    type: 'FORM_INPUT_NUMBER',
    layoutGrid: { xs: 12, md: 6 },
    properties: { label: 'Base Salary', defaultValue: 0 },
    services: { onBlur: { action: 'srv_fetch_profile', inputs: { salary: 'comp_input_salary.value' } } },
    rules: {
      validation: [{ trigger: 'onChange', condition: 'self.value > 0', errorMessage: 'Harus > 0' }],
      visibility: { condition: "user.role === 'Admin' || user.role === 'HR_Manager'" }
    }
  });
  return bp;
}

test('createEmptyBlueprint produces a valid blueprint', () => {
  const res = B.validateBlueprint(B.createEmptyBlueprint('my_app_01'));
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('full sample blueprint validates', () => {
  const res = B.validateBlueprint(sampleBlueprint());
  assert.deepEqual(res.errors, []);
});

test('broken service reference is caught', () => {
  const bp = sampleBlueprint();
  const pageId = Object.keys(bp.pages)[0];
  bp.pages[pageId].components[0].services.onBlur.action = 'srv_ghost';
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Broken reference: service `srv_ghost`/);
});

test('invalid rule expression is caught at validation time', () => {
  const bp = sampleBlueprint();
  bp.sharedRules.rule_bad = { expression: 'state.userAge >=' };
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Invalid expression/);
});

test('duplicate component ids across pages are caught', () => {
  const bp = sampleBlueprint();
  const p2 = B.createEmptyPage('Second', '/second');
  p2.components.push({ id: 'comp_input_salary', type: 'TEXT', properties: {} });
  bp.pages.pg_second = p2;
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Duplicate component id/);
});

test('duplicate routes are caught', () => {
  const bp = sampleBlueprint();
  const homeId = Object.keys(bp.pages)[0];
  const p2 = B.createEmptyPage('Clone', bp.pages[homeId].settings.route);
  bp.pages.pg_clone = p2;
  const res = B.validateBlueprint(bp);
  assert.equal(res.ok, false);
  assert.match(JSON.stringify(res.errors), /Duplicate route/);
});

test('shard round-trip preserves the blueprint', () => {
  const bp = sampleBlueprint();
  const shards = B.splitIntoShards(bp);
  assert.deepEqual(shards.manifest.pageIds, Object.keys(bp.pages));
  assert.ok(shards.globals.sharedServices.srv_fetch_profile);
  const merged = B.mergeShards(shards.manifest, shards.globals, shards.pages);
  assert.deepEqual(merged, JSON.parse(JSON.stringify(bp)));
});

test('mergeShards throws explicitly on a missing page shard', () => {
  const bp = sampleBlueprint();
  const shards = B.splitIntoShards(bp);
  const partial = {};
  assert.throws(
    () => B.mergeShards(shards.manifest, shards.globals, partial),
    /SHARD_ERROR.*Missing page shard/
  );
});

test('assertValid throws with every error listed', () => {
  const bp = sampleBlueprint();
  bp.appId = 'BAD ID!';
  bp.meta.name = '';
  assert.throws(() => B.assertValid(bp), /BLUEPRINT_INVALID[\s\S]*appId[\s\S]*meta\.name/);
});
