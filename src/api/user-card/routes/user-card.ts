export default {
  routes: [
    {
      method: 'GET',
      path: '/user-cards/catalog',
      handler: 'user-card.catalog',
      config: { policies: [], middlewares: [] },
    },
    {
      method: 'GET',
      path: '/user-cards/me',
      handler: 'user-card.mine',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'PUT',
      path: '/user-cards/:printingDocumentId',
      handler: 'user-card.upsert',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
