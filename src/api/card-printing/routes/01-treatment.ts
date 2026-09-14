export default {
  routes: [
    {
      method: 'GET',
      path: '/media-folder/:fileDocumentId',
      handler: 'card-printing.mediaFolder',
    },
    {
      method: 'POST',
      path: '/card-printings/:documentId/treatment',
      handler: 'card-printing.updateTreatment',
    },
    {
      method: 'POST',
      path: '/card-printings/:documentId/price',
      handler: 'card-printing.updatePrice',
    },
    {
      method: 'POST',
      path: '/card-printings/:documentId/distribution',
      handler: 'card-printing.updateDistribution',
    },
  ],
};
