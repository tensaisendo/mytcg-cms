const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { folderEdition } = require('./set-edition.cjs');
const root = path.resolve(__dirname, '..');
const db = new Database(path.join(root, '.tmp/data.db'), { readonly: true });
db.pragma('busy_timeout = 10000');

function audit() {
  const folders = db.prepare('SELECT id,name,path FROM upload_folders').all();
  const roots = folders.filter(f => ['EN', 'FR', 'JP'].includes(f.name));
  const sets = db.prepare('SELECT id,key,name,language,media_folder_id,is_legacy FROM sets').all();
  const products = roots.flatMap(r => folders.filter(f => f.path.startsWith(r.path + '/') && f.path.split('/').length === r.path.split('/').length + 1)
    .map(f => ({ ...folderEdition(f.name, r.name, f.id), path: f.path, folder: r.name + '/' + f.name,
      sets: sets.filter(s => s.media_folder_id === f.id), files: [], documents: new Set(), mismatches: [], missing: [], unparsed: [] })));
  const files = db.prepare('SELECT f.id,f.name,l.folder_id FROM files f LEFT JOIN files_folder_lnk l ON l.file_id=f.id').all();
  const byFile = new Map();
  const normalized = name => {
    const match = name.replace(/\.[^.]+$/, '').toUpperCase().match(/^((?:PRB|OP|ST|EB|SD)[-_ ]?\d{2}|P)[-_ ](\d{3})((?:[-_ ][A-Z0-9]+)*)$/);
    return match ? match[1].replace(/[-_ ]/g, '') + '-' + match[2] + match[3].replace(/[-_ ]/g, '_') : null;
  };
  for (const file of files) {
    const folder = folders.find(f => f.id === file.folder_id);
    const product = folder && products.find(p => folder.path === p.path || folder.path.startsWith(p.path + '/'));
    if (!product) continue;
    const item = { id: file.id, name: file.name, cardId: normalized(file.name), references: [] };
    product.files.push(item);
    if (!item.cardId) product.unparsed.push({ id: item.id, name: item.name });
    byFile.set(file.id, { product, item });
  }
  const anomalies = [], records = [];
  for (const [table, type, link, fk] of [['cards','api::card.card','cards_set_lnk','card_id'], ['card_printings','api::card-printing.card-printing','card_printings_set_lnk','card_printing_id']]) {
    const rows = db.prepare(`SELECT id,document_id,card_id,published_at${table === 'cards' ? '' : ',language'} FROM ${table}`).all();
    const images = db.prepare("SELECT related_id,file_id FROM files_related_mph WHERE related_type=? AND field='image'").all(type);
    const links = db.prepare(`SELECT ${fk} AS row_id,set_id FROM ${link}`).all();
    const imageMap = new Map(), setMap = new Map();
    for (const i of images) imageMap.set(i.related_id, [...(imageMap.get(i.related_id) || []), i.file_id]);
    for (const l of links) setMap.set(l.row_id, [...(setMap.get(l.row_id) || []), l.set_id]);
    for (const row of rows) {
      const language = table === 'cards' ? 'EN' : row.language;
      const ref = { table, id: row.id, documentId: row.document_id, cardId: row.card_id, language,
        status: row.published_at == null ? 'draft' : 'published', setIds: setMap.get(row.id) || [] };
      const ids = imageMap.get(row.id) || [];
      records.push({ ...ref, imageIds: ids });
      if (!ids.length) anomalies.push({ ...ref, reason: 'no-image' });
      if (ids.length > 1) anomalies.push({ ...ref, reason: 'multiple-images', imageIds: ids });
      for (const id of ids) {
        const entry = byFile.get(id);
        if (!entry) { anomalies.push({ ...ref, reason: 'image-outside-product-folders', imageId: id }); continue; }
        const { product, item } = entry;
        item.references.push(ref);
        if (language !== product.language) {
          anomalies.push({ ...ref, reason: 'image-language-mismatch', imageId: id, folder: product.folder });
          continue;
        }
        product.documents.add(table + ':' + row.document_id);
        if (ref.setIds.length !== 1 || !product.sets.some(s => s.id === ref.setIds[0] && s.language === language && !s.is_legacy)) {
          product.mismatches.push({ ...ref, imageId: id, expectedSetIds: product.sets.map(s => s.id) });
        }
      }
    }
  }
  const identities = new Map();
  for (const product of products) for (const file of product.files) {
    if (file.cardId && !file.references.some(r => r.language === product.language)) {
      product.missing.push({ id: file.id, name: file.name, cardId: file.cardId,
        candidatesByCodeOnly: file.cardId ? records.filter(r => r.language === product.language && r.cardId?.toUpperCase() === file.cardId).map(r => ({ table: r.table, documentId: r.documentId, status: r.status, imageIds: r.imageIds, setIds: r.setIds })) : [] });
    }
    if (file.cardId) {
      const key = product.language + ':' + file.cardId;
      identities.set(key, [...(identities.get(key) || []), { folder: product.folder, setKey: product.key, imageId: file.id, name: file.name }]);
    }
  }
  const ambiguities = [...identities].filter(([, values]) => new Set(values.map(v => v.setKey)).size > 1).map(([key, images]) => ({ key, images }));
  const duplicateFilenames = [...identities].filter(([, values]) => values.some((v, i) => values.slice(i + 1).some(w => w.setKey === v.setKey))).map(([key, images]) => ({ key, images }));
  const result = products.map(p => ({ key: p.key, language: p.language, folder: p.folder, mediaFolderId: p.mediaFolderId,
    sets: p.sets, fileCount: p.files.length, linkedDocuments: p.documents.size,
    imagesWithoutLocalRecord: p.missing, mismatchedRelations: p.mismatches, unparsedNames: p.unparsed,
    unpublishedOnlyImages: p.files.filter(f => f.references.some(r => r.language === p.language) && !f.references.some(r => r.language === p.language && r.status === 'published')).map(f => ({ id: f.id, name: f.name })) }));
  return { generatedAt: new Date().toISOString(), scope: 'Read-only snapshot. Media folders define products; matching filenames are not proof of matching artwork. Draft/published rows are reported separately; missing means no exact image reference in the same language.',
    summary: { scannedFolders: result.length, foldersWithSet: result.filter(p=>p.sets.length).length, files: result.reduce((n,p) => n+p.fileCount,0), unrecognizedImageNames: result.reduce((n,p)=>n+p.unparsedNames.length,0), missingImages: result.reduce((n,p) => n+p.imagesWithoutLocalRecord.length,0), mismatchedRelationRows: result.reduce((n,p) => n+p.mismatchedRelations.length,0), ambiguousProductIdentities: ambiguities.length, duplicateFilenameGroups: duplicateFilenames.length, anomalousDocuments: new Set(anomalies.map(a=>a.table+':'+a.documentId)).size },
    products: result, ambiguities, duplicateFilenames, anomalies };
}

