/**
 * set controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::set.set', ({ strapi }) => ({
  async summary(ctx) {
    const requested = String(ctx.query.language || 'EN').toUpperCase();
    const language = requested === 'FR' || requested === 'JP' ? requested : 'EN';
    const uid = language === 'EN' ? 'api::card.card' : 'api::card-printing.card-printing';
    const where = language === 'EN'
      ? { publishedAt: { $notNull: true }, set: { language, isLegacy: false } }
      : { publishedAt: { $notNull: true }, language, set: { language, isLegacy: false } };
    const entries = await strapi.db.query(uid).findMany({
      where,
      select: ['documentId', 'cardId'],
      populate: {
        set: { select: ['documentId', 'name', 'language', 'code', 'key'] },
      },
      orderBy: { cardId: 'asc' },
    });

    const sets = await strapi.db.query('api::set.set').findMany({
      where: { language, isLegacy: false },
      select: ['name', 'code', 'language', 'key', 'labelFr', 'labelJp'],
      populate: { image: { select: ['url', 'alternativeText', 'formats'] } },
    });
    const summaries = new Map(sets.map(set => [set.key, {
      name: set.name,
      code: set.code,
      language: set.language,
      key: set.key,
      labelFr: set.labelFr,
      labelJp: set.labelJp,
      image: set.image || null,
      count: 0,
      printingIds: [] as string[],
    }]));
    for (const entry of entries) {
      if (!entry.set) continue;
      const key = entry.set.key;
      const current = summaries.get(key);
      if (current) {
        current.count += 1;
        current.printingIds.push(entry.documentId);
        continue;
      }
      summaries.set(key, {
        name: entry.set.name,
        language: entry.set.language,
        key,
        code: entry.set.code,
        labelFr: null,
        labelJp: null,
        image: null,
        count: 1,
        printingIds: [entry.documentId],
      });
    }
    ctx.body = { data: [...summaries.values()] };
  },
}));
