export default {
  routes: [
    { method: 'GET', path: '/decks/me', handler: 'deck.mine' },
    { method: 'GET', path: '/decks/:documentId', handler: 'deck.findOne' },
    { method: 'POST', path: '/decks', handler: 'deck.create' },
    { method: 'PUT', path: '/decks/:documentId', handler: 'deck.update' },
    { method: 'DELETE', path: '/decks/:documentId', handler: 'deck.remove' }
  ]
};
