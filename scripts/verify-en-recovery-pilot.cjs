const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, '.tmp/reports/en-recovery-pilot.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const before = new Database(report.backup, { readonly: true });
const after = new Database(path.join(root, '.tmp/data.db'), { readonly: true });
try {
  const tables = before.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name)
    .filter(t => /^(cards|card_printings|files|user_cards)(_|$)/.test(t));
  for (const table of tables) {
    const current = new Map(after.prepare(`SELECT * FROM "${table}"`).all().map(row => [row.id, row]));
    for (const row of before.prepare(`SELECT * FROM "${table}"`).all()) {
      if (JSON.stringify(current.get(row.id)) !== JSON.stringify(row)) throw Error(`Existing row changed: ${table}:${row.id}`);
    }
    if (table === 'files_related_mph') {
      const oldLinks = new Set(before.prepare('SELECT id FROM files_related_mph').all().map(r => r.id));
      for (const row of current.values()) if (!oldLinks.has(row.id)) {
        const card = after.prepare('SELECT card_id FROM cards WHERE id=?').get(row.related_id);
        if (row.related_type !== 'api::card.card' || row.field !== 'image' || !report.ids.includes(card?.card_id)) throw Error('Unexpected new media relation');
      }
    } else if (!table.startsWith('cards') && current.size !== before.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n) throw Error(`Unexpected extra rows: ${table}`);
  }
  const expectedImages = { 'EB01-006_R1': 3580, 'OP01-006_R1': 3575, 'OP01-024_R1': 3582 };
  const oldIds = new Set(before.prepare('SELECT id FROM cards').all().map(r => r.id));
  const added = after.prepare('SELECT * FROM cards').all().filter(r => !oldIds.has(r.id));
  if (added.some(r => !report.ids.includes(r.card_id))) throw Error('Unexpected new card');
  const results = [];
  for (const cardId of report.ids) {
    const rows = after.prepare('SELECT id,document_id,name,slug,published_at,price FROM cards WHERE card_id=?').all(cardId);
    if (new Set(rows.map(r => r.document_id)).size !== 1 || !rows.some(r => r.published_at != null)) throw Error(`Duplicate or unpublished: ${cardId}`);
    for (const row of rows) {
      const images = after.prepare("SELECT file_id FROM files_related_mph WHERE related_type='api::card.card' AND field='image' AND related_id=?").all(row.id);
      const sets = after.prepare('SELECT s.key FROM sets s JOIN cards_set_lnk l ON l.set_id=s.id WHERE l.card_id=?').all(row.id);
      if (images.length !== 1 || images[0].file_id !== expectedImages[cardId]) throw Error(`Wrong image: ${cardId}`);
      if (sets.length !== 1 || sets[0].key !== 'PRB01:EN') throw Error(`Wrong set: ${cardId}`);
      if (row.price !== null) throw Error(`Unexpected price: ${cardId}`);
    }
    results.push({ cardId, documentId: rows[0].document_id, name: rows[0].name, slug: rows[0].slug, imageId: expectedImages[cardId], set: 'PRB01:EN', published: true });
  }
  report.verification = { verifiedAt: new Date().toISOString(), protectedExistingRowsUnchanged: true, protectedTables: tables, cards: results };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.verification, null, 2));
} finally { before.close(); after.close(); }
