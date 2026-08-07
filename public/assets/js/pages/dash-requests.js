/* Guest requests: waiter calls, bill requests and table service asks. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, timeAgo, formatDateTime, toast, guard, stream } = window.App;

  const shell = window.Shell.boot({ kind: 'restaurant', title: 'Guest requests' });
  if (!shell) return;

  const TYPES = {
    waiter: { icon: '🙋', label: 'Call a waiter', tone: 'badge-warn' },
    bill: { icon: '🧾', label: 'Request the bill', tone: 'badge-info' },
    water: { icon: '💧', label: 'Water', tone: '' },
    cleanup: { icon: '🧽', label: 'Clear the table', tone: '' },
  };

  let showAll = false;
  const root = el('div');
  shell.page.appendChild(root);

  const toggle = el('button.btn.btn-sm', {
    onclick: () => { showAll = !showAll; toggle.textContent = showAll ? 'Show open only' : 'Show all'; load(); },
  }, 'Show all');
  shell.setActions([toggle, el('button.btn.btn-sm', { onclick: () => load() }, '↻ Refresh')]);

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
        el('h2', showAll ? 'No requests recorded' : 'No open requests'),
        el('p', 'When a guest taps "Call a waiter" or "Request the bill", it appears here instantly.'),
      ]));
      return;
    }

    const open = requests.filter((r) => r.status === 'open');

    mount(root, [
      open.length
        ? el('div.card.card-pad.mb-16', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } },
            el('div.strong', { style: { color: 'var(--warn)' } },
              `${open.length} guest${open.length === 1 ? '' : 's'} waiting for attention`))
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
            el('div.strong', type.label),
            el('div.tiny.muted', request.table_label || 'Unknown table'),
          ]),
        ]),
        el('span.badge', { class: isOpen ? type.tone || 'badge-warn' : 'badge-ok' }, isOpen ? 'Open' : 'Done'),
      ]),

      request.note ? el('div.small.muted.mb-8', request.note) : null,
      request.order_code ? el('div.tiny.faint.mb-8', `Order ${request.order_code}`) : null,

      el('div.row.between.gap-8', [
        el('span.tiny.faint', isOpen ? timeAgo(request.created_at) : `Resolved ${formatDateTime(request.resolved_at)}`),
        isOpen
          ? el('button.btn.btn-primary.btn-sm', {
              onclick: guard(async (event) => {
                await window.App.withBusy(event.currentTarget, () =>
                  api.patch(`/rest/service-requests/${request.id}/resolve`));
                toast('Marked as handled', 'success');
                load();
              }),
            }, 'Mark handled')
          : null,
      ]),
    ]);
  }

  load();

  stream('/rest/stream', {
    'service_request.created': (request) => {
      toast(`${(TYPES[request.type] || {}).label || 'Request'} · ${request.table_label}`, 'error');
      load();
    },
    'service_request.resolved': load,
  });

  setInterval(load, 60000);
})();
