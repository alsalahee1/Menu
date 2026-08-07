/* Cross-tenant order feed for platform support. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, money, formatDateTime, statusBadge, debounce } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'admin', title: t('nav.allOrders'), roles: ['super_admin'] });
  if (!shell) return;

  const STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
  const state = { restaurantId: '', status: '', q: '', orders: [], restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-sm', { onclick: () => load() }, `↻ ${t('common.refresh')}`)]);

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('select', {
        style: { maxWidth: '230px' },
        onchange: (event) => { state.restaurantId = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.allRestaurants')),
          ...state.restaurants.map((r) =>
            el('option', { value: r.id, selected: String(state.restaurantId) === String(r.id) }, r.name))]),

      el('select', {
        style: { maxWidth: '170px' },
        onchange: (event) => { state.status = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.anyStatus')),
          ...STATUSES.map((status) =>
            el('option', { value: status, selected: state.status === status }, window.App.statusLabel(status)))]),

      el('div.grow'),
      el('input', {
        type: 'search', placeholder: t('adm.searchOrderCode'), value: state.q, style: { maxWidth: '220px' },
        oninput: debounce((event) => { state.q = event.target.value; load(); }, 300),
      }),
    ]));
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.restaurantId) query.set('restaurant_id', state.restaurantId);
    if (state.status) query.set('status', state.status);
    if (state.q) query.set('q', state.q);

    try {
      const [orders, restaurants] = await Promise.all([
        api.get(`/admin/orders?${query.toString()}`),
        state.restaurants.length ? Promise.resolve({ restaurants: state.restaurants }) : api.get('/admin/restaurants'),
      ]);
      state.orders = orders.orders;
      state.restaurants = restaurants.restaurants;
      renderControls();
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render() {
    if (!state.orders.length) {
      mount(root, el('div.card.empty', [el('div.empty-icon', '🧾'), el('p', t('adm.noOrders'))]));
      return;
    }

    mount(root, el('div.card', [
      el('div.card-head', [el('h2', t('common.orders')), el('span.badge', String(state.orders.length))]),
      el('div.table-wrap', el('table.data', [
        el('thead', el('tr', [
          el('th', t('dash.code')), el('th', t('landing.restaurant')), el('th', t('common.table')),
          el('th', t('common.status')), el('th', t('board.payment')), el('th.right', t('common.total')), el('th', t('dash.placed')), el('th', ''),
        ])),
        el('tbody', state.orders.map((order) =>
          el('tr', [
            el('td.mono.small.ltr-inline', order.code),
            el('td.small', order.restaurant_name),
            el('td.small.muted', order.table_label || t('common.takeaway')),
            el('td', statusBadge(order.status)),
            el('td', el('span.badge', { class: order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn' }, order.payment_status)),
            el('td.right.small.strong', money(order.total, order.currency)),
            el('td.small.muted', formatDateTime(order.placed_at)),
            el('td.actions', el('a.btn.btn-sm', { href: `/order/${order.code}`, target: '_blank', rel: 'noopener' }, `${t('adm.view')} ↗`)),
          ])
        )),
      ])),
    ]));
  }

  load();
})();
