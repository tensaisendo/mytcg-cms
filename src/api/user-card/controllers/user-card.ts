const UID = 'api::user-card.user-card';
const PRINTING_UID = 'api::card-printing.card-printing';

function readQuantity(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 999) {
    throw new Error(`${field} must be an integer between 0 and 999`);
  }
  return Number(value);
}

function responseEntry(entry: any) {
  return {
    documentId: entry.documentId,
    ownedQuantity: entry.ownedQuantity,
    wantedQuantity: entry.wantedQuantity,
    printing: {
      documentId: entry.printing.documentId,
      printingId: entry.printing.printingId,
      cardId: entry.printing.cardId,
      language: entry.printing.language,
    },
  };
}

export default {
  async mine(ctx: any) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Authentication required');

    const entries = await strapi.db.query(UID).findMany({
      where: { owner: user.id },
      populate: { printing: { select: ['documentId', 'printingId', 'cardId', 'language'] } },
      orderBy: { updatedAt: 'desc' },
    });

    ctx.body = { data: entries.map(responseEntry) };
  },

  async upsert(ctx: any) {
    const user = ctx.state.user;
    if (!user) return ctx.unauthorized('Authentication required');

    const printing = await strapi.db.query(PRINTING_UID).findOne({
      where: { documentId: ctx.params.printingDocumentId, publishedAt: { $notNull: true } },
      select: ['id', 'documentId', 'printingId', 'cardId', 'language'],
    });
    if (!printing) return ctx.notFound('Card printing not found');

    const input = ctx.request.body?.data || ctx.request.body || {};
    let ownedQuantity: number;
    let wantedQuantity: number;
    try {
      ownedQuantity = readQuantity(input.ownedQuantity ?? 0, 'ownedQuantity');
      wantedQuantity = readQuantity(input.wantedQuantity ?? 0, 'wantedQuantity');
    } catch (error) {
      return ctx.badRequest((error as Error).message);
    }

    const entryKey = `${user.id}:${printing.documentId}`;
    const existing = await strapi.db.query(UID).findOne({ where: { entryKey } });

    if (ownedQuantity === 0 && wantedQuantity === 0) {
      if (existing) await strapi.db.query(UID).delete({ where: { id: existing.id } });
      ctx.body = { data: null };
      return;
    }

    const data = {
      entryKey,
      owner: user.id,
      printing: printing.id,
      ownedQuantity,
      wantedQuantity,
    };
    const entry = existing
      ? await strapi.db.query(UID).update({ where: { id: existing.id }, data, populate: { printing: true } })
      : await strapi.db.query(UID).create({ data, populate: { printing: true } });

    ctx.body = { data: responseEntry(entry) };
  },
};
