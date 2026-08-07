/* Tenant management: onboard, edit, suspend and open a restaurant's dashboard. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, formatDate, toast, modal, confirmDialog, guard, copyText,
    viewRestaurant, debounce,
  } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'admin', title: t('nav.restaurants'), roles: ['super_admin'] });
  if (!shell) return;

  const state = { status: '', q: '', restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-primary.btn-sm', { onclick: () => createDialog() }, `+ ${t('adm.onboard')}`)]);

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('div.pill-toggle', [['', t('common.all')], ['active', t('staff.active')], ['pending', 'Pending'], ['suspended', 'Suspended']]
        .map(([value, label]) =>
          el('button', {
            type: 'button',
            class: state.status === value ? 'active' : '',
            onclick: () => { state.status = value; renderControls(); load(); },
          }, label))),
      el('div.grow'),
      el('input', {
        type: 'search', placeholder: t('adm.searchRestaurants'), value: state.q,
        style: { maxWidth: '280px' },
        oninput: debounce((event) => { state.q = event.target.value; load(); }, 300),
      }),
    ]));
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.status) query.set('status', state.status);
    if (state.q) query.set('q', state.q);

    try {
      const data = await api.get(`/admin/restaurants?${query.toString()}`);
      state.restaurants = data.restaurants;
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render() {
    if (!state.restaurants.length) {
      mount(root, el('div.card.empty', [
        el('div.empty-icon', '🏪'),
        el('p', state.q || state.status ? t('adm.noMatch') : t('adm.noRestaurants')),
        el('button.btn.btn-primary', { onclick: () => createDialog() }, t('adm.onboardFirst')),
      ]));
      return;
    }

    mount(root, el('div.grid.grid-2', state.restaurants.map(card)));
  }

  const STATUS_TONE = { active: 'badge-ok', pending: 'badge-warn', suspended: 'badge-danger' };

  function card(restaurant) {
    return el('div.card', [
      el('div.card-head', [
        el('div.grow', { style: { minWidth: 0 } }, [
          el('div.row.gap-8', [
            el('h2', { style: { margin: 0 } }, restaurant.name),
            el('span.badge', { class: STATUS_TONE[restaurant.status] }, restaurant.status),
            el('span.badge', { class: restaurant.plan === 'free' ? '' : 'badge-brand' }, restaurant.plan),
          ]),
          el('div.tiny.faint.mono.ltr-inline', `/r/${restaurant.slug}`),
        ]),
      ]),
      el('div.card-body', [
        el('p.small.muted', { style: { minHeight: '2.4em' } }, restaurant.description || t('adm.noDescription')),

        el('div.grid.grid-4.mb-16', [
          metric(t('common.orders'), String(restaurant.order_count)),
          metric(t('common.revenue'), money(restaurant.revenue, restaurant.currency)),
          metric(t('adm.dishes'), String(restaurant.item_count)),
          metric(t('adm.tables'), String(restaurant.table_count)),
        ]),

        el('div.row.between.tiny.faint.mb-16', [
          el('span', t('adm.staffCurrency', { n: restaurant.staff_count, currency: restaurant.currency })),
          el('span', t('adm.joined', { date: formatDate(restaurant.created_at) })),
        ]),

        el('div.row.wrap.gap-8', [
          el('button.btn.btn-primary.btn-sm', { onclick: () => openDashboard(restaurant) }, t('adm.openDashboard')),
          el('button.btn.btn-sm', { onclick: () => editDialog(restaurant) }, t('common.edit')),
          el('button.btn.btn-sm', {
            onclick: () => toggleStatus(restaurant),
          }, restaurant.status === 'suspended' ? t('adm.reactivate') : t('adm.suspend')),
          el('button.btn.btn-sm.btn-ghost', { onclick: () => copyText(restaurant.menu_url), title: t('set.yourMenuLink') }, '🔗'),
          el('button.btn.btn-sm.btn-ghost', { onclick: () => remove(restaurant) }, '🗑'),
        ]),
      ]),
    ]);

    function metric(label, value) {
      return el('div', [el('div.tiny.faint', label), el('div.strong', value)]);
    }
  }

  /** Pin this tenant into the session, then hand the admin the normal dashboard. */
  function openDashboard(restaurant) {
    viewRestaurant.set({ id: restaurant.id, name: restaurant.name, slug: restaurant.slug, currency: restaurant.currency });
    location.href = '/dashboard/';
  }

  const toggleStatus = guard(async (restaurant) => {
    const suspending = restaurant.status !== 'suspended';
    const ok = await confirmDialog({
      title: suspending ? t('adm.suspendTitle', { name: restaurant.name }) : t('adm.reactivateTitle', { name: restaurant.name }),
      message: suspending ? t('adm.suspendBody') : t('adm.reactivateBody'),
      confirmLabel: suspending ? t('adm.suspend') : t('adm.reactivate'),
      danger: suspending,
    });
    if (!ok) return;

    await api.patch(`/admin/restaurants/${restaurant.id}`, { status: suspending ? 'suspended' : 'active' });
    toast(suspending ? t('adm.suspended') : t('adm.reactivated'), 'success');
    load();
  });

  const remove = guard(async (restaurant) => {
    const ok = await confirmDialog({
      title: t('adm.deleteTitle', { name: restaurant.name }),
      message: t('adm.deleteBody'),
      confirmLabel: t('adm.deleteEverything'),
    });
    if (!ok) return;

    // Second gate: the operator must type the slug.
    modal({
      title: t('adm.confirmDeletion'),
      body: [
        el('p', t('adm.typeToConfirm', { slug: restaurant.slug })),
        el('input', { id: 'confirm-slug', type: 'text', autocomplete: 'off' }),
      ],
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-danger', {
          onclick: guard(async () => {
            await api.del(`/admin/restaurants/${restaurant.id}`, { confirm_slug: $('#confirm-slug').value.trim() });
            handle.close();
            toast(t('adm.deleted'), 'success');
            load();
          }),
        }, t('adm.deletePermanently')),
      ],
    });
  });

  function createDialog() {
    modal({
      wide: true,
      title: t('adm.onboardTitle'),
      body: el('form', [
        el('h3', t('landing.restaurant')),
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'new-name' }, t('common.name')),
            el('input', { id: 'new-name', type: 'text', required: true, maxlength: 120 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-slug' }, t('adm.webAddress')),
            el('input', { id: 'new-slug', type: 'text', maxlength: 60, placeholder: t('adm.autoFromName') }),
            el('div.hint', t('adm.webAddressHint')),
          ]),
          el('div.field.full', [
            el('label', { for: 'new-desc' }, t('edit.description')),
            el('input', { id: 'new-desc', type: 'text', maxlength: 800 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-cuisine' }, t('set.cuisine')),
            el('input', { id: 'new-cuisine', type: 'text', maxlength: 80 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-currency' }, t('set.currencyCode')),
            el('input', { id: 'new-currency', type: 'text', maxlength: 8, value: 'USD' }),
          ]),
          el('div.field', [
            el('label', { for: 'new-tax' }, t('set.taxRate')),
            el('input', { id: 'new-tax', type: 'number', min: 0, max: 100, step: '0.01', value: 0 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-service' }, t('set.serviceRate')),
            el('input', { id: 'new-service', type: 'number', min: 0, max: 100, step: '0.01', value: 0 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-plan' }, t('set.plan')),
            el('select', { id: 'new-plan' }, ['free', 'pro', 'enterprise'].map((plan) =>
              el('option', { value: plan }, plan.charAt(0).toUpperCase() + plan.slice(1)))),
          ]),
          el('div.field', [
            el('label', { for: 'new-tables' }, t('adm.starterTables')),
            el('input', { id: 'new-tables', type: 'number', min: 0, max: 60, value: 8 }),
            el('div.hint', t('adm.starterTablesHint')),
          ]),
        ]),

        el('hr'),
        el('h3', t('adm.ownerAccount')),
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'new-owner-name' }, t('adm.ownerName')),
            el('input', { id: 'new-owner-name', type: 'text', required: true, maxlength: 120 }),
          ]),
          el('div.field', [
            el('label', { for: 'new-owner-email' }, t('adm.ownerEmail')),
            el('input', { id: 'new-owner-email', type: 'email', required: true, maxlength: 200 }),
          ]),
          el('div.field.full', [
            el('label', { for: 'new-owner-password' }, t('adm.tempPassword')),
            el('input', { id: 'new-owner-password', type: 'text', required: true, minlength: 8, maxlength: 200 }),
            el('div.hint', t('adm.tempPasswordHint')),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#new-name').value.trim(),
              slug: $('#new-slug').value.trim(),
              description: $('#new-desc').value.trim(),
              cuisine: $('#new-cuisine').value.trim(),
              currency: $('#new-currency').value.trim().toUpperCase() || 'USD',
              tax_rate: Number($('#new-tax').value || 0) / 100,
              service_charge_rate: Number($('#new-service').value || 0) / 100,
              plan: $('#new-plan').value,
              table_count: Number($('#new-tables').value || 0),
              owner_name: $('#new-owner-name').value.trim(),
              owner_email: $('#new-owner-email').value.trim(),
              owner_password: $('#new-owner-password').value,
            };

            if (!payload.name) return toast(t('common.name'), 'error');
            if (!payload.owner_name || !payload.owner_email) return toast(t('adm.ownerAccount'), 'error');
            if (payload.owner_password.length < 8) return toast(t('staff.passwordHint'), 'error');

            await window.App.withBusy(event.currentTarget, () => api.post('/admin/restaurants', payload));
            handle.close();
            toast(t('adm.onboarded'), 'success');
            return load();
          }),
        }, t('adm.createRestaurant')),
      ],
    });
  }

  function editDialog(restaurant) {
    modal({
      wide: true,
      title: t('staff.editMember', { name: restaurant.name }),
      body: el('form', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'ed-name' }, t('common.name')),
          el('input', { id: 'ed-name', type: 'text', required: true, maxlength: 120, value: restaurant.name }),
        ]),
        el('div.field', [
          el('label', { for: 'ed-slug' }, t('adm.webAddress')),
          el('input', { id: 'ed-slug', type: 'text', maxlength: 60, value: restaurant.slug }),
          el('div.hint', t('adm.slugChangeHint')),
        ]),
        el('div.field.full', [
          el('label', { for: 'ed-desc' }, t('edit.description')),
          el('input', { id: 'ed-desc', type: 'text', maxlength: 800, value: restaurant.description }),
        ]),
        el('div.field', [
          el('label', { for: 'ed-currency' }, t('set.currencyCode')),
          el('input', { id: 'ed-currency', type: 'text', maxlength: 8, value: restaurant.currency }),
        ]),
        el('div.field', [
          el('label', { for: 'ed-plan' }, t('set.plan')),
          el('select', { id: 'ed-plan' }, ['free', 'pro', 'enterprise'].map((plan) =>
            el('option', { value: plan, selected: restaurant.plan === plan }, plan.charAt(0).toUpperCase() + plan.slice(1)))),
        ]),
        el('div.field', [
          el('label', { for: 'ed-status' }, t('common.status')),
          el('select', { id: 'ed-status' }, ['active', 'pending', 'suspended'].map((status) =>
            el('option', { value: status, selected: restaurant.status === status }, status))),
        ]),
        el('div.field', [
          el('label', { for: 'ed-tax' }, t('set.taxRate')),
          el('input', { id: 'ed-tax', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.tax_rate * 100).toFixed(2) }),
        ]),
        el('div.field', [
          el('label', { for: 'ed-service' }, t('set.serviceRate')),
          el('input', { id: 'ed-service', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.service_charge_rate * 100).toFixed(2) }),
        ]),
        el('div.field', [
          el('label', t('set.ordering')),
          el('label.check', [
            el('input', { id: 'ed-accepts', type: 'checkbox', checked: restaurant.accepts_orders }),
            el('span', t('adm.acceptingOrders')),
          ]),
        ]),
      ])),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            await window.App.withBusy(event.currentTarget, () =>
              api.patch(`/admin/restaurants/${restaurant.id}`, {
                name: $('#ed-name').value.trim(),
                slug: $('#ed-slug').value.trim(),
                description: $('#ed-desc').value.trim(),
                currency: $('#ed-currency').value.trim().toUpperCase(),
                plan: $('#ed-plan').value,
                status: $('#ed-status').value,
                tax_rate: Number($('#ed-tax').value || 0) / 100,
                service_charge_rate: Number($('#ed-service').value || 0) / 100,
                accepts_orders: $('#ed-accepts').checked,
              }));
            handle.close();
            toast(t('adm.updated'), 'success');
            return load();
          }),
        }, t('common.saveChanges')),
      ],
    });
  }

  renderControls();
  load();
})();
