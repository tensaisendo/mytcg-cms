const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const write = process.argv.includes('--write');
process.loadEnvFile(path.join(root, '../mytcg-hub/.env.local'));
const base = (process.env.NEXT_PUBLIC_STRAPI_URL || 'http://127.0.0.1:1337').replace(/\/$/, '').replace(/\/api$/, '');
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Local Strapi only');
const token = process.env.STRAPI_API_TOKEN;
if (!token) throw Error('Missing STRAPI_API_TOKEN');
async function request(documentId, name) {
  const response = await fetch(`${base}/api/sets/${encodeURIComponent(documentId)}`, {
    method: name === undefined ? 'GET' : 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(name === undefined ? {} : { body: JSON.stringify({ data: { name } }) }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Set ${documentId}: HTTP ${response.status}`);
  return (await response.json()).data;
}
async function main() {
  const report = JSON.parse(fs.readFileSync(path.join(root, '.tmp/reports/official-set-names-fr.json'), 'utf8'));
  const planned = [], alreadyApplied = [];
  if (report.language !== 'FR') throw Error('Expected FR audit');
  for (const change of report.changes) {
    if (new URL(change.source).hostname !== 'fr.onepiece-cardgame.com' || change.language !== 'FR' || !change.proposedName?.trim()) throw Error('Invalid official evidence');
    const current = await request(change.document_id);
    if (current.language !== 'FR' || current.code !== change.code || current.key !== change.key || current.isLegacy) throw Error(`Identity changed: ${change.key}`);
    if (current.name === change.proposedName) { alreadyApplied.push(change.key); continue; }
    if (current.name !== change.name) throw Error(`Name changed since audit: ${change.key}`);
    planned.push({ documentId: change.document_id, key: change.key, before: current.name, after: change.proposedName, source: change.source });
  }
  const journal = { generatedAt: new Date().toISOString(), write, planned, alreadyApplied, applied: [] };
  const output = path.join(root, `.tmp/reports/official-set-names-${write ? 'write-' + Date.now() : 'dry-run'}.json`);
  const save = () => fs.writeFileSync(output, JSON.stringify(journal, null, 2) + '\n');
  save();
  for (const change of write ? planned : []) {
    const current = await request(change.documentId);
    if (current.name !== change.before || current.key !== change.key || current.language !== 'FR') throw Error(`Concurrent edit: ${change.key}`);
    await request(change.documentId, change.after);
    const updated = await request(change.documentId);
    if (updated.name !== change.after) throw Error(`Verification failed: ${change.key}`);
    journal.applied.push(change.key);
    save();
  }
  console.log(JSON.stringify({ write, planned: planned.length, alreadyApplied: alreadyApplied.length, applied: journal.applied.length, journal: output }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
