/* Guest order tracking: live status, receipt, waiter calls and review. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, formatTime, statusLabel, toast, modal, confirmDialog, guard, stream,
  } = window.App;

  const t = (key, params) => window.I18n.t(key, params);
  const loc = (row, field) => window.I18n.localised(row, field);

  const code = (location.pathname.split('/').filter(Boolean)[1] || '').toUpperCase();

  // The order of a normal service, used to draw the progress timeline.
  const FLOW = ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed'].map((status) => ({
    status,
    get label() { return t(`order.step.${status}`); },
    get hint() { return t(`order.step.${status}Hint`); },
  }));

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
        el('h2', t('order.notFound')),
        el('p', error.message),
        el('a.btn.btn-primary', { href: '/' }, t('menu.backHome')),
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
        if (changed) toast(t('order.update', { status: statusLabel(updated.status) }), 'success');
      },
    });
    $('#live-dot').hidden = false;
  }

  function render() {
    document.title = `${t('order.title', { code: order.code })} — ${statusLabel(order.status)}`;
    $('#head-title').textContent = t('order.title', { code: order.code });
    $('#head-sub').textContent = `${order.restaurant_name}${order.table_label ? ` · ${order.table_label}` : ` · ${t('common.takeaway')}`}`;

    mount($('#content'), [
      statusCard(),
      timelineCard(),
      receiptCard(),
      paymentCard(),
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
          ? (order.cancel_reason || t('order.cancelledBody'))
          : (currentStep ? currentStep.hint : '')),
      !cancelled && eta !== null && ['pending', 'accepted', 'preparing'].includes(order.status)
        ? el('div.badge.badge-brand', t('order.estimated', { n: eta }))
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
        el('h3', t('order.history')),
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
      el('h3', t('order.progress')),
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
        el('h3', t('order.receipt')),
        el('span.badge', { class: order.payment_status === 'paid' ? 'badge-ok' : 'badge-warn' },
          order.payment_status === 'paid' ? t('common.paid') : t('common.unpaid')),
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

        order.note ? el('p.small.muted.mt-8', t('order.orderNote', { note: order.note })) : null,

        el('div.col.gap-4.small.mt-16', [
          row(t('common.subtotal'), order.subtotal),
          order.service_charge ? row(t('common.serviceCharge'), order.service_charge) : null,
          order.tax ? row(t('common.tax'), order.tax) : null,
          order.discount ? row(t('common.discount'), -order.discount) : null,
          el('hr', { style: { margin: '8px 0' } }),
          el('div.row.between', [
            el('strong', t('common.total')),
            el('strong', { style: { fontSize: '1.1rem' } }, money(order.total, order.currency)),
          ]),
        ]),

        el('div.row.between.small.faint.mt-16', [
          el('span', t('order.placedAt', { time: formatTime(order.placed_at) })),
          el('span.mono.ltr-inline', order.code),
        ]),
      ]),
    ]);

    function row(label, value) {
      return el('div.row.between', [el('span.muted', label), el('span', money(value, order.currency))]);
    }
  }

  // ------------------------------------------------------------- payment ---
  /**
   * Shown only when the restaurant has enabled paying from the table.
   * `restaurant_online_payments` rides along on the public order payload.
   */
  function paymentCard() {
    if (order.status === 'cancelled') return null;

    if (order.payment_status === 'paid') {
      return el('div.card.card-pad.mb-16', { style: { background: 'var(--ok-soft)', borderColor: 'transparent' } }, [
        el('div.row.gap-8', [
          el('span', { style: { fontSize: '1.4rem' } }, '✅'),
          el('div', [
            el('div.strong', { style: { color: 'var(--ok)' } }, t('pay.alreadyPaid')),
            el('div.small', { style: { color: 'var(--ok)' } }, t('pay.thanks')),
          ]),
        ]),
      ]);
    }

    if (!order.online_payments_enabled) return null;

    return el('div.card.card-pad.mb-16', [
      el('div.row.between.wrap.gap-8', [
        el('div', [
          el('div.strong', t('pay.amountDue')),
          el('div', { style: { fontSize: '1.35rem', fontWeight: '680' } }, money(order.total, order.currency)),
        ]),
        el('button.btn.btn-primary.btn-lg', { onclick: openPayment }, `💳 ${t('pay.payNow')}`),
      ]),
      el('p.tiny.faint', { style: { margin: '10px 0 0' } }, t('pay.orPayAtTable')),
    ]);
  }

  const openPayment = guard(async () => {
    const { intent } = await api.post(`/public/orders/${order.code}/pay`, {}, { anonymous: true });

    if (intent.provider !== 'mock') {
      // A live provider owns the card fields; this build ships the simulator,
      // so say so plainly rather than pretending to collect a real card.
      toast(t('pay.notAvailable'), 'error');
      return;
    }

    const handle = modal({
      title: t('pay.title', { code: order.code }),
      body: [
        el('div.card.card-pad.mb-16', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } },
          el('div.small', { style: { color: 'var(--warn)' } }, t('pay.simulatorNotice'))),

        el('div.row.between.mb-16', [
          el('span.muted', t('pay.amountDue')),
          el('strong', { style: { fontSize: '1.2rem' } }, money(order.total, order.currency)),
        ]),

        el('form#pay-form', [
          el('div.field', [
            el('label', { for: 'pay-card' }, t('pay.cardNumber')),
            el('input', {
              id: 'pay-card', type: 'text', inputmode: 'numeric', autocomplete: 'off',
              maxlength: 23, placeholder: '4242 4242 4242 4242', class: 'ltr',
              oninput: (event) => {
                // Group into fours as the guest types.
                const digits = event.target.value.replace(/\D/g, '').slice(0, 19);
                event.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
              },
            }),
          ]),
          el('div.form-grid', [
            el('div.field', [
              el('label', { for: 'pay-exp' }, t('pay.expiry')),
              el('input', { id: 'pay-exp', type: 'text', placeholder: '12 / 30', maxlength: 9, class: 'ltr' }),
            ]),
            el('div.field', [
              el('label', { for: 'pay-cvc' }, t('pay.cvc')),
              el('input', { id: 'pay-cvc', type: 'text', inputmode: 'numeric', maxlength: 4, placeholder: '123', class: 'ltr' }),
            ]),
          ]),
          el('div.field', [
            el('label', { for: 'pay-name' }, t('pay.nameOnCard')),
            el('input', { id: 'pay-name', type: 'text', maxlength: 80, value: order.customer_name || '' }),
          ]),
        ]),

        intent.test_cards
          ? el('div', [
              el('div.tiny.strong.mb-8', t('pay.testCards')),
              el('div.col.gap-4', intent.test_cards.map((card) =>
                el('button.btn.btn-sm.btn-block', {
                  type: 'button',
                  style: { justifyContent: 'space-between' },
                  onclick: () => { $('#pay-card').value = card.number; },
                }, [el('span.mono.tiny.ltr-inline', card.number), el('span.tiny.faint', card.label)])
              )),
            ])
          : null,
      ],
      actions: (h) => [
        el('button.btn', { onclick: h.close }, t('common.cancel')),
        el('button.btn.btn-primary.grow', {
          id: 'pay-submit',
          onclick: guard(async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            button.textContent = t('pay.processing');
            try {
              const result = await api.post(
                `/public/payments/${intent.reference}/confirm`,
                { card_number: $('#pay-card').value },
                { anonymous: true }
              );
              order = result.order;
              h.close();
              render();
              toast(t('pay.success'), 'success');
            } catch (error) {
              button.disabled = false;
              button.textContent = t('pay.payAmount', { amount: money(order.total, order.currency) });
              throw error;
            }
          }),
        }, t('pay.payAmount', { amount: money(order.total, order.currency) })),
      ],
    });
    return handle;
  });

  function actionsCard() {
    const canCancel = order.status === 'pending';
    const active = !['completed', 'cancelled'].includes(order.status);

    return el('div.card.card-pad.mb-16', [
      el('h3', t('menu.needSomething')),
      el('div.row.wrap.gap-8', [
        serviceButton('waiter', `🙋 ${t('menu.callWaiter')}`),
        serviceButton('water', `💧 ${t('menu.water')}`),
        serviceButton('bill', `🧾 ${t('menu.requestBill')}`),
        el('a.btn.btn-sm', { href: `/t/${order.restaurant_slug}/${order.table_code || ''}` },
          `➕ ${t('menu.orderMore')}`),
      ]),
      canCancel
        ? el('div.mt-16', [
            el('button.btn.btn-danger.btn-sm', { onclick: cancelOrder }, t('order.cancelThis')),
            el('div.tiny.faint.mt-4', t('order.cancelHint')),
          ])
        : active
          ? el('p.tiny.faint.mt-16', { style: { marginBottom: 0 } },
              t('order.startedNotice'))
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
          toast(t('menu.staffNotified'), 'success');
        } finally {
          setTimeout(() => { button.disabled = false; }, 8000);
        }
      }),
    }, label);
  }

  const cancelOrder = guard(async () => {
    const confirmed = await confirmDialog({
      title: t('order.cancelTitle'),
      message: t('order.cancelBody'),
      confirmLabel: t('board.cancelOrder'),
      cancelLabel: t('order.keepIt'),
    });
    if (!confirmed) return;

    const data = await api.post(`/public/orders/${order.code}/cancel`, { reason: 'Cancelled by guest' }, { anonymous: true });
    order = data.order;
    render();
    toast(t('order.cancelled'), 'success');
  });

  function reviewCard() {
    if (!['served', 'completed'].includes(order.status)) return null;

    return el('div.card.card-pad', [
      el('h3', t('order.howWasIt')),
      el('p.small.muted', t('order.feedbackBody')),
      el('button.btn.btn-primary', { onclick: openReview }, t('order.leaveReview')),
    ]);
  }

  function openReview() {
    let rating = 5;
    const stars = el('div.row.gap-4', { style: { fontSize: '1.9rem', cursor: 'pointer' } });

    function paintStars() {
      mount(stars, [1, 2, 3, 4, 5].map((value) =>
        el('span', {
          role: 'button',
          'aria-label': t('order.stars', { n: value }),
          style: { opacity: value <= rating ? '1' : '.28' },
          onclick: () => { rating = value; paintStars(); },
        }, '★')
      ));
    }
    paintStars();

    modal({
      title: t('order.leaveReview'),
      body: [
        stars,
        el('div.field.mt-16', [
          el('label', { for: 'review-comment' }, t('order.comment')),
          el('textarea', { id: 'review-comment', rows: 3, maxlength: 500 }),
        ]),
      ],
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('order.notNow')),
        el('button.btn.btn-primary', {
          onclick: guard(async () => {
            await api.post(`/public/orders/${order.code}/review`, {
              rating,
              comment: $('#review-comment').value.trim(),
            }, { anonymous: true });
            handle.close();
            toast(t('order.reviewThanks'), 'success');
          }),
        }, t('order.sendReview')),
      ],
    });
  }

  load();
  // Keep relative times and the ETA honest without waiting for a server event.
  setInterval(() => { if (order && !['completed', 'cancelled'].includes(order.status)) render(); }, 30000);
})();
