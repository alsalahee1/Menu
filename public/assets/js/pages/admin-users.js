/* Every account across the platform: create, re-role, disable, delete. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, formatDateTime, toast, modal, confirmDialog, guard, debounce } = window.App;

  const shell = window.Shell.boot({ kind: 'admin', title: 'Users', roles: ['super_admin'] });
  if (!shell) return;

  const ROLES = ['super_admin', 'owner', 'manager', 'waiter', 'kitchen'];
  const state = { role: '', q: '', restaurantId: '', users: [], restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-primary.btn-sm', { onclick: () => userDialog() }, '+ New user')]);

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('select', {
        style: { maxWidth: '170px' },
        onchange: (event) => { state.role = event.target.value; load(); },
      }, [el('option', { value: '' }, 'All roles'),
          ...ROLES.map((role) => el('option', { value: role, selected: state.role === role }, role.replace('_', ' ')))]),

      el('select', {
        style: { maxWidth: '220px' },
        onchange: (event) => { state.restaurantId = event.target.value; load(); },
      }, [el('option', { value: '' }, 'All restaurants'),
          ...state.restaurants.map((r) =>
            el('option', { value: r.id, selected: String(state.restaurantId) === String(r.id) }, r.name))]),

      el('div.grow'),
      el('input', {
        type: 'search', placeholder: 'Search name or email', value: state.q, style: { maxWidth: '260px' },
        oninput: debounce((event) => { state.q = event.target.value; load(); }, 300),
      }),
    ]));
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.role) query.set('role', state.role);
    if (state.q) query.set('q', state.q);
    if (state.restaurantId) query.set('restaurant_id', state.restaurantId);

    try {
      const [users, restaurants] = await Promise.all([
        api.get(`/admin/users?${query.toString()}`),
        state.restaurants.length ? Promise.resolve({ restaurants: state.restaurants }) : api.get('/admin/restaurants'),
      ]);
      state.users = users.users;
      state.restaurants = restaurants.restaurants;
      renderControls();
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render() {
    if (!state.users.length) {
      mount(root, el('div.card.empty', [el('div.empty-icon', '👥'), el('p', 'No users match these filters.')]));
      return;
    }

    mount(root, el('div.card', [
      el('div.card-head', [el('h2', 'Accounts'), el('span.badge', String(state.users.length))]),
      el('div.table-wrap', el('table.data', [
        el('thead', el('tr', [
          el('th', 'Name'), el('th', 'Email'), el('th', 'Restaurant'),
          el('th', 'Role'), el('th', 'Status'), el('th', 'Last sign-in'), el('th', ''),
        ])),
        el('tbody', state.users.map(userRow)),
      ])),
    ]));
  }

  function userRow(user) {
    const isSelf = user.id === shell.user.id;
    return el('tr', [
      el('td', [el('div.strong', user.name), isSelf ? el('div.tiny.faint', 'This is you') : null]),
      el('td.small.muted', user.email),
      el('td.small', user.restaurant_name || el('span.faint', 'Platform')),
      el('td', el('span.badge', { class: user.role === 'super_admin' ? 'badge-brand' : '' }, user.role.replace('_', ' '))),
      el('td', el('span.badge', { class: user.status === 'active' ? 'badge-ok' : 'badge-danger' }, user.status)),
      el('td.small.muted', user.last_login_at ? formatDateTime(user.last_login_at) : 'Never'),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => userDialog(user) }, 'Edit'),
        !isSelf ? el('button.btn.btn-sm.btn-ghost', { onclick: () => remove(user) }, '🗑') : null,
      ]),
    ]);
  }

  function userDialog(user) {
    const editing = Boolean(user);

    modal({
      title: editing ? `Edit ${user.name}` : 'New user',
      body: el('form', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'u-name' }, 'Full name'),
          el('input', { id: 'u-name', type: 'text', required: true, maxlength: 120, value: editing ? user.name : '' }),
        ]),
        el('div.field', [
          el('label', { for: 'u-phone' }, 'Phone'),
          el('input', { id: 'u-phone', type: 'tel', maxlength: 40, value: editing ? user.phone || '' : '' }),
        ]),
        el('div.field.full', [
          el('label', { for: 'u-email' }, 'Email'),
          el('input', {
            id: 'u-email', type: 'email', required: !editing, maxlength: 200,
            value: editing ? user.email : '', disabled: editing,
          }),
          editing ? el('div.hint', 'Sign-in addresses cannot be changed.') : null,
        ]),
        el('div.field', [
          el('label', { for: 'u-role' }, 'Role'),
          el('select', {
            id: 'u-role',
            onchange: () => { $('#u-restaurant-field').hidden = $('#u-role').value === 'super_admin'; },
          }, ROLES.map((role) =>
            el('option', { value: role, selected: editing && user.role === role }, role.replace('_', ' ')))),
        ]),
        editing
          ? el('div.field', [
              el('label', { for: 'u-status' }, 'Status'),
              el('select', { id: 'u-status' }, ['active', 'disabled'].map((status) =>
                el('option', { value: status, selected: user.status === status }, status))),
            ])
          : null,
        el('div.field.full', { id: 'u-restaurant-field', hidden: editing && user.role === 'super_admin' }, [
          el('label', { for: 'u-restaurant' }, 'Restaurant'),
          el('select', { id: 'u-restaurant' }, state.restaurants.map((r) =>
            el('option', { value: r.id, selected: editing && user.restaurant_id === r.id }, r.name))),
          el('div.hint', 'Platform administrators are not tied to a restaurant.'),
        ]),
        el('div.field.full', [
          el('label', { for: 'u-password' }, editing ? 'New password (leave blank to keep)' : 'Password'),
          el('input', {
            id: 'u-password', type: 'password', minlength: 8, maxlength: 200,
            required: !editing, autocomplete: 'new-password',
          }),
        ]),
      ])),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const role = $('#u-role').value;
            const password = $('#u-password').value;
            const payload = { name: $('#u-name').value.trim(), phone: $('#u-phone').value.trim(), role };

            if (!payload.name) return toast('Please enter a name', 'error');

            if (editing) {
              payload.status = $('#u-status').value;
              if (password) payload.password = password;
            } else {
              payload.email = $('#u-email').value.trim();
              if (password.length < 8) return toast('Password must be at least 8 characters', 'error');
              payload.password = password;
              if (role !== 'super_admin') {
                payload.restaurant_id = Number($('#u-restaurant').value);
                if (!payload.restaurant_id) return toast('Choose a restaurant for this role', 'error');
              }
            }

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/admin/users/${user.id}`, payload) : api.post('/admin/users', payload));
            handle.close();
            toast(editing ? 'User updated' : 'User created', 'success');
            return load();
          }),
        }, editing ? 'Save changes' : 'Create user'),
      ],
    });
  }

  const remove = guard(async (user) => {
    const ok = await confirmDialog({
      title: `Delete ${user.name}?`,
      message: `${user.email} loses access immediately. This cannot be undone.`,
      confirmLabel: 'Delete user',
    });
    if (!ok) return;
    await api.del(`/admin/users/${user.id}`);
    toast('User deleted', 'success');
    load();
  });

  load();
})();
