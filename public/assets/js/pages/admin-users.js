/* Every account across the platform: create, re-role, disable, delete. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, formatDateTime, toast, modal, confirmDialog, guard, debounce } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'admin', title: t('nav.users'), roles: ['super_admin'] });
  if (!shell) return;

  const ROLES = ['super_admin', 'owner', 'manager', 'waiter', 'kitchen'];
  const state = { role: '', q: '', restaurantId: '', users: [], restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-primary.btn-sm', { onclick: () => userDialog() }, `+ ${t('adm.newUser')}`)]);

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('select', {
        style: { maxWidth: '170px' },
        onchange: (event) => { state.role = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.allRoles')),
          ...ROLES.map((role) => el('option', { value: role, selected: state.role === role }, role.replace('_', ' ')))]),

      el('select', {
        style: { maxWidth: '220px' },
        onchange: (event) => { state.restaurantId = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.allRestaurants')),
          ...state.restaurants.map((r) =>
            el('option', { value: r.id, selected: String(state.restaurantId) === String(r.id) }, r.name))]),

      el('div.grow'),
      el('input', {
        type: 'search', placeholder: t('adm.searchUsers'), value: state.q, style: { maxWidth: '260px' },
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
      mount(root, el('div.card.empty', [el('div.empty-icon', '👥'), el('p', t('adm.noUsers'))]));
      return;
    }

    mount(root, el('div.card', [
      el('div.card-head', [el('h2', t('adm.accounts')), el('span.badge', String(state.users.length))]),
      el('div.table-wrap', el('table.data', [
        el('thead', el('tr', [
          el('th', t('common.name')), el('th', t('common.email')), el('th', t('landing.restaurant')),
          el('th', t('common.role')), el('th', t('common.status')), el('th', t('staff.lastSignIn')), el('th', ''),
        ])),
        el('tbody', state.users.map(userRow)),
      ])),
    ]));
  }

  function userRow(user) {
    const isSelf = user.id === shell.user.id;
    return el('tr', [
      el('td', [el('div.strong', user.name), isSelf ? el('div.tiny.faint', t('staff.thisIsYou')) : null]),
      el('td.small.muted', user.email),
      el('td.small', user.restaurant_name || el('span.faint', t('adm.platformLabel'))),
      el('td', el('span.badge', { class: user.role === 'super_admin' ? 'badge-brand' : '' }, user.role.replace('_', ' '))),
      el('td', el('span.badge', { class: user.status === 'active' ? 'badge-ok' : 'badge-danger' }, user.status)),
      el('td.small.muted', user.last_login_at ? formatDateTime(user.last_login_at) : t('common.never')),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => userDialog(user) }, t('common.edit')),
        !isSelf ? el('button.btn.btn-sm.btn-ghost', { onclick: () => remove(user) }, '🗑') : null,
      ]),
    ]);
  }

  function userDialog(user) {
    const editing = Boolean(user);

    modal({
      title: editing ? t('staff.editMember', { name: user.name }) : t('adm.newUser'),
      body: el('form', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'u-name' }, t('staff.fullName')),
          el('input', { id: 'u-name', type: 'text', required: true, maxlength: 120, value: editing ? user.name : '' }),
        ]),
        el('div.field', [
          el('label', { for: 'u-phone' }, t('common.phone')),
          el('input', { id: 'u-phone', type: 'tel', maxlength: 40, value: editing ? user.phone || '' : '' }),
        ]),
        el('div.field.full', [
          el('label', { for: 'u-email' }, t('common.email')),
          el('input', {
            id: 'u-email', type: 'email', required: !editing, maxlength: 200,
            value: editing ? user.email : '', disabled: editing,
          }),
          editing ? el('div.hint', t('adm.emailFixed')) : null,
        ]),
        el('div.field', [
          el('label', { for: 'u-role' }, t('common.role')),
          el('select', {
            id: 'u-role',
            onchange: () => { $('#u-restaurant-field').hidden = $('#u-role').value === 'super_admin'; },
          }, ROLES.map((role) =>
            el('option', { value: role, selected: editing && user.role === role }, role.replace('_', ' ')))),
        ]),
        editing
          ? el('div.field', [
              el('label', { for: 'u-status' }, t('common.status')),
              el('select', { id: 'u-status' }, ['active', 'disabled'].map((status) =>
                el('option', { value: status, selected: user.status === status }, status === 'active' ? t('staff.active') : t('staff.disabled')))),
            ])
          : null,
        el('div.field.full', { id: 'u-restaurant-field', hidden: editing && user.role === 'super_admin' }, [
          el('label', { for: 'u-restaurant' }, t('landing.restaurant')),
          el('select', { id: 'u-restaurant' }, state.restaurants.map((r) =>
            el('option', { value: r.id, selected: editing && user.restaurant_id === r.id }, r.name))),
          el('div.hint', t('adm.restaurantFieldHint')),
        ]),
        el('div.field.full', [
          el('label', { for: 'u-password' }, editing ? t('staff.newPassword') : t('common.password')),
          el('input', {
            id: 'u-password', type: 'password', minlength: 8, maxlength: 200,
            required: !editing, autocomplete: 'new-password',
          }),
        ]),
      ])),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const role = $('#u-role').value;
            const password = $('#u-password').value;
            const payload = { name: $('#u-name').value.trim(), phone: $('#u-phone').value.trim(), role };

            if (!payload.name) return toast(t('staff.fullName'), 'error');

            if (editing) {
              payload.status = $('#u-status').value;
              if (password) payload.password = password;
            } else {
              payload.email = $('#u-email').value.trim();
              if (password.length < 8) return toast(t('staff.passwordHint'), 'error');
              payload.password = password;
              if (role !== 'super_admin') {
                payload.restaurant_id = Number($('#u-restaurant').value);
                if (!payload.restaurant_id) return toast(t('landing.restaurant'), 'error');
              }
            }

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/admin/users/${user.id}`, payload) : api.post('/admin/users', payload));
            handle.close();
            toast(editing ? t('adm.userUpdated') : t('adm.userCreated'), 'success');
            return load();
          }),
        }, editing ? t('common.saveChanges') : t('adm.createUser')),
      ],
    });
  }

  const remove = guard(async (user) => {
    const ok = await confirmDialog({
      title: t('adm.deleteUserTitle', { name: user.name }),
      message: t('adm.deleteUserBody', { email: user.email }),
      confirmLabel: t('adm.deleteUser'),
    });
    if (!ok) return;
    await api.del(`/admin/users/${user.id}`);
    toast(t('adm.userDeleted'), 'success');
    load();
  });

  load();
})();
