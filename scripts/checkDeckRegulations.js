'use strict';

const https = require('node:https');

const SOURCE_URL = 'https://en.onepiece-cardgame.com/news/restriction.html';
const EXPECTED_EFFECTIVE_DATE = 'April 10, 2026';
const EXPECTED_CODES = [
  'OP03-040',
  'OP06-047',
  'OP06-086',
  'OP06-116',
  'ST10-001',
  'OP07-115',
  'EB04-058',
  'OP11-040',
  'OP11-067',
  'OP08-069',
].sort();

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MYTCG-HUB regulation checker' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).toString()));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Bandai returned HTTP ${response.statusCode}`));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

async function main() {
  const text = visibleText(await download(SOURCE_URL));
  const activeStart = text.indexOf('Cards with Active Restrictions');
  const historyStart = text.indexOf('Banned/Restricted Cards effective from April 1, 2026', activeStart);
  if (activeStart < 0 || historyStart < 0) throw new Error('The official page structure changed; review it manually.');

  const activeSection = text.slice(activeStart, historyStart);
  const effectiveDateFound = text.includes(`effective from ${EXPECTED_EFFECTIVE_DATE}`);
  const officialCodes = [...new Set(activeSection.match(/\b(?:OP|ST|EB)\d{2}-\d{3}\b/g) || [])].sort();
  const codesMatch = JSON.stringify(officialCodes) === JSON.stringify(EXPECTED_CODES);

  if (!effectiveDateFound || !codesMatch) {
    console.error('Deck regulation update detected.');
    console.error(`Expected effective date: ${EXPECTED_EFFECTIVE_DATE}`);
    console.error(`Expected codes: ${EXPECTED_CODES.join(', ')}`);
    console.error(`Official codes: ${officialCodes.join(', ') || 'none detected'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Deck regulation is current (${EXPECTED_EFFECTIVE_DATE}, ${officialCodes.length} restricted codes).`);
}

main().catch((error) => {
  console.error(`Unable to check deck regulations: ${error.message}`);
  process.exitCode = 1;
});
