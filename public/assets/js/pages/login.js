/* Staff sign-in. Routes each role to the screen it actually needs. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, auth, viewRestaurant, params } = window.App;

  const DEMO_ACCOUNTS = [
    { label: 'Platform admin', email: 'admin@menu.app', password: 'Admin123!' },
    { label: 'Restaurant owner', email: 'owner@zaytoun.test', password: 'Owner123!' },
    { label: 'Manager', email: 'manager@zaytoun.test', password: 'Manager123!' },
    { label: 'Waiter', email: 'waiter@zaytoun.test', password: 'Waiter123!' },
    { label: 'Kitchen', email: 'kitchen@zaytoun.test', password: 'Kitchen123!' },
  ];

  mount($('#demo-accounts'), DEMO_ACCOUNTS.map((account) =>
    el('button.btn.btn-sm.btn-block', {
      type: 'button',
      style: { justifyContent: 'space-between' },
      onclick: () => {
        $('#email').value = account.email;
        $('#password').value = account.password;
        $('#submit').focus();
      },
    }, [el('span', account.label), el('span.tiny.faint.mono', account.email)])
  ));

  // Already signed in? Skip straight through.
  if (auth.token && auth.user) {
    location.replace(params().get('next') || auth.user.home || '/dashboard/');
    return;
  }

  const errorBox = $('#error');

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#submit');
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';

    try {
      const { token, user } = await api.post(
        '/auth/login',
        { email: $('#email').value.trim(), password: $('#password').value },
        { anonymous: true }
      );

      auth.save(token, user);
      // A fresh sign-in must never inherit another session's tenant context.
      viewRestaurant.clear();

      const next = params().get('next');
      location.href = next && next.startsWith('/') ? next : user.home || '/dashboard/';
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
})();
