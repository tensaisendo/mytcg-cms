/**
 * card-printing controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::card-printing.card-printing', ({ strapi }) => ({
  async mediaFolder(ctx) {
    const fileDocumentId = String(ctx.params.fileDocumentId || '');
    if (!fileDocumentId) return ctx.badRequest('Invalid media identity');

    const connection = strapi.db.connection;
    const folder = await connection('files as file')
      .join('files_folder_lnk as link', 'link.file_id', 'file.id')
      .join('upload_folders as folder', 'folder.id', 'link.folder_id')
      .select('folder.path')
      .where('file.document_id', fileDocumentId)
      .first();
    if (!folder) return ctx.notFound('Media folder not found');

    const pathIds = String(folder.path || '').split('/').filter(Boolean).map(Number).filter(Number.isFinite);
    const folders = pathIds.length
      ? await connection('upload_folders').select('path_id', 'name').whereIn('path_id', pathIds)
      : [];
    const names = new Map(folders.map((item) => [Number(item.path_id), String(item.name)]));
    ctx.body = { data: { path: pathIds.map((id) => names.get(id)).filter(Boolean).join(' / ') } };
  },

  async updateTreatment(ctx) {
    const documentId = String(ctx.params.documentId || '');
    const cardId = String(ctx.request.body?.cardId || '');
    const language = String(ctx.request.body?.language || '').toUpperCase();
    const treatmentDocumentId = ctx.request.body?.treatmentDocumentId == null
      ? null
      : String(ctx.request.body.treatmentDocumentId);

    if (!documentId || !cardId || !['FR', 'JP'].includes(language)) {
      return ctx.badRequest('Invalid printing identity');
    }

    const connection = strapi.db.connection;
    const result = await connection.transaction(async (trx) => {
      const printings = await trx('card_printings')
        .select('id', 'card_id', 'language')
        .where({ document_id: documentId });
      if (!printings.length || printings.some((row) => row.card_id !== cardId || row.language !== language)) {
        return null;
      }

      let treatment = null;
      if (treatmentDocumentId) {
        treatment = await trx('treatments')
          .select('id', 'document_id', 'name')
          .where({ document_id: treatmentDocumentId })
          .first();
        if (!treatment) throw new Error('Treatment not found');
      }

      const printingIds = printings.map((row) => row.id);
      await trx('card_printings_treatment_lnk').whereIn('card_printing_id', printingIds).delete();
      if (treatment) {
        await trx('card_printings_treatment_lnk').insert(
          printingIds.map((printingId) => ({ card_printing_id: printingId, treatment_id: treatment.id })),
        );
      }
      return treatment ? { documentId: treatment.document_id, name: treatment.name } : null;
    });

    if (result === null) {
      const exists = await connection('card_printings').where({ document_id: documentId }).first();
      if (!exists) return ctx.notFound('Printing not found');
      if (exists.card_id !== cardId || exists.language !== language) return ctx.conflict('Printing identity changed');
    }
    ctx.body = { data: { treatment: result } };
  },

  async updatePrice(ctx) {
    const documentId = String(ctx.params.documentId || '');
    const cardId = String(ctx.request.body?.cardId || '');
    const language = String(ctx.request.body?.language || '').toUpperCase();
    const overwrite = ctx.request.body?.overwrite === true;
    const data = ctx.request.body?.data || {};
    const price = Number(data.price);

    if (!documentId || !cardId || !['FR', 'JP'].includes(language) || !Number.isFinite(price) || price <= 0) {
      return ctx.badRequest('Invalid printing price');
    }
    if (!['CardTrader', 'Cardmarket', 'eBay'].includes(data.priceSource) || data.priceCurrency !== 'EUR') {
      return ctx.badRequest('Invalid price source');
    }

    const connection = strapi.db.connection;
    const printings = await connection('card_printings')
      .select('id', 'card_id', 'language', 'price')
      .where({ document_id: documentId });
    if (!printings.length) return ctx.notFound('Printing not found');
    if (printings.some((row) => row.card_id !== cardId || row.language !== language)) {
      return ctx.conflict('Printing identity changed');
    }
    if (!overwrite && printings.some((row) => row.price != null)) {
      return ctx.conflict('Printing already has a price');
    }

    const update = {
      price,
      price_currency: 'EUR',
      price_source: data.priceSource,
      price_updated_at: Date.parse(data.priceUpdatedAt) || Date.now(),
      price_sample_size: data.priceSampleSize ?? null,
      price_scope: data.priceScope,
      price_method: data.priceMethod,
      price_condition: data.priceCondition,
      price_source_url: data.priceSourceUrl,
      updated_at: Date.now(),
    };
    await connection.transaction(async (trx) => {
      await trx('card_printings').whereIn('id', printings.map((row) => row.id)).update(update);
    });
    ctx.body = { data: { price, priceSource: data.priceSource } };
  },

  async updateDistribution(ctx) {
    const documentId = String(ctx.params.documentId || '');
    const cardId = String(ctx.request.body?.cardId || '');
    const language = String(ctx.request.body?.language || '').toUpperCase();
    const data = ctx.request.body?.data || {};

    if (!documentId || !cardId || !['FR', 'JP'].includes(language)) {
      return ctx.badRequest('Invalid printing identity');
    }

    const connection = strapi.db.connection;
    const printings = await connection('card_printings')
      .select('id', 'card_id', 'language')
      .where({ document_id: documentId });
    if (!printings.length) return ctx.notFound('Printing not found');
    if (printings.some((row) => row.card_id !== cardId || row.language !== language)) {
      return ctx.conflict('Printing identity changed');
    }

    const update = {
      distribution: data.distribution || null,
      acquisition: data.acquisition || null,
      event: data.event || null,
      distribution_region: data.distributionRegion || null,
      distribution_source_url: data.distributionSourceUrl || null,
      distribution_verified_at: data.distributionVerifiedAt ? Date.parse(data.distributionVerifiedAt) : null,
      updated_at: Date.now(),
    };
    await connection.transaction(async (trx) => {
      await trx('card_printings').whereIn('id', printings.map((row) => row.id)).update(update);
    });
    ctx.body = { data: { distribution: update.distribution } };
  },
}));
