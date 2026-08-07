/* Platform overview: tenants, users, order volume and the revenue leaderboard. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, money, toast } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'admin', title: t('adm.overview'), roles: ['super_admin'] });
  if (!shell) return;

  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('a.btn.btn-sm', { href: '/admin/restaurants.html' }, t('nav.restaurants')),
    el('button.btn.btn-sm', { onclick: () => window.Shell.passwordDialog() }, t('nav.changePassword')),
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
        stat(t('adm.restaurants'), String(totalTenants),
          t('adm.statusBreakdown', { active: byStatus.active || 0, pending: byStatus.pending || 0, suspended: byStatus.suspended || 0 })),
        stat(t('adm.totalOrders'), stats.totals.orders.toLocaleString(window.I18n.locale), t('adm.todayCount', { n: stats.today.orders })),
        stat(t('adm.grossVolume'), money(stats.totals.gmv, 'USD'), t('adm.todayAmount', { amount: money(stats.today.gmv, 'USD') })),
        stat(t('adm.userAccounts'), String(totalUsers), t('adm.leads', { n: stats.leads })),
      ]),

      el('div.card.mb-16', [
        el('div.card-head', [el('h2', t('adm.ordersPerDay'))]),
        el('div.card-body', window.Charts.areaLine({
          ariaLabel: 'Platform orders per day',
          height: 210,
          format: (n) => String(Math.round(n)),
          data: stats.last_14_days.map((day) => ({
            label: new Date(`${day.day}T12:00:00Z`).toLocaleDateString(window.I18n.locale, { month: 'short', day: 'numeric' }),
            title: day.day,
            value: day.orders,
            detail: [t('board.orderCount', { n: day.orders }), money(day.gmv, 'USD')],
          })),
        })),
      ]),

      el('div.grid.grid-2', [
        el('div.card', [
          el('div.card-head', [el('h2', t('adm.leaderboard'))]),
          stats.leaderboard.length
            ? el('div.table-wrap', el('table.data', [
                el('thead', el('tr', [
                  el('th', '#'), el('th', t('landing.restaurant')), el('th', t('set.plan')),
                  el('th.right', t('common.orders')), el('th.right', t('common.revenue')),
                ])),
                el('tbody', stats.leaderboard.map((row, index) =>
                  el('tr', [
                    el('td.faint.small', String(index + 1)),
                    el('td', [
                      el('div.strong', row.name),
                      el('div.tiny.faint.mono.ltr-inline', `/r/${row.slug}`),
                    ]),
                    el('td', el('span.badge', { class: row.plan === 'free' ? '' : 'badge-brand' }, row.plan)),
                    el('td.right.small', String(row.orders)),
                    el('td.right.small.strong', money(row.revenue, 'USD')),
                  ])
                )),
              ]))
            : el('div.empty', t('adm.noRestaurants')),
        ]),

        el('div.col.gap-16', [
          el('div.card', [
            el('div.card-head', [el('h2', t('adm.plans'))]),
            el('div.card-body', window.Charts.rankedBars({
              data: ['free', 'pro', 'enterprise'].map((plan) => {
                const count = stats.restaurants_by_plan[plan] || 0;
                return {
                  label: plan.charAt(0).toUpperCase() + plan.slice(1),
                  value: count,
                  detail: t('adm.restaurantCount', { n: count }),
                };
              }),
            })),
          ]),

          el('div.card', [
            el('div.card-head', [el('h2', t('adm.accountsByRole'))]),
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
        t('adm.gmvNote')),
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
