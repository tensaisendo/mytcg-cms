const test = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../scripts/plan-card-recovery.cjs');
const base = { language: 'EN', cardId: 'OP01-001', sets: [{ language: 'EN' }], ambiguous: false, existing: [], canonical: [] };
test('existing identities are never creation candidates', () => assert.equal(classify({ ...base, existing: [{}] }), 'existing-identity-do-not-create'));
test('same-language product collisions are blocked', () => assert.equal(classify({ ...base, ambiguous: true }), 'multiple-products'));
test('reprints and promos have recognized identities', () => {
  for (const cardId of ['OP01-001_R1', 'P-001']) assert.equal(classify({ ...base, cardId }), 'new-en-candidate');
});
test('JP without a shared card needs review', () => assert.equal(classify({ ...base, language: 'JP', sets: [{ language: 'JP' }] }), 'shared-card-review'));
test('missing FR printing is distinct from missing shared card', () => {
  const fr = { ...base, language: 'FR', sets: [{ language: 'FR' }] };
  assert.equal(classify(fr), 'shared-card-review');
  assert.equal(classify({ ...fr, canonical: [{}] }), 'new-local-printing-candidate');
});
test('wrong-language set cannot be reused', () => assert.equal(classify({ ...base, sets: [{ language: 'FR' }] }), 'set-needs-review'));
