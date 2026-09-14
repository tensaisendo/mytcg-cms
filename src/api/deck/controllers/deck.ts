import { awardOnce } from '../../../lib/berries';

const DECK_UID = 'api::deck.deck';
const ENTRY_UID = 'api::deck-entry.deck-entry';
const CARD_UID = 'api::card.card';
const REGULATION_UID = 'api::deck-regulation.deck-regulation';

const cardPopulate = { image: true, colors: true, types: true };

function isLeader(card: any) {
  return card.types?.some((type: any) => type.name === 'Leader');
}

function serializeCard(card: any) {
  return {
    documentId: card.documentId,
    cardId: card.cardId,
    displayCode: card.displayCode,
    name: card.name,
    slug: card.slug,
    price: card.price,
    priceCurrency: card.priceCurrency,
    priceSource: card.priceSource,
    priceScope: card.priceScope,
    image: card.image ? { url: card.image.url } : null,
    printings: [],
    colors: card.colors?.map((color: any) => ({ name: color.name })) || [],
    types: card.types?.map((type: any) => ({ name: type.name })) || [],
    cost: card.cost,
  };
}

async function getActiveRegulation(format = 'standard') {
  const today = new Date().toISOString().slice(0, 10);
  const regulations = await strapi.db.query(REGULATION_UID).findMany({
    where: { format, active: true, effectiveFrom: { $lte: today } },
    populate: { restrictions: true },
    orderBy: { effectiveFrom: 'desc' },
    limit: 1,
  });
  return regulations[0] || null;
}

function serializeRestriction(restriction: any) {
  return {
    type: restriction.type,
    displayCode: restriction.displayCode,
    pairedDisplayCode: restriction.pairedDisplayCode || null,
    maxCopies: restriction.maxCopies,
  };
}

function validateDeck(entries: any[], regulation: any) {
  const total = entries.reduce((sum: number, entry: any) => sum + entry.quantity, 0);
  const issues: Array<{ type: string; message: string; displayCodes: string[] }> = [];
  const quantities = new Map(entries.map((entry: any) => [entry.displayCode, entry.quantity]));

  for (const restriction of regulation?.restrictions || []) {
    const quantity = quantities.get(restriction.displayCode) || 0;
    if (restriction.type === 'banned' && quantity > 0) {
      issues.push({
        type: 'banned',
        message: `${restriction.displayCode} est interdite dans ce format.`,
        displayCodes: [restriction.displayCode],
      });
    }
    if (restriction.type === 'restricted') {
      const maxCopies = restriction.maxCopies ?? 1;
      if (quantity > maxCopies) {
        issues.push({
          type: 'restricted',
          message: `${restriction.displayCode} est limitée à ${maxCopies} exemplaire${maxCopies > 1 ? 's' : ''}.`,
          displayCodes: [restriction.displayCode],
        });
      }
    }
    if (
      restriction.type === 'banned_pair' &&
      quantity > 0 &&
      restriction.pairedDisplayCode &&
      (quantities.get(restriction.pairedDisplayCode) || 0) > 0
    ) {
      issues.push({
        type: 'banned_pair',
        message: `${restriction.displayCode} et ${restriction.pairedDisplayCode} ne peuvent pas être jouées ensemble.`,
        displayCodes: [restriction.displayCode, restriction.pairedDisplayCode],
      });
    }
  }

  return {
    total,
    valid: total === 50 && issues.length === 0,
    remaining: Math.max(0, 50 - total),
    issues,
  };
}

function serializeDeck(deck: any, regulation: any) {
  const entries = (deck.entries || []).map((entry: any) => ({
    documentId: entry.documentId,
    quantity: entry.quantity,
    displayCode: entry.displayCode,
    card: serializeCard(entry.card),
  }));
  return {
    documentId: deck.documentId,
    name: deck.name,
    format: deck.format,
    leader: serializeCard(deck.leader),
    entries,
    validation: validateDeck(entries, regulation),
    regulation: regulation ? {
      name: regulation.name,
      effectiveFrom: regulation.effectiveFrom,
      sourceUrl: regulation.sourceUrl,
      restrictions: regulation.restrictions.map(serializeRestriction),
    } : null,
    updatedAt: deck.updatedAt,
  };
}

async function findOwnedDeck(documentId: string, userId: number) {
  return strapi.db.query(DECK_UID).findOne({
    where: { documentId, owner: userId },
    populate: {
      leader: { populate: cardPopulate },
      entries: { populate: { card: { populate: cardPopulate } } },
    },
  });
}

