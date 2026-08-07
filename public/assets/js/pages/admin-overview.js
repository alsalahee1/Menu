/* Platform overview: tenants, users, order volume and the revenue leaderboard. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, money, toast } = window.App;

  const shell = window.Shell.boot({ kind: 'admin', title: 'Platform overview', roles: ['super_admin'] });
  if (!shell) return;

  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('a.btn.btn-sm', { href: '/admin/restaurants.html' }, 'Manage restaurants'),
    el('button.btn.btn-sm', { onclick: () => window.Shell.passwordDialog() }, 'Change password'),
  ]);

  async function load() {
    try {
      render(await api.get('/admin/stats'));
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
      toast(error.message, 'error');
    }
  }

  function render(stats) {
    const byStatus = stats.restaurants_by_status;
    const totalTenants = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    const totalUsers = Object.values(stats.users_by_role).reduce((sum, n) => sum + n, 0);

    mount(root, [
      el('div.grid.grid-4.mb-16', [
        stat('Restaurants', String(totalTenants),
          `${byStatus.active || 0} active · ${byStatus.pending || 0} pending · ${byStatus.suspended || 0} suspended`),
        stat('Total orders', stats.totals.orders.toLocaleString(), `${stats.today.orders} today`),
        stat('Gross volume', money(stats.totals.gmv, 'USD'), `${money(stats.today.gmv, 'USD')} today`),
        stat('User accounts', String(totalUsers), `${stats.leads} inbound leads`),
      ]),

      el('div.card.mb-16', [
        el('div.card-head', [el('h2', 'Orders per day · last 14 days')]),
        el('div.card-body', window.Charts.areaLine({
          ariaLabel: 'Platform orders per day',
          height: 210,
          format: (n) => String(Math.round(n)),
          data: stats.last_14_days.map((day) => ({
            label: new Date(`${day.day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
            title: day.day,
            value: day.orders,
            detail: [`${day.orders} orders`, money(day.gmv, 'USD')],
          })),
        })),
      ]),

      el('div.grid.grid-2', [
        el('div.card', [
          el('div.card-head', [el('h2', 'Revenue leaderboard')]),
          stats.leaderboard.length
            ? el('div.table-wrap', el('table.data', [
                el('thead', el('tr', [
                  el('th', '#'), el('th', 'Restaurant'), el('th', 'Plan'),
                  el('th.right', 'Orders'), el('th.right', 'Revenue'),
                ])),
                el('tbody', stats.leaderboard.map((row, index) =>
                  el('tr', [
                    el('td.faint.small', String(index + 1)),
                    el('td', [
                      el('div.strong', row.name),
                      el('div.tiny.faint.mono', `/r/${row.slug}`),
                    ]),
                    el('td', el('span.badge', { class: row.plan === 'free' ? '' : 'badge-brand' }, row.plan)),
                    el('td.right.small', String(row.orders)),
                    el('td.right.small.strong', money(row.revenue, 'USD')),
                  ])
                )),
              ]))
            : el('div.empty', 'No restaurants yet.'),
        ]),

        el('div.col.gap-16', [
          el('div.card', [
            el('div.card-head', [el('h2', 'Plans')]),
            el('div.card-body', window.Charts.rankedBars({
              data: ['free', 'pro', 'enterprise'].map((plan) => {
                const count = stats.restaurants_by_plan[plan] || 0;
                return {
                  label: plan.charAt(0).toUpperCase() + plan.slice(1),
                  value: count,
                  detail: `${count} restaurant${count === 1 ? '' : 's'}`,
                };
              }),
            })),
          ]),

          el('div.card', [
            el('div.card-head', [el('h2', 'Accounts by role')]),
            el('div.card-body.col.gap-8', Object.entries(stats.users_by_role).map(([role, count]) =>
              el('div.row.between', [
                el('span.small', role.replace('_', ' ')),
                el('span.badge', String(count)),
              ])
            )),
          ]),
        ]),
      ]),

      el('p.tiny.faint.mt-16',
        'Gross volume aggregates every tenant regardless of their own currency setting, so treat it as a relative indicator.'),
    ]);
  }

  function stat(label, value, sub) {
    return el('div.card.stat', [
      el('div.stat-label', label),
      el('div.stat-value', value),
      el('div.stat-sub', sub),
    ]);
  }

  load();
})();
