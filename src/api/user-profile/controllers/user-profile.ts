import { awardOnce, ensureProfile, serializeProfile } from '../../../lib/berries';

const USER_UID = 'plugin::users-permissions.user';
const PROFILE_UID = 'api::user-profile.user-profile';

async function authenticated(ctx: any) {
  if (!ctx.state.user) {
    ctx.unauthorized('Authentication required');
    return null;
  }
  return strapi.db.query(USER_UID).findOne({ where: { id: ctx.state.user.id } });
}

export default {
  async me(ctx: any) {
    const user = await authenticated(ctx);
    if (!user) return;
    ctx.body = { data: serializeProfile(user, await ensureProfile(strapi, user.id)) };
  },

  async checkIn(ctx: any) {
    const user = await authenticated(ctx);
    if (!user) return;
    let profile = await ensureProfile(strapi, user.id);
    profile = await awardOnce(strapi, user.id, 'first-login', 250);
    const today = new Date().toISOString().slice(0, 10);
    if (profile.lastDailyReward !== today) {
      profile = await strapi.db.query(PROFILE_UID).update({
        where: { id: profile.id },
        data: { berries: Number(profile.berries || 0) + 100, lastDailyReward: today },
        populate: { avatar: { select: ['url', 'alternativeText'] } },
      });
    }
    ctx.body = { data: serializeProfile(user, profile) };
  },

  async updateMe(ctx: any) {
    const user = await authenticated(ctx);
    if (!user) return;
    const input = ctx.request.body?.data || ctx.request.body || {};
    const username = String(input.username ?? user.username).trim();
    const email = String(input.email ?? user.email).trim().toLowerCase();
    const currentPassword = String(input.currentPassword || '');
    const avatarData = input.avatarData === null ? null : String(input.avatarData || '');
    if (username.length < 3 || username.length > 40 || !/^\S+@\S+\.\S+$/.test(email)) return ctx.badRequest('Invalid profile fields');
    if ((username !== user.username || email !== user.email) && !currentPassword) return ctx.badRequest('Current password required');
    if (currentPassword) {
      const valid = await strapi.plugin('users-permissions').service('user').validatePassword(currentPassword, user.password);
      if (!valid) return ctx.badRequest('Invalid current password');
    }
    const conflict = await strapi.db.query(USER_UID).findOne({
      where: { $or: [{ username }, { email }], id: { $ne: user.id } },
      select: ['id'],
    });
    if (conflict) return ctx.conflict('Username or email already used');
    const updatedUser = await strapi.plugin('users-permissions').service('user').edit(user.id, { username, email });
    const profile = await ensureProfile(strapi, user.id);
    if (input.avatarData !== undefined) {
      if (avatarData !== null && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatarData) || avatarData.length > 1_500_000)) {
        return ctx.badRequest('Invalid avatar data');
      }
      await strapi.db.query(PROFILE_UID).update({ where: { id: profile.id }, data: { avatarData } });
    }
    const avatarId = input.avatarId === null ? null : Number(input.avatarId);
    if (input.avatarId !== undefined) {
      if (avatarId !== null) {
        const file = await strapi.db.query('plugin::upload.file').findOne({ where: { id: avatarId } });
        if (!file || !String(file.mime || '').startsWith('image/')) return ctx.badRequest('Invalid avatar');
      }
      await strapi.db.query(PROFILE_UID).update({ where: { id: profile.id }, data: { avatar: avatarId } });
    }
    const freshProfile = await strapi.db.query(PROFILE_UID).findOne({ where: { id: profile.id }, populate: { avatar: { select: ['url', 'alternativeText'] } } });
    ctx.body = { data: serializeProfile(updatedUser, freshProfile) };
  },
};