async function findPublishedCard(documentId: string) {
  return strapi.db.query(CARD_UID).findOne({
    where: { documentId, publishedAt: { $notNull: true } },
    populate: cardPopulate,
  });
}

export default {
  async mine(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const decks = await strapi.db.query(DECK_UID).findMany({
      where: { owner: ctx.state.user.id },
      populate: {
        leader: { populate: cardPopulate },
        entries: { populate: { card: { populate: cardPopulate } } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const regulation = await getActiveRegulation();
    ctx.body = {
      data: decks.map((deck: any) => serializeDeck(deck, regulation)),
      regulation: regulation ? {
        name: regulation.name,
        effectiveFrom: regulation.effectiveFrom,
        sourceUrl: regulation.sourceUrl,
        restrictions: regulation.restrictions.map(serializeRestriction),
      } : null,
    };
  },

  async findOne(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const deck = await findOwnedDeck(ctx.params.documentId, ctx.state.user.id);
    if (!deck) return ctx.notFound('Deck not found');
    ctx.body = { data: serializeDeck(deck, await getActiveRegulation(deck.format)) };
  },

  async create(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const input = ctx.request.body?.data || ctx.request.body || {};
    const name = String(input.name || '').trim();
    if (!name || name.length > 80) return ctx.badRequest('Deck name is required');
    const leader = await findPublishedCard(input.leaderDocumentId);
    if (!leader || !isLeader(leader)) return ctx.badRequest('A valid Leader is required');
    const deck = await strapi.db.query(DECK_UID).create({
      data: { name, format: 'standard', owner: ctx.state.user.id, leader: leader.id },
    });
    const profile = await awardOnce(strapi, ctx.state.user.id, `deck:${deck.documentId}`, 500);
    ctx.body = { data: serializeDeck(await findOwnedDeck(deck.documentId, ctx.state.user.id), await getActiveRegulation()), meta: { berries: Number(profile.berries || 0) } };
  },

  async update(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const deck = await findOwnedDeck(ctx.params.documentId, ctx.state.user.id);
    if (!deck) return ctx.notFound('Deck not found');
    const input = ctx.request.body?.data || ctx.request.body || {};
    const leader = input.leaderDocumentId ? await findPublishedCard(input.leaderDocumentId) : deck.leader;
    if (!leader || !isLeader(leader)) return ctx.badRequest('A valid Leader is required');

    const rawEntries = Array.isArray(input.entries) ? input.entries : [];
    const prepared = [];
    const displayCodes = new Set<string>();
    const leaderColors = new Set(leader.colors.map((color: any) => color.name));
    let total = 0;
    for (const raw of rawEntries) {
      const quantity = Number(raw.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 4) return ctx.badRequest('Quantities must be between 1 and 4');
      const card = await findPublishedCard(raw.cardDocumentId);
      if (!card || isLeader(card)) return ctx.badRequest('Main deck cards must not be Leaders');
      if (displayCodes.has(card.displayCode)) return ctx.badRequest(`Duplicate card code: ${card.displayCode}`);
      if (!card.colors.every((color: any) => leaderColors.has(color.name))) return ctx.badRequest(`${card.cardId} is not compatible with the Leader colors`);
      displayCodes.add(card.displayCode);
      total += quantity;
      prepared.push({ card, quantity });
    }
    if (total > 50) return ctx.badRequest('A deck cannot contain more than 50 cards');

    const name = input.name === undefined ? deck.name : String(input.name).trim();
    if (!name || name.length > 80) return ctx.badRequest('Deck name is required');
    await strapi.db.query(DECK_UID).update({ where: { id: deck.id }, data: { name, leader: leader.id } });
    await strapi.db.query(ENTRY_UID).deleteMany({ where: { deck: deck.id } });
    for (const item of prepared) {
      await strapi.db.query(ENTRY_UID).create({
        data: { deck: deck.id, card: item.card.id, displayCode: item.card.displayCode, quantity: item.quantity },
      });
    }
    ctx.body = { data: serializeDeck(await findOwnedDeck(deck.documentId, ctx.state.user.id), await getActiveRegulation(deck.format)) };
  },

  async remove(ctx: any) {
    if (!ctx.state.user) return ctx.unauthorized('Authentication required');
    const deck = await findOwnedDeck(ctx.params.documentId, ctx.state.user.id);
    if (!deck) return ctx.notFound('Deck not found');
    await strapi.db.query(ENTRY_UID).deleteMany({ where: { deck: deck.id } });
    await strapi.db.query(DECK_UID).delete({ where: { id: deck.id } });
    ctx.body = { data: null };
  },
};
