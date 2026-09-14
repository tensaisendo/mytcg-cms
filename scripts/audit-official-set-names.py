"""Read-only FR product-name audit using the official product catalogue."""
import json
import re
import sqlite3
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://fr.onepiece-cardgame.com'


class Products(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.titles = []
        self.links = []
        self.capture = None
        self.parts = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if 'linkListColTitle' in attrs.get('class', '').split():
            self.capture = tag
            self.parts = []

    def handle_data(self, text):
        if self.capture:
            self.parts.append(text)

    def handle_endtag(self, tag):
        if tag == self.capture:
            self.titles.append(' '.join(''.join(self.parts).split()))
            self.capture = None


def identity(title):
    match = re.search(r'\[((?:PRB|OP|EB|ST|SD)-?\d{2}(?:-(?:OP|EB|ST|PRB)-?\d{2})*)\]', title)
    if not match:
        return None
    code = '-'.join(re.findall(r'(?:PRB|OP|EB|ST|SD)-?\d{2}', match[1]))
    code = re.sub(r'(PRB|OP|EB|ST|SD)-(\d)', r'\1\2', code)
    name = (title[:match.start()] + title[match.end():]).strip()
    name = re.sub(r'^(?:PREMIUM BOOSTER|EXTRA BOOSTER|BOOSTER|DECK POUR DÉBUTANT|DECK POUR DÉMARRAGE|DECK DE DÉMARRAGE|STARTER DECK|ULTIMATE DECK)(?:\s+EX)?\s*', '', name, flags=re.I)
    return code, name.strip(' -')


def main():
    official = {}
    sources = []
    for category in ['boosters', 'decks']:
        pending, seen = [1], set()
        while pending:
            page = pending.pop(0)
            if page in seen:
                continue
            if page > 30:
                raise RuntimeError('Unexpected pagination')
            seen.add(page)
            url = f'{BASE}/products/?subcategory={category}&page={page}&view=normal'
            request = Request(url, headers={'User-Agent': 'MyTCG-local-set-audit/1.0'})
            with urlopen(request, timeout=30) as response:
                html = response.read().decode('utf-8')
            parser = Products()
            parser.feed(html)
            if not parser.titles:
                raise RuntimeError(f'No product titles parsed: {url}')
            sources.append({'url': url, 'titles': parser.titles})
            for title in parser.titles:
                item = identity(title)
                if item:
                    code, name = item
                    official.setdefault(code, {})[name] = {'title': title, 'source': url}
            for href in parser.links:
                target = urlparse(urljoin(url, href))
                query = parse_qs(target.query)
                if target.netloc == urlparse(BASE).netloc and target.path == '/products/' and query.get('subcategory') == [category]:
                    value = query.get('page', ['1'])[0]
                    if value.isdigit() and int(value) not in seen:
                        pending.append(int(value))
            time.sleep(0.2)
    with sqlite3.connect((ROOT / '.tmp/data.db').as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        sets = [dict(row) for row in db.execute("SELECT id,document_id,code,name,language,key,label_fr,label_jp FROM sets WHERE language='FR' AND is_legacy=0")]
    changes, verified, unresolved = [], [], []
    for item in sets:
        matches = official.get(item['code'], {})
        if len(matches) != 1:
            unresolved.append({**item, 'reason': 'not-found' if not matches else 'ambiguous', 'candidates': matches})
            continue
        name, evidence = next(iter(matches.items()))
        result = {**item, 'proposedName': name, **evidence}
        (verified if item['name'] == name else changes).append(result)
    report = {'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'language': 'FR', 'sources': sources, 'changes': changes, 'verified': verified, 'unresolved': unresolved}
    out = ROOT / '.tmp/reports/official-set-names-fr.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sources': len(sources), 'changes': len(changes), 'verified': len(verified), 'unresolved': len(unresolved), 'report': str(out)}, ensure_ascii=True))


if __name__ == '__main__':
    main()
