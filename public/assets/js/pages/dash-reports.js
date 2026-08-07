/* Sales reports: revenue trend, service pattern, menu mix and payment split. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, money, toast, viewRestaurant } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({
    kind: 'restaurant', title: t('nav.reports'), roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  const viewing = viewRestaurant.get();
  const currency = (viewing && viewing.currency) || (shell.user.restaurant && shell.user.restaurant.currency) || 'USD';

  const state = { from: '', to: '', preset: 30, data: null };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-sm', { onclick: exportCsv }, `⬇ ${t('rep.exportCsv')}`)]);

  function isoDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().slice(0, 10);
  }

  function renderControls() {
    const presets = [[7, t('rep.last7')], [30, t('rep.last30')], [90, t('rep.last90')]];

    mount(controls, el('div.row.wrap.gap-16', [
      el('div.pill-toggle', presets.map(([days, label]) =>
        el('button', {
          type: 'button',
          class: state.preset === days ? 'active' : '',
          onclick: () => {
            state.preset = days;
            state.from = isoDaysAgo(days - 1);
            state.to = new Date().toISOString().slice(0, 10);
            renderControls();
            load();
          },
        }, label)
      )),
      el('div.grow'),
      el('div.row.gap-8', [
        el('label.tiny.faint', { for: 'rep-from' }, t('common.from')),
        el('input', {
          id: 'rep-from', type: 'date', value: state.from, style: { maxWidth: '160px' },
          onchange: (event) => { state.from = event.target.value; state.preset = 0; renderControls(); load(); },
        }),
        el('label.tiny.faint', { for: 'rep-to' }, t('common.to')),
        el('input', {
          id: 'rep-to', type: 'date', value: state.to, style: { maxWidth: '160px' },
          onchange: (event) => { state.to = event.target.value; state.preset = 0; renderControls(); load(); },
        }),
      ]),
    ]));
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.from) query.set('from', state.from);
    if (state.to) query.set('to', state.to);

    mount(root, el('div.card', el('div.skeleton', { style: { height: '220px' } })));

    try {
      state.data = await api.get(`/rest/reports?${query.toString()}`);
      if (!state.from) state.from = state.data.range.from;
      if (!state.to) state.to = state.data.range.to;
      renderControls();
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
      toast(error.message, 'error');
    }
  }

  const fmtMoney = (value) => money(value, currency);
  const fmtCompact = (value) => {
    const n = Number(value);
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(Math.round(n));
  };

  function render() {
    const data = state.data;
    const summary = data.summary;
    const completed = summary.orders - summary.cancelled;

    mount(root, [
      el('div.grid.grid-4.mb-16', [
        stat(t('common.revenue'), fmtMoney(summary.revenue), t('rep.completedOrders', { n: completed })),
        stat(t('rep.avgTicket'), fmtMoney(summary.avg_ticket), t('rep.perOrder')),
        stat(t('rep.taxCollected'), fmtMoney(summary.tax), t('rep.serviceAmount', { amount: fmtMoney(summary.service_charge) })),
        stat(t('rep.cancelled'), String(summary.cancelled),
          summary.orders ? t('rep.percentOfOrders', { n: Math.round((summary.cancelled / summary.orders) * 100) }) : '—'),
      ]),

      // Revenue trend — one series, one axis, so the title names it.
      el('div.card.mb-16', [
        el('div.card-head', [
          el('h2', t('rep.revenuePerDay')),
          el('span.small.muted', `${data.range.from} → ${data.range.to}`),
        ]),
        el('div.card-body', window.Charts.areaLine({
          ariaLabel: 'Revenue per day',
          height: 220,
          format: fmtCompact,
          data: data.by_day.map((day) => ({
            label: new Date(`${day.day}T12:00:00Z`).toLocaleDateString(window.I18n.locale, { month: 'short', day: 'numeric' }),
            title: day.day,
            value: day.revenue,
            detail: [fmtMoney(day.revenue), t('board.orderCount', { n: day.orders })],
          })),
        })),
      ]),

      el('div.grid.grid-2.mb-16', [
        el('div.card', [
          el('div.card-head', [el('h2', t('rep.ordersByHour'))]),
          el('div.card-body', window.Charts.columns({
            ariaLabel: 'Orders by hour of day',
            height: 200,
            data: fillHours(data.by_hour).map((row) => ({
              label: `${String(row.hour).padStart(2, '0')}`,
              title: `${String(row.hour).padStart(2, '0')}:00`,
              value: row.orders,
              detail: [t('board.orderCount', { n: row.orders })],
            })),
          })),
          el('div.card-body', { style: { paddingTop: 0 } },
            el('p.tiny.faint', { style: { margin: 0 } }, t('rep.staffingHint'))),
        ]),

        el('div.card', [
          el('div.card-head', [el('h2', t('rep.revenueByCategory'))]),
          el('div.card-body', window.Charts.rankedBars({
            data: data.by_category.map((row) => ({
              label: row.category,
              value: row.revenue,
              detail: `${fmtMoney(row.revenue)} · ${row.qty} ${t('common.sold')}`,
            })),
          })),
        ]),
      ]),

      el('div.grid.grid-2.mb-16', [
        el('div.card', [
          el('div.card-head', [el('h2', t('rep.bestSellers'))]),
          data.top_items.length
            ? el('div.table-wrap', el('table.data', [
                el('thead', el('tr', [el('th', '#'), el('th', t('edit.dish')), el('th.right', t('common.sold')), el('th.right', t('common.revenue'))])),
                el('tbody', data.top_items.map((item, index) =>
                  el('tr', [
                    el('td.faint.small', String(index + 1)),
                    el('td', item.name),
                    el('td.right.small', String(item.qty)),
                    el('td.right.small.strong', fmtMoney(item.revenue)),
                  ])
                )),
              ]))
            : el('div.empty', t('rep.noSales')),
        ]),

        el('div.col.gap-16', [
          el('div.card', [
            el('div.card-head', [el('h2', t('rep.paymentMethods'))]),
            el('div.card-body', [
              window.Charts.segmentedBar({
                format: fmtMoney,
                data: aggregatePayments(data.by_payment),
              }),
              // Table view backs up the segmented bar for colour-independent reading.
              el('div.table-wrap.mt-16', el('table.data', [
                el('thead', el('tr', [el('th', t('rep.method')), el('th.right', t('common.orders')), el('th.right', t('common.revenue'))])),
                el('tbody', aggregatePayments(data.by_payment).map((row) =>
                  el('tr', [
                    el('td', row.label),
                    el('td.right.small', String(row.orders)),
                    el('td.right.small', fmtMoney(row.value)),
                  ])
                )),
              ])),
            ]),
          ]),

          el('div.card', [
            el('div.card-head', [el('h2', t('rep.busiestTables'))]),
            el('div.card-body', window.Charts.rankedBars({
              limit: 8,
              data: data.busiest_tables.map((row) => ({
                label: row.table_label,
                value: row.revenue,
                detail: `${fmtMoney(row.revenue)} · ${t('board.orderCount', { n: row.orders })}`,
              })),
            })),
          ]),
        ]),
      ]),
    ]);
  }

  /** Hours with no orders still need a slot, or the shape of the day lies. */
  function fillHours(rows) {
    const map = new Map(rows.map((row) => [row.hour, row.orders]));
    return Array.from({ length: 24 }, (_, hour) => ({ hour, orders: map.get(hour) || 0 }));
  }

  /** Collapse the (method, status) rows the API returns into one row per method. */
  function aggregatePayments(rows) {
    const totals = new Map();
    for (const row of rows) {
      const current = totals.get(row.method) || { orders: 0, value: 0 };
      current.orders += row.orders;
      current.value += row.revenue || 0;
      totals.set(row.method, current);
    }
    return [...totals.entries()]
      .map(([method, value]) => ({
        label: method.charAt(0).toUpperCase() + method.slice(1),
        orders: value.orders,
        value: value.value,
      }))
      .sort((a, b) => b.value - a.value);
  }

  function stat(label, value, sub) {
    return el('div.card.stat', [
      el('div.stat-label', label),
      el('div.stat-value', value),
      el('div.stat-sub', sub),
    ]);
  }

  function exportCsv() {
    if (!state.data) return;

    const rows = [
      ['Report range', state.data.range.from, state.data.range.to],
      [],
      [t('dash.placed'), t('common.orders'), t('common.revenue')],
      ...state.data.by_day.map((day) => [day.day, day.orders, day.revenue]),
      [],
      [t('edit.dish'), t('common.qty'), t('common.revenue')],
      ...state.data.top_items.map((item) => [item.name, item.qty, item.revenue]),
      [],
      [t('edit.category'), t('common.qty'), t('common.revenue')],
      ...state.data.by_category.map((row) => [row.category, row.qty, row.revenue]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', { href: url, download: `menu-report-${state.data.range.from}-to-${state.data.range.to}.csv` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast(t('rep.exported'), 'success');
  }

  state.from = isoDaysAgo(29);
  state.to = new Date().toISOString().slice(0, 10);
  renderControls();
  load();
})();
