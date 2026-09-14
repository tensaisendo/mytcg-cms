const PROFILE_UID = 'api::user-profile.user-profile';

export async function ensureProfile(strapi: any, userId: number) {
  const existing = await strapi.db.query(PROFILE_UID).findOne({
    where: { owner: userId },
    populate: { avatar: { select: ['url', 'alternativeText'] } },
  });
  if (existing) return existing;
  return strapi.db.query(PROFILE_UID).create({
    data: { owner: userId, berries: 1000, rewardKeys: ['registration'] },
    populate: { avatar: { select: ['url', 'alternativeText'] } },
  });
}

export async function awardOnce(strapi: any, userId: number, key: string, amount: number) {
  const profile = await ensureProfile(strapi, userId);
  const keys = Array.isArray(profile.rewardKeys) ? profile.rewardKeys.map(String) : [];
  if (keys.includes(key)) return profile;
  return strapi.db.query(PROFILE_UID).update({
    where: { id: profile.id },
    data: { berries: Number(profile.berries || 0) + amount, rewardKeys: [...keys, key] },
    populate: { avatar: { select: ['url', 'alternativeText'] } },
  });
}

export function serializeProfile(user: any, profile: any) {
  const avatarUrl = profile?.avatarData || profile?.avatar?.url || null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    berries: Number(profile?.berries || 0),
    avatar: avatarUrl ? { url: avatarUrl, alternativeText: profile?.avatar?.alternativeText || null } : null,
  };
}
