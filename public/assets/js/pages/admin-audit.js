/* Audit log: who did what, across every tenant. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, formatDateTime, timeAgo, modal, debounce } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'admin', title: t('nav.audit'), roles: ['super_admin'] });
  if (!shell) return;

  const state = { action: '', restaurantId: '', logs: [], restaurants: [] };

  const controls = el('div.card.card-pad.mb-16');
  const root = el('div');
  shell.page.append(controls, root);

  shell.setActions([el('button.btn.btn-sm', { onclick: () => load() }, `↻ ${t('common.refresh')}`)]);

  const COMMON_ACTIONS = [
    'auth.login', 'order.', 'item.', 'category.', 'table.', 'staff.', 'user.', 'restaurant.', 'settings.', 'lead.',
  ];

  function renderControls() {
    mount(controls, el('div.row.wrap.gap-8', [
      el('select', {
        style: { maxWidth: '200px' },
        onchange: (event) => { state.action = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.allActions')),
          ...COMMON_ACTIONS.map((action) =>
            el('option', { value: action, selected: state.action === action }, action))]),

      el('select', {
        style: { maxWidth: '230px' },
        onchange: (event) => { state.restaurantId = event.target.value; load(); },
      }, [el('option', { value: '' }, t('adm.allRestaurants')),
          ...state.restaurants.map((r) =>
            el('option', { value: r.id, selected: String(state.restaurantId) === String(r.id) }, r.name))]),

      el('div.grow'),
      el('span.tiny.faint', t('adm.auditHint')),
    ]));
  }

  async function load() {
    const query = new URLSearchParams();
    if (state.action) query.set('action', state.action);
    if (state.restaurantId) query.set('restaurant_id', state.restaurantId);

    try {
      const [logs, restaurants] = await Promise.all([
        api.get(`/admin/audit?${query.toString()}`),
        state.restaurants.length ? Promise.resolve({ restaurants: state.restaurants }) : api.get('/admin/restaurants'),
      ]);
      state.logs = logs.logs;
      state.restaurants = restaurants.restaurants;
      renderControls();
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  const TONE = (action) => {
    if (action.includes('deleted')) return 'badge-danger';
    if (action.includes('created')) return 'badge-ok';
    if (action.startsWith('auth')) return 'badge-info';
    return '';
  };

  function render() {
    if (!state.logs.length) {
      mount(root, el('div.card.empty', [el('div.empty-icon', '🛡️'), el('p', t('adm.noAudit'))]));
      return;
    }

    mount(root, el('div.card', [
      el('div.card-head', [el('h2', t('adm.activity')), el('span.badge', String(state.logs.length))]),
      el('div.table-wrap', el('table.data', [
        el('thead', el('tr', [
          el('th', t('adm.when')), el('th', t('adm.actor')), el('th', t('adm.action')),
          el('th', t('adm.entity')), el('th', t('landing.restaurant')), el('th', ''),
        ])),
        el('tbody', state.logs.map((log) =>
          el('tr', [
            el('td.small', { title: formatDateTime(log.created_at) }, timeAgo(log.created_at)),
            el('td.small.muted', log.actor_email || '—'),
            el('td', el('span.badge', { class: TONE(log.action) }, log.action)),
            el('td.small.muted', log.entity ? `${log.entity}${log.entity_id ? ` #${log.entity_id}` : ''}` : '—'),
            el('td.small', log.restaurant_name || el('span.faint', t('adm.platformLabel'))),
            el('td.actions', log.meta && log.meta !== '{}'
              ? el('button.btn.btn-sm.btn-ghost', { onclick: () => showMeta(log) }, t('common.details'))
              : null),
          ])
        )),
      ])),
    ]));
  }

  function showMeta(log) {
    let pretty = log.meta;
    try {
      pretty = JSON.stringify(JSON.parse(log.meta), null, 2);
    } catch {
      /* keep the raw string when it is not valid JSON */
    }

    modal({
      title: log.action,
      body: [
        el('div.small.muted.mb-8', `${log.actor_email || 'system'} · ${formatDateTime(log.created_at)}`),
        el('pre.mono.tiny', {
          style: {
            background: 'var(--surface-2)', padding: '12px', borderRadius: '8px',
            overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap',
          },
        }, pretty),
      ],
      actions: (handle) => [el('button.btn.btn-primary', { onclick: handle.close }, t('common.close'))],
    });
  }

  load();
})();
