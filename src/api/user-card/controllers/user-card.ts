import { awardOnce, ensureProfile } from '../../../lib/berries';

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
  async catalog(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const language = ['FR', 'JP'].includes(ctx.query.lang) ? ctx.query.lang : 'EN';
    const page = Math.max(1, Math.floor(Number(ctx.query.page) || 1));
    const entries = await strapi.db.query(UID).findMany({
      where: { owner: ctx.state.user.id, ownedQuantity: { $gt: 0 }, printing: { language, publishedAt: { $notNull: true } } },
      populate: { printing: { select: ['id', 'documentId', 'cardId', 'language', 'name', 'price'], populate: { set: true } } },
    });
    const byCode = new Map<string, any>(entries.filter((entry: any) => entry.printing).map((entry: any) => [entry.printing.cardId, entry.printing]));
    const codes = [...byCode.keys()];
    const candidates: any[] = [];
    // Only owned metadata is needed for localized filtering/sorting. Media is
    // populated later, for the selected page only. Bound SQL parameter counts.
    for (let offset = 0; offset < codes.length; offset += 200) {
      candidates.push(...await strapi.db.query('api::card.card').findMany({
        where: { cardId: { $in: codes.slice(offset, offset + 200) }, publishedAt: { $notNull: true } },
        select: ['id', 'documentId', 'cardId', 'name', 'price'],
        populate: { set: true, rarity: true, treatment: true, colors: true, types: true },
      }));
    }
    const query = String(ctx.query.query || '').trim().toLocaleLowerCase();
    const display = (card: any) => language === 'EN' ? card : { ...card, ...byCode.get(card.cardId), set: byCode.get(card.cardId)?.set || null };
    const matches = candidates.filter((card) => {
      const local = display(card);
      return (!query || local.name.toLocaleLowerCase().includes(query) || card.cardId.toLocaleLowerCase().includes(query))
        && (!ctx.query.set || local.set?.code === ctx.query.set)
        && (!ctx.query.rarity || card.rarity?.name === ctx.query.rarity)
        && (!ctx.query.treatment || card.treatment?.name === ctx.query.treatment)
        && (!ctx.query.color || card.colors.some((value: any) => value.name === ctx.query.color))
        && (!ctx.query.type || card.types.some((value: any) => value.name === ctx.query.type));
    }).sort((a, b) => {
      const left = display(a), right = display(b);
      const tie = a.cardId.localeCompare(b.cardId, undefined, { numeric: true });
      if (ctx.query.sort === 'name') return left.name.localeCompare(right.name) || tie;
      if (ctx.query.sort === 'price-asc') return (left.price == null ? Infinity : Number(left.price)) - (right.price == null ? Infinity : Number(right.price)) || tie;
      if (ctx.query.sort === 'price-desc') return (right.price == null ? -Infinity : Number(right.price)) - (left.price == null ? -Infinity : Number(left.price)) || tie;
      return tie;
    });
    const selected = matches.slice((page - 1) * 12, page * 12);
    const cards = selected.length ? await strapi.db.query('api::card.card').findMany({
      where: { id: { $in: selected.map((card) => card.id) } },
      select: ['id', 'documentId', 'name', 'slug', 'cardId', 'displayCode', 'variant', 'price', 'cost', 'power', 'life', 'counter'],
      populate: { image: { select: ['url', 'alternativeText'] }, set: true, rarity: true, treatment: true, colors: true, types: true },
    }) : [];
    const printings = selected.length ? await strapi.db.query(PRINTING_UID).findMany({
      where: { id: { $in: selected.map((card) => byCode.get(card.cardId).id) } },
      populate: { image: { select: ['url', 'alternativeText'] }, set: true },
    }) : [];
    ctx.set('Cache-Control', 'private, no-store');
    ctx.body = {
      cards: selected.map((selectedCard) => ({ ...cards.find((card: any) => card.id === selectedCard.id), printings: printings.filter((printing: any) => printing.cardId === selectedCard.cardId) })),
      page, pageCount: Math.ceil(matches.length / 12), total: matches.length,
    };
  },
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
      populate: { set: { select: ['id', 'key'] } },
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

    let rewardProfile = await ensureProfile(strapi, user.id);
    if (ownedQuantity > 0 && (!existing || existing.ownedQuantity === 0)) {
      rewardProfile = await awardOnce(strapi, user.id, `owned:${printing.documentId}`, 25);
    }
    if (wantedQuantity > 0 && (!existing || existing.wantedQuantity === 0)) {
      rewardProfile = await awardOnce(strapi, user.id, `favorite:${printing.documentId}`, 10);
    }
    if (ownedQuantity > 0 && printing.set) {
      const [setSize, ownedInSet] = await Promise.all([
        strapi.db.query(PRINTING_UID).count({ where: { set: printing.set.id, language: printing.language, publishedAt: { $notNull: true } } }),
        strapi.db.query(UID).count({ where: { owner: user.id, ownedQuantity: { $gt: 0 }, printing: { set: printing.set.id, language: printing.language } } }),
      ]);
      if (setSize > 0 && ownedInSet >= setSize) {
        rewardProfile = await awardOnce(strapi, user.id, `set-complete:${printing.set.key}`, 2500);
      }
    }

    ctx.body = { data: responseEntry(entry), meta: { berries: Number(rewardProfile.berries || 0) } };
  },
};
