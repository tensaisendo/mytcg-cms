// Stop Strapi before --write. The default run is a read-only migration plan.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const write = process.argv.includes('--write');
const root = path.resolve(__dirname, '..');
const db = new Database(path.join(root, '.tmp/data.db'), { readonly: !write });
db.pragma('busy_timeout = 10000');

const tableNames = () => new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows = table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();

function relationTable(suffix) {
  const expected = `card_printings_${suffix}_lnk`;
  if (!tableNames().has(expected)) throw Error(`Missing ${expected}. Start Strapi once after applying the schema, then stop it.`);
  return expected;
}

function protectedState() {
  const protectedTables = [...tableNames()].filter(table =>
    ['cards', 'card_printings', 'files', 'files_related_mph', 'card_printings_set_lnk'].includes(table) ||
    /^user_cards/.test(table),
  );
  return Object.fromEntries(protectedTables.map(table => [table, hash(rows(table))]));
}

function plan() {
  const cardLinks = relationTable('card');
  const treatmentLinks = relationTable('treatment');
  const cards = db.prepare('SELECT id, document_id, card_id, published_at FROM cards').all();
  const printings = db.prepare('SELECT id, document_id, printing_id, card_id, language, published_at FROM card_printings').all();
  const cardsByIdentity = new Map();
  for (const card of cards) {
    const state = card.published_at == null ? 'draft' : 'published';
    const key = `${card.card_id}:${state}`;
    cardsByIdentity.set(key, [...(cardsByIdentity.get(key) || []), card]);
  }
  const cardTreatments = new Map(rows('cards_treatment_lnk').map(link => [link.card_id, link.treatment_id]));
  const existingCardLinks = new Map(rows(cardLinks).map(link => [link.card_printing_id, link.card_id]));
  const existingTreatmentLinks = new Map(rows(treatmentLinks).map(link => [link.card_printing_id, link.treatment_id]));
  const updates = [];
  const unresolved = [];

  for (const printing of printings) {
    const state = printing.published_at == null ? 'draft' : 'published';
    const candidates = cardsByIdentity.get(`${printing.card_id}:${state}`) || [];
    if (candidates.length !== 1) {
      unresolved.push({ printingId: printing.printing_id, language: printing.language, reason: candidates.length ? 'ambiguous-card' : 'missing-card' });
      continue;
    }
    const card = candidates[0];
    const treatmentId = cardTreatments.get(card.id) || null;
    updates.push({ printingRowId: printing.id, printingId: printing.printing_id, cardRowId: card.id, treatmentId,
      cardChanged: existingCardLinks.get(printing.id) !== card.id,
      treatmentChanged: (existingTreatmentLinks.get(printing.id) || null) !== treatmentId });
  }
  return { cardLinks, treatmentLinks, updates, unresolved };
}

async function main() {
  const migration = plan();
  let backup = null;
  let changedCardLinks = 0;
  let changedTreatmentLinks = 0;
  if (write) {
    try {
      const response = await fetch('http://127.0.0.1:1337/_health', { signal: AbortSignal.timeout(2000) });
      if (response.ok) throw Error('Stop Strapi before --write');
    } catch (error) {
      if (error.message === 'Stop Strapi before --write') throw error;
      if (error.cause?.code && error.cause.code !== 'ECONNREFUSED') throw Error('Cannot confirm Strapi is stopped');
    }
    const backups = path.join(root, '.tmp/backups');
    fs.mkdirSync(backups, { recursive: true });
    backup = path.join(backups, `before-printing-card-treatment-${Date.now()}.db`);
    await db.backup(backup);
    const before = protectedState();
    const existingForeignKeys = new Set(db.pragma('foreign_key_check').map(row => JSON.stringify(row)));
    db.transaction(() => {
      for (const update of migration.updates) {
        if (update.cardChanged) {
          db.prepare(`DELETE FROM "${migration.cardLinks}" WHERE card_printing_id=?`).run(update.printingRowId);
          db.prepare(`INSERT INTO "${migration.cardLinks}" (card_printing_id,card_id) VALUES (?,?)`).run(update.printingRowId, update.cardRowId);
          changedCardLinks += 1;
        }
        if (update.treatmentChanged) {
          db.prepare(`DELETE FROM "${migration.treatmentLinks}" WHERE card_printing_id=?`).run(update.printingRowId);
          if (update.treatmentId) db.prepare(`INSERT INTO "${migration.treatmentLinks}" (card_printing_id,treatment_id) VALUES (?,?)`).run(update.printingRowId, update.treatmentId);
          changedTreatmentLinks += 1;
        }
      }
    }).immediate();
    if (JSON.stringify(before) !== JSON.stringify(protectedState())) throw Error('Protected card, printing, price, image, Set or collection data changed');
    const newForeignKeys = db.pragma('foreign_key_check').filter(row => !existingForeignKeys.has(JSON.stringify(row)));
    if (newForeignKeys.length) throw Error(`Migration introduced foreign-key errors (${newForeignKeys.length})`);
  }
  const report = { generatedAt: new Date().toISOString(), write, backup, printingRows: migration.updates.length,
    changedCardLinks, changedTreatmentLinks, unresolved: migration.unresolved };
  const reports = path.join(root, '.tmp/reports');
  fs.mkdirSync(reports, { recursive: true });
  const reportPath = path.join(reports, `printing-card-treatment-${write ? 'write' : 'dry-run'}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, unresolved: report.unresolved.length, report: reportPath }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
