export default {
  routes: [
    {
      method: 'GET',
      path: '/sets/summary',
      handler: 'set.summary',
      config: {
        auth: false,
      },
    },
  ],
};
