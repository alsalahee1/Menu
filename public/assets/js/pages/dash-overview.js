/* Restaurant overview: today's numbers, live activity and quick actions. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, mount, api, money, formatTime, timeAgo, statusBadge, toast, stream, viewRestaurant,
  } = window.App;

  const shell = window.Shell.boot({ kind: 'restaurant', title: 'Overview', roles: ['owner', 'manager', 'super_admin'] });
  if (!shell) return;

  const viewing = viewRestaurant.get();
  const currency = (viewing && viewing.currency) || (shell.user.restaurant && shell.user.restaurant.currency) || 'USD';

  shell.setActions([
    el('a.btn.btn-sm', { href: '/dashboard/orders.html' }, 'Live orders'),
    el('a.btn.btn-primary.btn-sm', { href: '/dashboard/kitchen.html' }, 'Kitchen display'),
  ]);

  const root = el('div');
  shell.page.appendChild(root);

  async function load() {
    try {
      const data = await api.get('/rest/overview');
      render(data);
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
      toast(error.message, 'error');
    }
  }

  function render(data) {
    const active = data.active_by_status;
    const activeTotal = Object.values(active).reduce((sum, n) => sum + n, 0);

    mount(root, [
      el('div.grid.grid-4.mb-24', [
        stat("Today's orders", String(data.today.orders), `${activeTotal} still open`),
        stat("Today's revenue", money(data.today.revenue, currency), `Avg ${money(data.today.avg_ticket, currency)} per order`),
        stat('Tables occupied', String(data.tables_by_status.occupied || 0),
          `${data.tables_by_status.free || 0} free`),
        stat('Guest requests', String(data.open_requests), data.open_requests ? 'Needs attention' : 'All clear',
          data.open_requests ? 'warn' : null),
      ]),

      el('div.grid.grid-2.mb-24', [
        el('div.card', [
          el('div.card-head', [
            el('h2', 'Orders in progress'),
            el('a.btn.btn-sm', { href: '/dashboard/orders.html' }, 'Open board'),
          ]),
          el('div.card-body', activeTotal === 0
            ? el('div.empty', [el('div.empty-icon', '✅'), el('p', 'Nothing in progress right now.')])
            : el('div.grid.grid-4', ['pending', 'accepted', 'preparing', 'ready', 'served'].map((status) =>
                el('div.center', { style: { padding: '10px' } }, [
                  el('div', { style: { fontSize: '1.7rem', fontWeight: '680' } }, String(active[status] || 0)),
                  statusBadge(status),
                ])
              ))),
        ]),

        el('div.card', [
          el('div.card-head', [el('h2', 'Last 7 days')]),
          el('div.card-body', sparkBars(data.last_7_days, currency)),
        ]),
      ]),

      el('div.grid.grid-2', [
        el('div.card', [
          el('div.card-head', [el('h2', 'Recent orders')]),
          data.recent_orders.length
            ? el('div.table-wrap', el('table.data', [
                el('thead', el('tr', [el('th', 'Code'), el('th', 'Table'), el('th', 'Status'), el('th.right', 'Total'), el('th', 'Placed')])),
                el('tbody', data.recent_orders.map((order) =>
                  el('tr', [
                    el('td', el('a.mono.small', { href: `/dashboard/orders.html?order=${order.id}` }, order.code)),
                    el('td.small', order.table_label || 'Takeaway'),
                    el('td', statusBadge(order.status)),
                    el('td.right.small', money(order.total, currency)),
                    el('td.small.muted', formatTime(order.placed_at)),
                  ])
                )),
              ]))
            : el('div.empty', 'No orders yet today.'),
        ]),

        el('div.col.gap-16', [
          el('div.card', [
            el('div.card-head', [el('h2', 'Top sellers · 7 days')]),
            data.top_items.length
              ? el('div.card-body', el('div.col.gap-8', data.top_items.map((item, index) =>
                  el('div.row.between.gap-8', [
                    el('span.small.grow.truncate', `${index + 1}. ${item.name}`),
                    el('span.badge', `${item.qty} sold`),
                    el('span.small.strong.nowrap', money(item.revenue, currency)),
                  ])
                )))
              : el('div.empty', 'Not enough data yet.'),
          ]),

          el('div.card.card-pad', [
            el('div.row.between', [
              el('div', [
                el('div.stat-label', 'Guest rating'),
                el('div', { style: { fontSize: '1.6rem', fontWeight: '680' } },
                  data.rating.avg ? `★ ${data.rating.avg}` : '—'),
              ]),
              el('div.small.muted', `${data.rating.n} review${data.rating.n === 1 ? '' : 's'}`),
            ]),
          ]),
        ]),
      ]),
    ]);
  }

  function stat(label, value, sub, tone) {
    return el('div.card.stat', [
      el('div.stat-label', label),
      el('div.stat-value', { style: tone === 'warn' ? { color: 'var(--warn)' } : null }, value),
      el('div.stat-sub', sub),
    ]);
  }

  /**
   * Compact 7-day revenue bars. Height encodes revenue against the busiest
   * day, so the shape of the week reads at a glance without an axis.
   */
  function sparkBars(days, currencyCode) {
    if (!days.length) return el('div.empty', 'No orders in the last week.');

    const max = Math.max(...days.map((d) => d.revenue), 1);
    return el('div', [
      el('div.row.gap-4', { style: { alignItems: 'flex-end', height: '110px' } },
        days.map((day) =>
          el('div.grow', {
            title: `${day.day}: ${money(day.revenue, currencyCode)} from ${day.orders} orders`,
            style: { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' },
          }, [
            el('div', {
              style: {
                height: `${Math.max(4, (day.revenue / max) * 100)}%`,
                background: 'var(--brand)',
                borderRadius: '5px 5px 2px 2px',
                opacity: '.85',
              },
            }),
          ])
        )),
      el('div.row.gap-4.mt-8', days.map((day) =>
        el('div.grow.center.tiny.faint', new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' }))
      )),
      el('div.row.between.small.muted.mt-8', [
        el('span', 'Revenue per day'),
        el('span.strong', money(days.reduce((sum, d) => sum + d.revenue, 0), currencyCode)),
      ]),
    ]);
  }

  load();

  // Refresh the numbers whenever something actually changes.
  const refresh = window.App.debounce(load, 1200);
  stream('/rest/stream', { 'order.created': refresh, 'order.updated': refresh });
})();
