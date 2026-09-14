// SQLite maintenance: stop Strapi before --write. The default is read-only.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const write = process.argv.includes('--write');
const root = path.resolve(__dirname, '..');
const db = new Database(path.join(root, '.tmp/data.db'), { readonly: !write });
db.pragma('busy_timeout = 10000');

const expectedFolders = new Map([
  ['EN:BOOSTERS', 'booster'], ['EN:DECKS DE DEMARRAGE', 'deck'],
  ['FR:BOOSTERS', 'booster'], ['FR:DECKS DE DEMARRAGE', 'deck'],
  ['JP:ブースター', 'booster'], ['JP:デッキ', 'deck'],
]);

function normalizeCode(value) {
  const matches = [...String(value || '').toUpperCase().matchAll(/(?:OP|PRB|EB|ST)[-_ ]?\d{2}/g)];
  return matches.length ? matches.map(match => match[0].replace(/[-_ ]/g, '')).join('-') : null;
}

function folderLanguage(folder, foldersByPathId) {
  const ids = String(folder.path || '').split('/').filter(Boolean).map(Number);
  return ids.map(id => foldersByPathId.get(id)?.name).find(name => ['EN', 'FR', 'JP'].includes(name)) || null;
}

async function main() {
  if (write) {
    let running = false;
    try {
      const response = await fetch('http://127.0.0.1:1337/_health', { signal: AbortSignal.timeout(2000) });
      running = response.ok;
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw new Error('Impossible de confirmer que Strapi est arrêté.');
    }
    if (running) throw new Error('Arrête Strapi avant de lancer avec --write.');
  }

  const folders = db.prepare('SELECT id, name, path, path_id FROM upload_folders').all();
  const foldersByPathId = new Map(folders.map(folder => [Number(folder.path_id), folder]));
  const targetFolders = folders.map(folder => ({ ...folder, language: folderLanguage(folder, foldersByPathId) }))
    .filter(folder => expectedFolders.has(`${folder.language}:${folder.name}`));
  const folderById = new Map(targetFolders.map(folder => [folder.id, folder]));
  const files = db.prepare(`SELECT file.id, file.name, link.folder_id FROM files file JOIN files_folder_lnk link ON link.file_id=file.id WHERE link.folder_id IN (${targetFolders.map(() => '?').join(',') || 'NULL'})`)
    .all(...targetFolders.map(folder => folder.id));

  const mediaByKey = new Map();
  const ignored = [];
  for (const file of files) {
    const folder = folderById.get(file.folder_id);
    const code = normalizeCode(file.name);
    if (!code || (code.startsWith('ST') ? 'deck' : 'booster') !== expectedFolders.get(`${folder.language}:${folder.name}`)) {
      ignored.push(`${folder.language}/${folder.name}/${file.name}`);
      continue;
    }
    const key = `${folder.language}:${code}`;
    if (mediaByKey.has(key)) throw new Error(`Plusieurs images correspondent à ${key}.`);
    mediaByKey.set(key, file);
  }

  const sets = db.prepare("SELECT id, code, language FROM sets WHERE is_legacy=0 AND language IN ('EN','FR','JP')").all();
  const matches = sets.map(set => ({ set, file: mediaByKey.get(`${set.language}:${normalizeCode(set.code)}`) })).filter(match => match.file);
  const unmatchedMedia = [...mediaByKey.keys()].filter(key => !sets.some(set => `${set.language}:${normalizeCode(set.code)}` === key));
  const unmatchedSets = sets.filter(set => !mediaByKey.has(`${set.language}:${normalizeCode(set.code)}`));

  if (write) {
    const backupDir = path.join(root, '.tmp', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `before-set-images-${Date.now()}.db`);
    await db.backup(backup);
    const columns = db.prepare('PRAGMA table_info(files_related_mph)').all().map(column => column.name);
    const insertColumns = ['file_id', 'related_id', 'related_type', 'field'];
    if (columns.includes('order')) insertColumns.push('order');
    const apply = db.transaction(() => {
      if (files.length) {
        db.prepare(`DELETE FROM files_related_mph WHERE related_type='api::set.set' AND field='image' AND file_id IN (${files.map(() => '?').join(',')})`)
          .run(...files.map(file => file.id));
      }
      for (const { set, file } of matches) {
        db.prepare("DELETE FROM files_related_mph WHERE related_type='api::set.set' AND field='image' AND related_id=?").run(set.id);
        const values = [file.id, set.id, 'api::set.set', 'image'];
        if (columns.includes('order')) values.push(1);
        const quotedColumns = insertColumns.map(column => `"${column}"`).join(',');
        db.prepare(`INSERT INTO files_related_mph (${quotedColumns}) VALUES (${insertColumns.map(() => '?').join(',')})`).run(...values);
      }
    });
    apply();
    console.log('Sauvegarde:', backup);
  }

  console.log(JSON.stringify({ mode: write ? 'write' : 'dry-run', targetFolders: targetFolders.map(folder => `${folder.language}/${folder.name}`), matchedSets: matches.length, ignoredFiles: ignored, unmatchedMedia, unmatchedSets: unmatchedSets.map(set => `${set.language}:${set.code}`) }, null, 2));
}

main().finally(() => db.close()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
