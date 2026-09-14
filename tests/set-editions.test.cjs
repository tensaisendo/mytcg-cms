const { test } = require('node:test');
const assert = require('node:assert/strict');
const { folderEdition } = require('../scripts/set-edition.cjs');

test('same product code has independent identities per language', () => {
  assert.equal(folderEdition('ST16 - GREEN UTA','EN',43).key,'ST16:EN');
  assert.equal(folderEdition('ST16 - VERT UTA','FR',77).key,'ST16:FR');
  assert.equal(folderEdition('\u3010ST-16\u3011 Uta','JP',12).key,'ST16:JP');
  assert.equal(folderEdition('ST16 - VERT UTA','FR',77).name,'VERT UTA');
});
test('combined regional products are not collapsed into OP14 or EB04', () => {
  const set = folderEdition('OP14-EB04 - THE AZURE SEA','EN',34);
  assert.equal(set.code,'OP14-EB04');
  assert.equal(set.name,'THE AZURE SEA');
  assert.notEqual(set.key,folderEdition('\u3010OP-14\u3011 JP','JP',11).key);
});
test('uncoded promotion folders have stable distinct folder identities', () => {
  assert.equal(folderEdition('Carte promo','FR',67).key,'MEDIA-67:FR');
  assert.equal(folderEdition('Carte promo','FR',67).name,'Carte promo');
  assert.notEqual(folderEdition('Carte promo','FR',67).key,folderEdition("Carte autres produits",'FR',66).key);
});
