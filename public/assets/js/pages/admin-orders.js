/* Cross-tenant order feed for platform support. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, money, formatDateTime, statusBadge, debounce } = window.App;

  const shell = window.Shell.boot({ kind: 'admin', title: 'All orders', roles: ['super_admin'] });
  if (!shell) return;

  const STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
  const state = { restaurantId: '', status: '', q: '', orders: [], restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-sm', { onclick: () => load() }, '↻ Refresh')]);

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('select', {
        style: { maxWidth: '230px' },
        onchange: (event) => { state.restaurantId = event.target.value; load(); },
      }, [el('option', { value: '' }, 'All restaurants'),
          ...state.restaurants.map((r) =>
            el('option', { value: r.id, selected: String(state.restaurantId) === String(r.id) }, r.name))]),

      el('select', {
        style: { maxWidth: '170px' },
        onchange: (event) => { state.status = event.target.value; load(); },
      }, [el('option', { value: '' }, 'Any status'),
          ...STATUSES.map((status) =>
            el('option', { value: status, selected: state.status === status }, status))]),

      el('div.grow'),
      el('input', {
        type: 'search', placeholder: 'Search by order code', value: state.q, style: { maxWidth: '220px' },
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
      mount(root, el('div.card.empty', [el('div.empty-icon', '🧾'), el('p', 'No orders match these filters.')]));
      return;
    }

    mount(root, el('div.card', [
      el('div.card-head', [el('h2', 'Orders'), el('span.badge', String(state.orders.length))]),
      el('div.table-wrap', el('table.data', [
        el('thead', el('tr', [
          el('th', 'Code'), el('th', 'Restaurant'), el('th', 'Table'),
          el('th', 'Status'), el('th', 'Payment'), el('th.right', 'Total'), el('th', 'Placed'), el('th', ''),
        ])),
        el('tbody', state.orders.map((order) =>
          el('tr', [
            el('td.mono.small', order.code),
            el('td.small', order.restaurant_name),
            el('td.small.muted', order.table_label || 'Takeaway'),
            el('td', statusBadge(order.status)),
            el('td', el('span.badge', { class: order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn' }, order.payment_status)),
            el('td.right.small.strong', money(order.total, order.currency)),
            el('td.small.muted', formatDateTime(order.placed_at)),
            el('td.actions', el('a.btn.btn-sm', { href: `/order/${order.code}`, target: '_blank', rel: 'noopener' }, 'View ↗')),
          ])
        )),
      ])),
    ]));
  }

  load();
})();
