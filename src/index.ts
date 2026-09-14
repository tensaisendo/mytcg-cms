import type { Core } from '@strapi/strapi';

const CURRENT_REGULATION = {
  name: 'Standard - 10 avril 2026',
  format: 'standard',
  effectiveFrom: '2026-04-10',
  sourceUrl: 'https://en.onepiece-cardgame.com/news/restriction.html',
  active: true,
  notes: 'Liste officielle Bandai annoncée le 31 mars 2026.',
};

const CURRENT_RESTRICTIONS: Array<{
  type: 'banned' | 'restricted' | 'banned_pair';
  displayCode: string;
  pairedDisplayCode?: string;
  maxCopies?: number;
}> = [
  ...['OP06-047', 'OP03-040', 'OP06-086', 'ST10-001', 'OP06-116'].map((displayCode) => ({
    type: 'banned' as const, displayCode, maxCopies: 0,
  })),
  { type: 'banned_pair' as const, displayCode: 'OP07-115', pairedDisplayCode: 'EB04-058' },
  { type: 'banned_pair' as const, displayCode: 'OP11-040', pairedDisplayCode: 'OP11-067' },
  { type: 'banned_pair' as const, displayCode: 'OP11-040', pairedDisplayCode: 'OP08-069' },
];

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    let regulation = await strapi.db.query('api::deck-regulation.deck-regulation').findOne({
      where: { format: CURRENT_REGULATION.format, effectiveFrom: CURRENT_REGULATION.effectiveFrom },
    });
    if (!regulation) {
      regulation = await strapi.db.query('api::deck-regulation.deck-regulation').create({
        data: CURRENT_REGULATION,
      });
    }

    for (const restriction of CURRENT_RESTRICTIONS) {
      const existingRestriction = await strapi.db.query('api::card-restriction.card-restriction').findOne({
        where: {
          regulation: regulation.id,
          type: restriction.type,
          displayCode: restriction.displayCode,
          pairedDisplayCode: restriction.pairedDisplayCode || { $null: true },
        },
      });
      if (!existingRestriction) {
        await strapi.db.query('api::card-restriction.card-restriction').create({
          data: { ...restriction, regulation: regulation.id },
        });
      }
    }

    const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'public' },
    });

    if (publicRole) {
      for (const action of [
        'api::treatment.treatment.find',
        'api::card-printing.card-printing.find',
        'api::card-printing.card-printing.findOne',
      ]) {
        const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
          where: { action, role: publicRole.id },
        });
        if (!existing) {
          await strapi.db.query('plugin::users-permissions.permission').create({
            data: { action, role: publicRole.id },
          });
        }
      }
    }

    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });
    if (!role) return;

    for (const action of [
      'api::user-card.user-card.mine',
      'api::user-card.user-card.catalog',
      'api::user-card.user-card.upsert',
      'api::deck.deck.mine',
      'api::deck.deck.findOne',
      'api::deck.deck.create',
      'api::deck.deck.update',
      'api::deck.deck.remove',
      'api::user-profile.user-profile.me',
      'api::user-profile.user-profile.updateMe',
      'api::user-profile.user-profile.checkIn',
      'plugin::upload.content-api.upload',
    ]) {
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: { action, role: role.id },
      });
      if (!existing) {
        await strapi.db.query('plugin::users-permissions.permission').create({
          data: { action, role: role.id },
        });
      }
    }
  },
};
