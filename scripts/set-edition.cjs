const CODE = '(?:PRB|OP|EB|ST|SD)[- ]?\\d{2}';

function folderEdition(name, language, folderId) {
  const leading = String(name).match(new RegExp(`^[\\s\\[\\u3010(]*(${CODE}(?:[-/]${CODE})*)[\\]\\u3011)]?\\s*(?:[-:]\\s*)?`, 'i'));
  const code = leading ? Array.from(leading[1].toUpperCase().matchAll(new RegExp(CODE, 'g')), m => m[0].replace(/[- ]/g, '')).join('-') : `MEDIA-${folderId}`;
  return { code, language, mediaFolderId: folderId, key: `${code}:${language}`, name: leading ? name.slice(leading[0].length).trim() || code : name.trim() };
}

module.exports = { folderEdition };
