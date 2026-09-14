// SQLite maintenance: stop Strapi before --write. The default is read-only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { folderEdition } = require('./set-edition.cjs');
const write = process.argv.includes('--write');
const root = path.resolve(__dirname, '..');
const db = new Database(path.join(root, '.tmp/data.db'), { readonly: !write });
db.pragma('busy_timeout = 10000');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function protectedState() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name)
    .filter(t => ['cards', 'card_printings', 'files', 'files_related_mph', 'files_folder_lnk'].includes(t) || /^user_cards/.test(t));
  return Object.fromEntries(tables.map(t => [t, hash(db.prepare(`SELECT * FROM ${t} ORDER BY id`).all())]));
}
function plan() {
  const folders = db.prepare('SELECT id, name, path FROM upload_folders').all();
  const roots = folders.filter(f => ['EN', 'FR', 'JP'].includes(f.name));
  const editions = roots.flatMap(r => folders.filter(f => f.path.startsWith(r.path + '/') && f.path.split('/').length === r.path.split('/').length + 1)
    .map(f => ({ ...folderEdition(f.name, r.name, f.id), path: f.path })));
  if (new Set(editions.map(e => e.key)).size !== editions.length) throw Error('Ambiguous duplicate product codes in one language');
  const media = db.prepare('SELECT l.file_id, f.path FROM files_folder_lnk l JOIN upload_folders f ON f.id=l.folder_id').all();
  const byFile = new Map(media.map(m => [m.file_id, editions.find(e => m.path === e.path || m.path.startsWith(e.path + '/'))]));
  const issues = [], updates = [];
  for (const [table, type, link, fk] of [['cards','api::card.card','cards_set_lnk','card_id'],['card_printings','api::card-printing.card-printing','card_printings_set_lnk','card_printing_id']]) {
    const rows = db.prepare(`SELECT id, card_id${table === 'cards' ? '' : ', language'} FROM ${table}`).all();
    const images = db.prepare('SELECT related_id, file_id FROM files_related_mph WHERE related_type=? AND field=?').all(type, 'image');
    const byRow = new Map();
    for (const image of images) byRow.set(image.related_id, [...(byRow.get(image.related_id) || []), image.file_id]);
    for (const row of rows) {
      const language = table === 'cards' ? 'EN' : row.language;
      const ids = byRow.get(row.id) || [];
      const edition = ids.length === 1 ? byFile.get(ids[0]) : null;
      if (!edition || edition.language !== language) {
        issues.push({ table, id: row.id, cardId: row.card_id, language, reason: !ids.length ? 'no-image' : !edition ? 'ambiguous-or-unclassified-media' : 'image-language-mismatch' });
        continue;
      }
      updates.push({ table: link, fk, id: row.id, edition: edition.key });
    }
  }
  return { editions, updates, issues };
}
async function main() {
  if (write) {
    let running = false;
    try { await fetch('http://127.0.0.1:1337/_health', { signal: AbortSignal.timeout(2000) }); running = true; } catch (e) {
      if (e.cause?.code !== 'ECONNREFUSED') throw Error('Cannot confirm Strapi is stopped');
    }
    if (running) throw Error('Stop Strapi before --write');
    const columns = db.prepare('PRAGMA table_info(sets)').all().map(c => c.name);
    for (const column of ['language','media_folder_id','is_legacy']) if (!columns.includes(column)) throw Error('Start Strapi once to apply the new schema, then stop it');
    const dir = path.join(root,'.tmp/backups'); fs.mkdirSync(dir,{recursive:true});
    const backup = path.join(dir,`before-set-editions-${Date.now()}.db`);
    await db.backup(backup); console.log('Backup:',backup);
  }
  let report;
  const run = () => {
    report = plan();
    if (!write) return;
    const before = protectedState();
    const existingForeignKeyIssues = new Set(db.pragma('foreign_key_check').map(issue => JSON.stringify(issue)));
    const setIds = new Map();
    const now = Date.now();
    for (const edition of report.editions) {
      const existing = db.prepare('SELECT * FROM sets WHERE key=? OR media_folder_id=?').all(edition.key,edition.mediaFolderId);
      if (existing.length > 1) throw Error('Conflicting set identity: '+edition.key);
      let id = existing[0]?.id;
      // Preserve names corrected from official sources or manually in the CMS.
      if (id) db.prepare('UPDATE sets SET code=?, language=?, media_folder_id=?, is_legacy=0, label_fr=NULL, label_jp=NULL, updated_at=? WHERE id=?')
        .run(edition.code,edition.language,edition.mediaFolderId,now,id);
      else id = db.prepare('INSERT INTO sets (document_id,name,code,language,media_folder_id,is_legacy,key,slug,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?,?,?)')
        .run(crypto.randomBytes(12).toString('hex'),edition.name,edition.code,edition.language,edition.mediaFolderId,edition.key,edition.key.toLowerCase().replace(':','-'),now,now).lastInsertRowid;
      setIds.set(edition.key,id);
    }
    let changed = 0;
    for (const update of report.updates) {
      const id = setIds.get(update.edition);
      const old = db.prepare(`SELECT set_id FROM ${update.table} WHERE ${update.fk}=?`).all(update.id);
      if (old.length === 1 && old[0].set_id === id) continue;
      db.prepare(`DELETE FROM ${update.table} WHERE ${update.fk}=?`).run(update.id);
      db.prepare(`INSERT INTO ${update.table} (${update.fk},set_id) VALUES (?,?)`).run(update.id,id);
      changed++;
    }
    db.prepare('UPDATE sets SET is_legacy=1, label_fr=NULL, label_jp=NULL WHERE media_folder_id IS NULL').run();
    const after = protectedState();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('Protected card/media/collection data changed; rolling back');
    const foreignKeyIssues = db.pragma('foreign_key_check');
    if (foreignKeyIssues.some(issue => !existingForeignKeyIssues.has(JSON.stringify(issue)))) throw Error('New foreign-key issue; rolling back');
    report.preExistingForeignKeyIssues = foreignKeyIssues;
    report.changedRelations = changed;
    report.protectedStateUnchanged = true;
  };
  if (write) db.transaction(run).immediate(); else run();
  const dir=path.join(root,'.tmp/reports');fs.mkdirSync(dir,{recursive:true});
  const output=path.join(dir,`set-editions-${write?'write':'dry-run'}.json`);
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({write,editions:report.editions.length,relations:report.updates.length,issues:report.issues.length,changed:report.changedRelations,protectedStateUnchanged:report.protectedStateUnchanged,report:output},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.close());
