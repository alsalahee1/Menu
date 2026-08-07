/* Live order board: filter, inspect, advance status, take payment. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, formatTime, formatDateTime, timeAgo, statusBadge, statusLabel,
    toast, modal, confirmDialog, guard, stream, params, debounce, viewRestaurant,
  } = window.App;

  const shell = window.Shell.boot({ kind: 'restaurant', title: 'Live orders' });
  if (!shell) return;

  const viewing = viewRestaurant.get();
  const currency = (viewing && viewing.currency) || (shell.user.restaurant && shell.user.restaurant.currency) || 'USD';
  const canTakePayment = ['owner', 'manager', 'super_admin'].includes(shell.user.role);

  // The button shown on a card is whatever comes next in the service flow.
  const NEXT_ACTION = {
    pending: { status: 'accepted', label: 'Accept' },
    accepted: { status: 'preparing', label: 'Start cooking' },
    preparing: { status: 'ready', label: 'Mark ready' },
    ready: { status: 'served', label: 'Mark served' },
    served: { status: 'completed', label: 'Close order' },
  };

  const state = { status: 'active', q: '', from: '', to: '', orders: [] };

  const filterBar = el('div.card.card-pad.mb-16');
  const listHost = el('div');
  shell.page.append(filterBar, listHost);

  shell.setActions([
    el('a.btn.btn-sm', { href: '/dashboard/kitchen.html' }, '👨‍🍳 Kitchen display'),
    el('button.btn.btn-sm', { onclick: () => load() }, '↻ Refresh'),
  ]);

  // ------------------------------------------------------------- filters ---
  function renderFilters() {
    const statuses = [
      ['active', 'In progress'], ['pending', 'Pending'], ['preparing', 'Preparing'],
      ['ready', 'Ready'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['', 'All'],
    ];

    mount(filterBar, [
      el('div.row.wrap.gap-8', [
        el('div.pill-toggle', statuses.map(([value, label]) =>
          el('button', {
            type: 'button',
            class: state.status === value ? 'active' : '',
            onclick: () => { state.status = value; renderFilters(); load(); },
          }, label)
        )),
        el('div.grow'),
        el('input', {
          type: 'search', placeholder: 'Search code, guest or table', value: state.q,
          style: { maxWidth: '240px' },
          oninput: debounce((event) => { state.q = event.target.value; load(); }, 300),
        }),
        el('input', { type: 'date', value: state.from, style: { maxWidth: '160px' }, title: 'From',
          onchange: (event) => { state.from = event.target.value; load(); } }),
        el('input', { type: 'date', value: state.to, style: { maxWidth: '160px' }, title: 'To',
          onchange: (event) => { state.to = event.target.value; load(); } }),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- load ---
  async function load() {
    const query = new URLSearchParams();
    if (state.status) query.set('status', state.status);
    if (state.q) query.set('q', state.q);
    if (state.from) query.set('from', state.from);
    if (state.to) query.set('to', state.to);

    try {
      const { orders } = await api.get(`/rest/orders?${query.toString()}`);
      state.orders = orders;
      render();
    } catch (error) {
      mount(listHost, el('div.card.empty', error.message));
    }
  }

  function render() {
    if (!state.orders.length) {
      mount(listHost, el('div.card.empty', [
        el('div.empty-icon', '🧾'),
        el('p', state.status === 'active' ? 'No orders in progress. Enjoy the quiet.' : 'No orders match these filters.'),
      ]));
      return;
    }

    mount(listHost, [
      el('div.small.muted.mb-8', `${state.orders.length} order${state.orders.length === 1 ? '' : 's'}`),
      el('div.grid.grid-3', state.orders.map(orderCard)),
    ]);
  }

  function orderCard(order) {
    const next = NEXT_ACTION[order.status];
    const minutes = window.App.minutesSince(order.placed_at);
    const isActive = !['completed', 'cancelled'].includes(order.status);
    const ageClass = !isActive ? '' : minutes > 25 ? 'age-late' : minutes > 12 ? 'age-warn' : '';

    return el('div.card.kds-card', { class: ageClass }, [
      el('div.card-head', [
        el('div', [
          el('div.row.gap-8', [
            el('strong.mono', order.code),
            order.type === 'takeaway' ? el('span.badge.badge-info', 'Takeaway') : null,
          ]),
          el('div.tiny.muted', order.table_label || 'Takeaway'),
        ]),
        statusBadge(order.status),
      ]),
      el('div.card-body', { style: { padding: '14px' } }, [
        el('div.row.between.small.mb-8', [
          el('span.muted', `${order.line_count} item${order.line_count === 1 ? '' : 's'}`),
          el('span.strong', money(order.total, currency)),
        ]),
        order.customer_name ? el('div.small.mb-8', `👤 ${order.customer_name}`) : null,
        order.note ? el('div.small.muted.mb-8', `📝 ${order.note}`) : null,
        el('div.row.between.tiny.faint.mb-16', [
          el('span', formatTime(order.placed_at)),
          el('span', isActive ? `${minutes} min ago` : timeAgo(order.updated_at)),
        ]),
        el('div.row.gap-8', [
          el('button.btn.btn-sm.grow', { onclick: () => openOrder(order.id) }, 'Details'),
          next
            ? el('button.btn.btn-primary.btn-sm.grow', {
                onclick: (event) => advance(event.currentTarget, order.id, next.status),
              }, next.label)
            : null,
        ]),
      ]),
    ]);
  }

  const advance = guard(async (button, orderId, status) => {
    await window.App.withBusy(button, () => api.patch(`/rest/orders/${orderId}/status`, { status }));
    toast(`Order marked ${statusLabel(status).toLowerCase()}`, 'success');
    load();
  });

  // ------------------------------------------------------------- details ---
  const openOrder = guard(async (orderId) => {
    const { order } = await api.get(`/rest/orders/${orderId}`);

    const handle = modal({
      wide: true,
      title: `Order ${order.code}`,
      body: [
        el('div.row.wrap.between.gap-8.mb-16', [
          el('div', [
            el('div.strong', order.table_label || 'Takeaway'),
            el('div.small.muted', formatDateTime(order.placed_at)),
          ]),
          el('div.row.gap-8', [
            statusBadge(order.status),
            el('span.badge', { class: order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn' },
              order.payment_status === 'paid' ? `Paid · ${order.payment_method}` : 'Unpaid'),
          ]),
        ]),

        order.customer_name || order.customer_phone
          ? el('div.card.card-pad.mb-16', [
              el('div.small.strong', 'Guest'),
              el('div.small.muted', [order.customer_name, order.customer_phone].filter(Boolean).join(' · ')),
            ])
          : null,

        order.note
          ? el('div.card.card-pad.mb-16', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } },
              el('div.small', { style: { color: 'var(--warn)' } }, `📝 ${order.note}`))
          : null,

        el('div.table-wrap.mb-16', el('table.data', [
          el('thead', el('tr', [el('th', 'Qty'), el('th', 'Item'), el('th.right', 'Unit'), el('th.right', 'Total')])),
          el('tbody', order.items.map((line) =>
            el('tr', [
              el('td.strong', `${line.qty}×`),
              el('td', [
                el('div', line.name_snapshot),
                line.options.length ? el('div.tiny.muted', line.options.map((o) => o.name).join(' · ')) : null,
                line.note ? el('div.tiny', { style: { color: 'var(--warn)' } }, `Note: ${line.note}`) : null,
              ]),
              el('td.right.small', money(line.unit_price, currency)),
              el('td.right.small', money(line.line_total, currency)),
            ])
          )),
        ])),

        el('div.col.gap-4.small.mb-16', [
          totalRow('Subtotal', order.subtotal),
          order.service_charge ? totalRow('Service charge', order.service_charge) : null,
          order.tax ? totalRow('Tax', order.tax) : null,
          el('hr', { style: { margin: '6px 0' } }),
          el('div.row.between', [el('strong', 'Total'), el('strong', money(order.total, currency))]),
        ]),

        el('h3', 'Timeline'),
        el('ul.timeline', order.timeline.map((event) =>
          el('li.done', [
            el('span.tl-dot', '•'),
            el('div.grow', [
              el('div.small.strong', statusLabel(event.status)),
              el('div.tiny.faint', [
                formatDateTime(event.created_at),
                event.actor_name ? ` · ${event.actor_name}` : '',
                event.note ? ` · ${event.note}` : '',
              ].join('')),
            ]),
          ])
        )),

        canTakePayment ? paymentControls(order, handle) : null,
      ],
      actions: (h) => {
        const next = NEXT_ACTION[order.status];
        const canCancel = !['completed', 'cancelled'].includes(order.status);
        return [
          canCancel
            ? el('button.btn.btn-danger', {
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: `Cancel order ${order.code}?`,
                    message: 'The guest will be notified immediately. This cannot be undone.',
                    confirmLabel: 'Cancel order',
                    cancelLabel: 'Keep it',
                  });
                  if (!ok) return;
                  await api.patch(`/rest/orders/${order.id}/status`, { status: 'cancelled', note: 'Cancelled by staff' });
                  h.close();
                  toast('Order cancelled', 'success');
                  load();
                },
              }, 'Cancel order')
            : null,
          el('button.btn', { onclick: h.close }, 'Close'),
          next
            ? el('button.btn.btn-primary', {
                onclick: guard(async (event) => {
                  await window.App.withBusy(event.currentTarget, () =>
                    api.patch(`/rest/orders/${order.id}/status`, { status: next.status }));
                  h.close();
                  toast(`Order marked ${statusLabel(next.status).toLowerCase()}`, 'success');
                  load();
                }),
              }, next.label)
            : null,
        ].filter(Boolean);
      },
    });

    function totalRow(label, value) {
      return el('div.row.between', [el('span.muted', label), el('span', money(value, currency))]);
    }
  });

  function paymentControls(order, handle) {
    return el('div.card.card-pad.mt-16', [
      el('h3', 'Payment'),
      el('div.row.wrap.gap-8', [
        el('select', { id: 'pay-method', style: { maxWidth: '160px' } },
          ['cash', 'card', 'online'].map((method) =>
            el('option', { value: method, selected: order.payment_method === method },
              method.charAt(0).toUpperCase() + method.slice(1)))),
        el('button.btn.btn-primary.btn-sm', {
          onclick: guard(async () => {
            await api.patch(`/rest/orders/${order.id}/payment`, {
              payment_status: 'paid',
              payment_method: $('#pay-method').value,
            });
            handle.close();
            toast('Marked as paid', 'success');
            load();
          }),
        }, 'Mark as paid'),
        order.payment_status === 'paid'
          ? el('button.btn.btn-sm', {
              onclick: guard(async () => {
                await api.patch(`/rest/orders/${order.id}/payment`, { payment_status: 'refunded' });
                handle.close();
                toast('Marked as refunded', 'success');
                load();
              }),
            }, 'Refund')
          : null,
      ]),
    ]);
  }

  // ---------------------------------------------------------------- boot ---
  renderFilters();
  load();

  const refresh = debounce(load, 800);
  stream('/rest/stream', {
    'order.created': (order) => {
      toast(`New order ${order.code} · ${order.table_label || 'Takeaway'}`, 'success');
      refresh();
    },
    'order.updated': refresh,
  });

  // Deep link from the overview page: /dashboard/orders.html?order=123
  const deepLink = params().get('order');
  if (deepLink) openOrder(Number(deepLink));

  // Keep the "x min ago" ageing colours moving.
  setInterval(() => { if (state.status === 'active') render(); }, 30000);
})();
