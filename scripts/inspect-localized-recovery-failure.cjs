const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
const reportFile = process.argv[2];
if (!reportFile) throw Error('Pass a recovery report path');
const report = JSON.parse(fs.readFileSync(path.resolve(reportFile), 'utf8'));
const before = new Database(report.backup, { readonly: true });
const after = new Database(path.join(root, '.tmp/data.db'), { readonly: true });
try {
  const changed = [];
  const currentLinks = new Map(after.prepare('SELECT * FROM files_related_mph').all().map(r => [r.id, r]));
  for (const old of before.prepare('SELECT * FROM files_related_mph').all()) {
    if (JSON.stringify(old) === JSON.stringify(currentLinks.get(old.id))) continue;
    const oldPrinting = old.related_type === 'api::card-printing.card-printing'
      ? before.prepare('SELECT document_id,printing_id,language FROM card_printings WHERE id=?').get(old.related_id)
      : null;
    changed.push({ old, currentSamePhysicalId: currentLinks.get(old.id) || null, oldPrinting,
      currentPrintingRows: oldPrinting ? after.prepare('SELECT id,document_id,printing_id,language,updated_at,published_at,price FROM card_printings WHERE document_id=?').all(oldPrinting.document_id) : [],
      currentSemanticLinks: oldPrinting ? after.prepare("SELECT f.* FROM files_related_mph f JOIN card_printings p ON p.id=f.related_id WHERE f.related_type='api::card-printing.card-printing' AND p.document_id=?").all(oldPrinting.document_id) : [] });
  }
  console.log(JSON.stringify({ report: path.resolve(reportFile), changedCount: changed.length, changed: changed.slice(0, 20) }, null, 2));
} finally { before.close(); after.close(); }
