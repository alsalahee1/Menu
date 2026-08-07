/* Guest requests: waiter calls, bill requests and table service asks. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, timeAgo, formatDateTime, toast, guard, stream } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'restaurant', title: t('nav.requests') });
  if (!shell) return;

  const TYPES = {
    waiter: { icon: '🙋', label: 'req.type.waiter', tone: 'badge-warn' },
    bill: { icon: '🧾', label: 'req.type.bill', tone: 'badge-info' },
    water: { icon: '💧', label: 'req.type.water', tone: '' },
    cleanup: { icon: '🧽', label: 'req.type.cleanup', tone: '' },
  };

  let showAll = false;
  const root = el('div');
  shell.page.appendChild(root);

  const toggle = el('button.btn.btn-sm', {
    onclick: () => { showAll = !showAll; toggle.textContent = showAll ? t('req.showOpen') : t('req.showAll'); load(); },
  }, t('req.showAll'));
  shell.setActions([toggle, el('button.btn.btn-sm', { onclick: () => load() }, `↻ ${t('common.refresh')}`)]);

  async function load() {
    try {
      const { requests } = await api.get(`/rest/service-requests${showAll ? '?status=all' : ''}`);
      render(requests);
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render(requests) {
    if (!requests.length) {
      mount(root, el('div.card.empty', [
        el('div.empty-icon', '🔔'),
        el('h2', showAll ? t('req.noneRecorded') : t('req.noneOpen')),
        el('p', t('req.body')),
      ]));
      return;
    }

    const open = requests.filter((r) => r.status === 'open');

    mount(root, [
      open.length
        ? el('div.card.card-pad.mb-16', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } },
            el('div.strong', { style: { color: 'var(--warn)' } },
              t('req.waiting', { n: open.length })))
        : null,

      el('div.grid.grid-3', requests.map(requestCard)),
    ]);
  }

  function requestCard(request) {
    const type = TYPES[request.type] || { icon: '🔔', label: request.type, tone: '' };
    const isOpen = request.status === 'open';

    return el('div.card.card-pad', { style: isOpen ? null : { opacity: '.6' } }, [
      el('div.row.between.mb-8', [
        el('div.row.gap-8', [
          el('span', { style: { fontSize: '1.5rem' } }, type.icon),
          el('div', [
            el('div.strong', t(type.label)),
            el('div.tiny.muted', request.table_label || t('req.unknownTable')),
          ]),
        ]),
        el('span.badge', { class: isOpen ? type.tone || 'badge-warn' : 'badge-ok' }, isOpen ? t('req.open') : t('req.doneLabel')),
      ]),

      request.note ? el('div.small.muted.mb-8', request.note) : null,
      request.order_code ? el('div.tiny.faint.mb-8', `Order ${request.order_code}`) : null,

      el('div.row.between.gap-8', [
        el('span.tiny.faint', isOpen ? timeAgo(request.created_at) : t('req.resolvedAt', { time: formatDateTime(request.resolved_at) })),
        isOpen
          ? el('button.btn.btn-primary.btn-sm', {
              onclick: guard(async (event) => {
                await window.App.withBusy(event.currentTarget, () =>
                  api.patch(`/rest/service-requests/${request.id}/resolve`));
                toast(t('req.handled'), 'success');
                load();
              }),
            }, t('req.markHandled'))
          : null,
      ]),
    ]);
  }

  load();

  stream('/rest/stream', {
    'service_request.created': (request) => {
      toast(`${TYPES[request.type] ? t(TYPES[request.type].label) : request.type} · ${request.table_label}`, 'error');
      load();
    },
    'service_request.resolved': load,
  });

  setInterval(load, 60000);
})();
