const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/api/user-card/controllers/user-card.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function fixture() {
  const cards = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1, documentId: `card-${index}`, cardId: `OP01-${String(index).padStart(3, '0')}`,
    name: `English ${index}`, price: index, colors: [{ name: 'Black' }], types: [{ name: 'Character' }],
    rarity: { name: 'R' }, treatment: null, set: { code: 'OP01' },
  }));
  const printings = cards.map((card, index) => ({
    id: card.id, documentId: `printing-${index}`, cardId: card.cardId,
    language: 'JP', name: `Localized ${index}`, price: 26 - index, set: { code: 'ST01' },
  }));
  const mediaQueries = [];
  const strapi = { db: { query: (uid) => ({ findMany: async (options) => {
    if (uid === 'api::user-card.user-card') {
      assert.equal(options.where.ownedQuantity.$gt, 0);
      assert.equal(options.where.printing.publishedAt.$notNull, true);
      return options.where.owner === 1 && options.where.printing.language === 'JP' ? printings.map((printing) => ({ printing })) : [];
    }
    if (options.populate?.image) mediaQueries.push(options);
    if (uid === 'api::card-printing.card-printing') return printings.filter((p) => options.where.id.$in.includes(p.id));
    if (options.where.id) return cards.filter((card) => options.where.id.$in.includes(card.id));
    assert.equal(options.where.publishedAt.$notNull, true);
    return cards.filter((card) => options.where.cardId.$in.includes(card.cardId));
  } }) } };
  const exports = {};
  const requireForFixture = (specifier) => {
    if (specifier === '../../../lib/berries') return { awardOnce: async () => ({}), ensureProfile: async () => ({}) };
    throw new Error(`Unexpected fixture import: ${specifier}`);
  };
  vm.runInNewContext(compiled, { exports, strapi, require: requireForFixture });
  return { controller: exports.default, mediaQueries };
}

async function run(query = {}, user = { id: 1 }) {
  const fixtureData = fixture();
  const ctx = { state: { user }, query: { lang: 'JP', ...query }, set() {}, unauthorized() { this.status = 401; } };
  await fixtureData.controller.catalog(ctx);
  return { ...fixtureData, ctx };
}

test('returns 12 owned cards per page, with media only for that page', async () => {
  const first = await run();
  const second = await run({ page: 2 });
  const third = await run({ page: 3 });
  assert.equal(first.ctx.body.total, 26);
  assert.equal(first.ctx.body.pageCount, 3);
  assert.equal(first.ctx.body.cards.length, 12);
  assert.equal(second.ctx.body.cards.length, 12);
  assert.equal(third.ctx.body.cards.length, 2);
  assert.equal(new Set([...first.ctx.body.cards, ...second.ctx.body.cards, ...third.ctx.body.cards].map((card) => card.cardId)).size, 26);
  assert.ok(first.mediaQueries.every((query) => query.where.id.$in.length === 12));
});

test('isolates account and language, rejects anonymous access', async () => {
  assert.equal((await run({}, null)).ctx.status, 401);
  assert.equal((await run({}, { id: 2 })).ctx.body.total, 0);
  assert.equal((await run({ lang: 'FR' })).ctx.body.total, 0);
});

test('filters localized name and set before pagination; sorts localized price', async () => {
  assert.equal((await run({ query: 'Localized 25', set: 'ST01' })).ctx.body.cards[0].cardId, 'OP01-025');
  assert.equal((await run({ set: 'OP01' })).ctx.body.total, 0);
  assert.equal((await run({ color: 'Red' })).ctx.body.total, 0);
  assert.equal((await run({ sort: 'price-asc' })).ctx.body.cards[0].cardId, 'OP01-025');
});
