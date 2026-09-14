export default {
  routes: [
    { method: 'GET', path: '/profile/me', handler: 'user-profile.me' },
    { method: 'PUT', path: '/profile/me', handler: 'user-profile.updateMe' },
    { method: 'POST', path: '/profile/check-in', handler: 'user-profile.checkIn' },
  ],
};
