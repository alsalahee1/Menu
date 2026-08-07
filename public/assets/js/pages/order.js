/* Guest order tracking: live status, receipt, waiter calls and review. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, formatTime, statusLabel, toast, modal, confirmDialog, guard, stream,
  } = window.App;

  const code = (location.pathname.split('/').filter(Boolean)[1] || '').toUpperCase();

  // The order of a normal service, used to draw the progress timeline.
  const FLOW = [
    { status: 'pending', label: 'Order received', hint: 'Waiting for the restaurant to confirm' },
    { status: 'accepted', label: 'Confirmed', hint: 'The restaurant has your order' },
    { status: 'preparing', label: 'Being prepared', hint: 'The kitchen is cooking' },
    { status: 'ready', label: 'Ready', hint: 'Your food is plated and on its way' },
    { status: 'served', label: 'Served', hint: 'Enjoy your meal' },
    { status: 'completed', label: 'Completed', hint: 'Thanks for dining with us' },
  ];

  let order = null;

  async function load() {
    try {
      const data = await api.get(`/public/orders/${encodeURIComponent(code)}`, { anonymous: true });
      order = data.order;
      render();
      connect();
    } catch (error) {
      mount($('#content'), el('div.empty', [
        el('div.empty-icon', '🔍'),
        el('h2', 'Order not found'),
        el('p', error.message),
        el('a.btn.btn-primary', { href: '/' }, 'Back to home'),
      ]));
      $('#head-sub').textContent = '';
    }
  }

  function connect() {
    stream(`/public/orders/${encodeURIComponent(code)}/stream`, {
      'order.updated': (updated) => {
        const changed = updated.status !== order.status;
        order = updated;
        render();
        if (changed) toast(`Order update: ${statusLabel(updated.status)}`, 'success');
      },
    });
    $('#live-dot').hidden = false;
  }

  function render() {
    document.title = `Order ${order.code} — ${statusLabel(order.status)}`;
    $('#head-title').textContent = `Order ${order.code}`;
    $('#head-sub').textContent = `${order.restaurant_name}${order.table_label ? ` · ${order.table_label}` : ' · Takeaway'}`;

    mount($('#content'), [
      statusCard(),
      timelineCard(),
      receiptCard(),
      actionsCard(),
      reviewCard(),
    ].filter(Boolean));
  }

  function statusCard() {
    const cancelled = order.status === 'cancelled';
    const currentStep = FLOW.find((step) => step.status === order.status);
    const eta = estimateMinutes();

    return el('div.card.card-pad.mb-16', { style: { textAlign: 'center' } }, [
      el('div', { style: { fontSize: '2.6rem', marginBottom: '6px' } },
        cancelled ? '❌' : { pending: '⏳', accepted: '✅', preparing: '👨‍🍳', ready: '🔔', served: '🍽️', completed: '🎉' }[order.status] || '⏳'),
      el('h1', { style: { marginBottom: '4px' } }, statusLabel(order.status)),
      el('p.muted', { style: { marginBottom: '10px' } },
        cancelled
          ? (order.cancel_reason || 'This order was cancelled.')
          : (currentStep ? currentStep.hint : '')),
      !cancelled && eta !== null && ['pending', 'accepted', 'preparing'].includes(order.status)
        ? el('div.badge.badge-brand', `Estimated ${eta} min`)
        : null,
    ]);
  }

  /** Rough ETA from the slowest dish's prep time minus elapsed time. */
  function estimateMinutes() {
    if (!order.items.length) return null;
    const placed = window.App.parseDate(order.placed_at);
    if (!placed) return null;
    const elapsed = Math.floor((Date.now() - placed.getTime()) / 60000);
    const estimate = 15 - elapsed;
    return estimate > 0 ? estimate : 2;
  }

  function timelineCard() {
    if (order.status === 'cancelled') {
      return el('div.card.card-pad.mb-16', [
        el('h3', 'History'),
        el('ul.timeline', order.timeline.map((event) =>
          el('li.done', [
            el('span.tl-dot', '•'),
            el('div.grow', [
              el('div.strong.small', statusLabel(event.status)),
              el('div.tiny.faint', `${formatTime(event.created_at)}${event.note ? ` · ${event.note}` : ''}`),
            ]),
          ])
        )),
      ]);
    }

    const currentIndex = FLOW.findIndex((step) => step.status === order.status);
    const reached = new Map(order.timeline.map((event) => [event.status, event.created_at]));

    return el('div.card.card-pad.mb-16', [
      el('h3', 'Progress'),
      el('ul.timeline', FLOW.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : '';
        return el('li', { class: state }, [
          el('span.tl-dot', index < currentIndex ? '✓' : String(index + 1)),
          el('div.grow', [
            el('div.small', { class: state ? 'strong' : 'muted' }, step.label),
            reached.has(step.status)
              ? el('div.tiny.faint', formatTime(reached.get(step.status)))
              : el('div.tiny.faint', state === 'current' ? step.hint : ''),
          ]),
        ]);
      })),
    ]);
  }

  function receiptCard() {
    return el('div.card.mb-16', [
      el('div.card-head', [
        el('h3', 'Receipt'),
        el('span.badge', { class: order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn' },
          order.payment_status === 'paid' ? 'Paid' : 'Unpaid'),
      ]),
      el('div.card-body', [
        el('div', order.items.map((line) =>
          el('div.row.top.gap-8', { style: { padding: '8px 0', borderBottom: '1px solid var(--border)' } }, [
            el('span.qty-badge.strong', { style: { minWidth: '28px' } }, `${line.qty}×`),
            el('div.grow', [
              el('div', line.name_snapshot),
              line.options.length
                ? el('div.tiny.muted', line.options.map((o) => o.name).join(' · '))
                : null,
              line.note ? el('div.tiny.faint', `Note: ${line.note}`) : null,
            ]),
            el('span.small.nowrap', money(line.line_total, order.currency)),
          ])
        )),

        order.note ? el('p.small.muted.mt-8', `Order note: ${order.note}`) : null,

        el('div.col.gap-4.small.mt-16', [
          row('Subtotal', order.subtotal),
          order.service_charge ? row('Service charge', order.service_charge) : null,
          order.tax ? row('Tax', order.tax) : null,
          order.discount ? row('Discount', -order.discount) : null,
          el('hr', { style: { margin: '8px 0' } }),
          el('div.row.between', [
            el('strong', 'Total'),
            el('strong', { style: { fontSize: '1.1rem' } }, money(order.total, order.currency)),
          ]),
        ]),

        el('div.row.between.small.faint.mt-16', [
          el('span', `Placed ${formatTime(order.placed_at)}`),
          el('span.mono', order.code),
        ]),
      ]),
    ]);

    function row(label, value) {
      return el('div.row.between', [el('span.muted', label), el('span', money(value, order.currency))]);
    }
  }

  function actionsCard() {
    const canCancel = order.status === 'pending';
    const active = !['completed', 'cancelled'].includes(order.status);

    return el('div.card.card-pad.mb-16', [
      el('h3', 'Need something?'),
      el('div.row.wrap.gap-8', [
        serviceButton('waiter', '🙋 Call a waiter'),
        serviceButton('water', '💧 Water'),
        serviceButton('bill', '🧾 Request the bill'),
        el('a.btn.btn-sm', { href: `/t/${order.restaurant_slug}/${order.table_code || ''}` },
          '➕ Order more'),
      ]),
      canCancel
        ? el('div.mt-16', [
            el('button.btn.btn-danger.btn-sm', { onclick: cancelOrder }, 'Cancel this order'),
            el('div.tiny.faint.mt-4', 'You can cancel until the restaurant confirms your order.'),
          ])
        : active
          ? el('p.tiny.faint.mt-16', { style: { marginBottom: 0 } },
              'The kitchen has started your order — ask a member of staff if you need to change it.')
          : null,
    ]);
  }

  function serviceButton(type, label) {
    return el('button.btn.btn-sm', {
      disabled: !order.table_code,
      onclick: guard(async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await api.post('/public/service-requests', {
            slug: order.restaurant_slug,
            table_code: order.table_code,
            type,
            order_code: order.code,
          }, { anonymous: true });
          toast('A member of staff has been notified.', 'success');
        } finally {
          setTimeout(() => { button.disabled = false; }, 8000);
        }
      }),
    }, label);
  }

  const cancelOrder = guard(async () => {
    const confirmed = await confirmDialog({
      title: 'Cancel this order?',
      message: 'The kitchen will not prepare it. This cannot be undone.',
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;

    const data = await api.post(`/public/orders/${order.code}/cancel`, { reason: 'Cancelled by guest' }, { anonymous: true });
    order = data.order;
    render();
    toast('Your order has been cancelled', 'success');
  });

  function reviewCard() {
    if (!['served', 'completed'].includes(order.status)) return null;

    return el('div.card.card-pad', [
      el('h3', 'How was it?'),
      el('p.small.muted', 'Your feedback goes straight to the restaurant.'),
      el('button.btn.btn-primary', { onclick: openReview }, 'Leave a review'),
    ]);
  }

  function openReview() {
    let rating = 5;
    const stars = el('div.row.gap-4', { style: { fontSize: '1.9rem', cursor: 'pointer' } });

    function paintStars() {
      mount(stars, [1, 2, 3, 4, 5].map((value) =>
        el('span', {
          role: 'button',
          'aria-label': `${value} star${value === 1 ? '' : 's'}`,
          style: { opacity: value <= rating ? '1' : '.28' },
          onclick: () => { rating = value; paintStars(); },
        }, '★')
      ));
    }
    paintStars();

    modal({
      title: 'Leave a review',
      body: [
        stars,
        el('div.field.mt-16', [
          el('label', { for: 'review-comment' }, 'Comment (optional)'),
          el('textarea', { id: 'review-comment', rows: 3, maxlength: 500 }),
        ]),
      ],
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Not now'),
        el('button.btn.btn-primary', {
          onclick: guard(async () => {
            await api.post(`/public/orders/${order.code}/review`, {
              rating,
              comment: $('#review-comment').value.trim(),
            }, { anonymous: true });
            handle.close();
            toast('Thank you for your feedback!', 'success');
          }),
        }, 'Send review'),
      ],
    });
  }

  load();
  // Keep relative times and the ETA honest without waiting for a server event.
  setInterval(() => { if (order && !['completed', 'cancelled'].includes(order.status)) render(); }, 30000);
})();