try {
  const report = db.transaction(audit)();
  const out = path.join(root, '.tmp/reports');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'set-coverage.json'), JSON.stringify(report, null, 2) + '\n');
  const lines = ['# Audit des Sets', '', report.generatedAt, '', 'Lecture seule. Les noms identiques ne prouvent pas un visuel identique.',
    'Sans fiche = image au nom de carte reconnu, non liee a une fiche de sa langue (brouillon ou publication).',
    'Les noms non reconnus (notamment visuels de produits) sont listes a part dans le JSON, sans supposer une carte manquante.',
    'Les relations incorrectes sont comptees par ligne, brouillons et publications compris.', '',
    '| Dossier | Images | Sans fiche | Relations incorrectes |', '|---|---:|---:|---:|'];
  for (const p of report.products.sort((a,b) => a.folder.localeCompare(b.folder))) lines.push(`| ${p.folder.replace(/\|/g,'/')} | ${p.fileCount} | ${p.imagesWithoutLocalRecord.length} | ${p.mismatchedRelations.length} |`);
  lines.push('', '## Bilan', '', '```json', JSON.stringify(report.summary, null, 2), '```', '', 'Details, identifiants et ambiguities : set-coverage.json.', 'Aucune suppression, importation ou modification de la base effectuee.');
  fs.writeFileSync(path.join(out, 'set-coverage.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify({ ...report.summary, report: path.join(out, 'set-coverage.md') }, null, 2));
} finally { db.close(); }
