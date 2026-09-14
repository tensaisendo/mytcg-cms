const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { parseMediaIdentity } = require('../../mytcg-hub/scripts/cardMediaIdentity.cjs');

function classify({ language, cardId, sets, ambiguous, existing, canonical }) {
  if (sets.length !== 1 || sets[0].language !== language || sets[0].is_legacy) return 'set-needs-review';
  if (ambiguous) return 'multiple-products';
  if (existing.length) return 'existing-identity-do-not-create';
  if (!parseMediaIdentity(cardId + '.png')) return 'unsupported-import-identity';
  if (sets[0].key?.startsWith('MEDIA-')) return 'generic-product-review';
  if (language !== 'EN' && canonical.length > 1) return 'ambiguous-canonical';
  return language === 'EN' ? 'new-en-candidate' : canonical.length ? 'new-local-printing-candidate' : 'shared-card-review';
}

function main() {
  if (process.argv.includes('--write')) throw Error('Simulation only: --write is not supported');
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [path.join(__dirname, 'audit-set-coverage.cjs')], { stdio: 'inherit' });
  const coverage = JSON.parse(fs.readFileSync(path.join(root, '.tmp/reports/set-coverage.json'), 'utf8'));
  const db = new Database(path.join(root, '.tmp/data.db'), { readonly: true });
  let cards, printings;
  try {
    ({ cards, printings } = db.transaction(() => ({
      cards: db.prepare('SELECT id,document_id,card_id,price FROM cards').all(),
      printings: db.prepare('SELECT id,document_id,card_id,language,price FROM card_printings').all(),
    }))());
  } finally { db.close(); }
  const dedupe = rows => [...new Map(rows.map(r => [r.document_id, { documentId: r.document_id, cardId: r.card_id, hasPrice: rows.some(x => x.document_id === r.document_id && x.price != null) }])).values()];
  const ambiguities = new Set(coverage.ambiguities.map(a => a.key));
  const items = [];
  for (const product of coverage.products) for (const image of product.imagesWithoutLocalRecord) {
    const canonical = dedupe(cards.filter(c => c.card_id?.toUpperCase() === image.cardId));
    const existing = product.language === 'EN' ? canonical : dedupe(printings.filter(c => c.language === product.language && c.card_id?.toUpperCase() === image.cardId));
    const category = classify({ language: product.language, cardId: image.cardId, sets: product.sets, ambiguous: ambiguities.has(product.language + ':' + image.cardId), existing, canonical });
    items.push({ language: product.language, folder: product.folder, setKey: product.key, setId: product.sets[0]?.id || null,
      imageId: image.id, fileName: image.name, cardId: image.cardId, category, existing, canonical,
      nextStep: category.endsWith('candidate') ? 'Fetch exact official data in this language/product, validate payload and uniqueness again before any creation.' : 'Manual or importer/model review required; do not overwrite or clone an existing record.' });
  }
  const summary = {};
  for (const item of items) {
    summary[item.category] ||= { EN: 0, FR: 0, JP: 0, total: 0 };
    summary[item.category][item.language]++;
    summary[item.category].total++;
  }
  const report = { generatedAt: new Date().toISOString(), mode: 'read-only-plan',
    warnings: ['Candidates are not validated creation payloads.', 'No price, treatment or translated text may be copied between variants/languages by filename alone.', 'Coverage and record checks are separate read snapshots; all conditions must be rechecked before future writes.'],
    summary, items };
  const out = path.join(root, '.tmp/reports/card-recovery-plan');
  fs.writeFileSync(out + '.json', JSON.stringify(report, null, 2) + '\n');
  const lines = ['# Simulation du rattrapage des cartes', '', report.generatedAt, '', 'Aucune modification de Strapi. Les candidats demandent encore une validation officielle.', '', '| Categorie | EN | FR | JP | Total |', '|---|---:|---:|---:|---:|'];
  for (const [key, n] of Object.entries(summary)) lines.push(`| ${key} | ${n.EN} | ${n.FR} | ${n.JP} | ${n.total} |`);
  lines.push('', '## Categories', '', '- existing-identity-do-not-create : une fiche avec cet identifiant existe deja ; verifier son image, sans doublon.', '- multiple-products : meme identifiant dans plusieurs produits ; revoir l\'identite de l\'edition.', '- unsupported-import-identity : format non pris en charge par l\'import actuel.', '- generic-product-review : dossier generique sans correspondance produit officielle precise.', '- shared-card-review : aucune Card partagee avec cet identifiant ; ne pas deduire une equivalence EN depuis un suffixe FR/JP.', '- candidate : creation envisageable seulement apres validation des donnees officielles de la bonne langue et du bon produit.', '', 'Identifiants, images, dossiers et fiches existantes dans card-recovery-plan.json.');
  fs.writeFileSync(out + '.md', lines.join('\n') + '\n');
  console.log(JSON.stringify({ total: items.length, summary, report: out + '.md' }, null, 2));
}
module.exports = { classify };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
