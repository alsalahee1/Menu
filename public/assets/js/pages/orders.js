/* Guest order history for this browser, plus tracking-code lookup. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, money, formatDateTime, statusBadge, sessionId, toast } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  $('#lookup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = $('#lookup-code').value.trim().toUpperCase();
    if (!code) return;
    location.href = `/order/${encodeURIComponent(code)}`;
  });

  async function load() {
    const host = $('#list');
    try {
      const { orders } = await api.get(`/public/sessions/${encodeURIComponent(sessionId())}/orders`, { anonymous: true });

      if (!orders.length) {
        mount(host, el('div.card.empty', [
          el('div.empty-icon', '🧾'),
          el('p', t('orders.emptyBody')),
          el('a.btn.btn-primary', { href: '/' }, t('orders.findRestaurant')),
        ]));
        return;
      }

      mount(host, el('div.card', orders.map((order, index) =>
        el('a.row.gap-8', {
          href: `/order/${order.code}`,
          style: {
            padding: '14px 16px', color: 'inherit', textDecoration: 'none',
            borderTop: index ? '1px solid var(--border)' : '0',
          },
        }, [
          el('div.grow', { style: { minWidth: 0 } }, [
            el('div.strong.truncate', order.restaurant_name),
            el('div.tiny.muted', [
              order.table_label || t('common.takeaway'),
              ' · ',
              formatDateTime(order.placed_at),
              ' · ',
              el('span.mono.ltr-inline', order.code),
            ]),
          ]),
          el('div.col.gap-4', { style: { alignItems: 'flex-end' } }, [
            el('span.strong.small', money(order.total, order.currency)),
            statusBadge(order.status),
          ]),
        ])
      )));
    } catch (error) {
      mount(host, el('div.card.empty', error.message));
      toast(error.message, 'error');
    }
  }

  load();
})();
