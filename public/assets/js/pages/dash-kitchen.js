/* Kitchen display: only what needs cooking, oldest first, colour-coded by age. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, mount, api, formatTime, statusLabel, toast, guard, stream, store } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'restaurant', title: t('nav.kitchen') });
  if (!shell) return;

  // Which lanes the board shows. "served" is intentionally excluded — once
  // food leaves the pass the kitchen no longer needs it on screen.
  const LANES = [
    { status: 'pending', title: 'kds.new', next: { status: 'accepted', label: 'board.accept' } },
    { status: 'accepted', title: 'kds.confirmed', next: { status: 'preparing', label: 'kds.start' } },
    { status: 'preparing', title: 'kds.cooking', next: { status: 'ready', label: 'kds.ready' } },
    { status: 'ready', title: 'kds.readyToServe', next: { status: 'served', label: 'kds.served' } },
  ];

  let orders = [];
  let soundOn = store.get('menu.kdsSound', true);

  const board = el('div');
  shell.page.appendChild(board);

  const soundButton = el('button.btn.btn-sm', {
    onclick: () => {
      soundOn = !soundOn;
      store.set('menu.kdsSound', soundOn);
      soundButton.textContent = soundOn ? `🔔 ${t('kds.soundOn')}` : `🔕 ${t('kds.soundOff')}`;
      if (soundOn) chime();
    },
  }, soundOn ? `🔔 ${t('kds.soundOn')}` : `🔕 ${t('kds.soundOff')}`);

  shell.setActions([
    soundButton,
    el('button.btn.btn-sm', {
      onclick: () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => toast('Fullscreen was blocked', 'error'));
      },
    }, `⛶ ${t('kds.fullscreen')}`),
  ]);

  /** Short beep for a new ticket — built with WebAudio so there is no asset to ship. */
  function chime() {
    if (!soundOn) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      setTimeout(() => ctx.close(), 800);
    } catch {
      /* audio is a nicety, never a requirement */
    }
  }

  async function load() {
    try {
      const data = await api.get('/rest/orders?status=active&limit=200');
      // The board needs each ticket's lines, which the list endpoint omits.
      const detailed = await Promise.all(
        data.orders
          .filter((order) => LANES.some((lane) => lane.status === order.status))
          .map((order) => api.get(`/rest/orders/${order.id}`).then((r) => r.order).catch(() => null))
      );
      orders = detailed.filter(Boolean);
      render();
    } catch (error) {
      mount(board, el('div.card.empty', error.message));
    }
  }

  function render() {
    const lanes = LANES.map((lane) => ({
      ...lane,
      // Oldest ticket first: the kitchen works the queue from the top.
      orders: orders
        .filter((order) => order.status === lane.status)
        .sort((a, b) => String(a.placed_at).localeCompare(String(b.placed_at))),
    }));

    const total = lanes.reduce((sum, lane) => sum + lane.orders.length, 0);
    if (total === 0) {
      mount(board, el('div.card.empty', [
        el('div.empty-icon', '🍳'),
        el('h2', t('kds.allCaughtUp')),
        el('p', t('kds.allCaughtUpBody')),
      ]));
      return;
    }

    mount(board, el('div.grid', { style: { gridTemplateColumns: `repeat(${LANES.length}, minmax(240px, 1fr))`, alignItems: 'start' } },
      lanes.map((lane) =>
        el('div', [
          el('div.row.between.mb-8', { style: { position: 'sticky', top: 0 } }, [
            el('h2', { style: { margin: 0, fontSize: '.98rem' } }, t(lane.title)),
            el('span.badge', { class: lane.orders.length ? 'badge-brand' : '' }, String(lane.orders.length)),
          ]),
          el('div.col.gap-8', lane.orders.length
            ? lane.orders.map((order) => ticket(order, lane.next))
            : el('div.card.card-pad.center.tiny.faint', t('kds.empty'))),
        ])
      )
    ));
  }

  function ticket(order, next) {
    const minutes = window.App.minutesSince(order.placed_at);
    const ageClass = minutes > 25 ? 'age-late' : minutes > 12 ? 'age-warn' : '';

    return el('div.card.kds-card', { class: ageClass }, [
      el('div.card-head', { style: { padding: '10px 12px' } }, [
        el('div', [
          el('div.strong', order.table_label || t('common.takeaway')),
          el('div.tiny.faint.mono.ltr-inline', order.code),
        ]),
        el('div.right', [
          el('div.strong.small', { style: minutes > 25 ? { color: 'var(--danger)' } : minutes > 12 ? { color: 'var(--warn)' } : null },
            `${minutes}′`),
          el('div.tiny.faint', formatTime(order.placed_at)),
        ]),
      ]),
      el('div', { style: { padding: '8px 12px' } }, [
        ...order.items.map((line) =>
          el('div.kds-line', [
            el('span.kds-qty', String(line.qty)),
            el('div.grow', [
              el('div.small.strong', line.name_snapshot),
              line.options.length ? el('div.tiny.muted', line.options.map((o) => o.name).join(' · ')) : null,
              line.note ? el('div.tiny', { style: { color: 'var(--warn)' } }, `⚠ ${line.note}`) : null,
            ]),
          ])
        ),
        order.note
          ? el('div.small.mt-8', { style: { color: 'var(--warn)', fontWeight: '600' } }, `📝 ${order.note}`)
          : null,
      ]),
      el('div', { style: { padding: '10px 12px', borderTop: '1px solid var(--border)' } },
        el('button.btn.btn-primary.btn-block.btn-sm', {
          onclick: (event) => advance(event.currentTarget, order.id, next.status),
        }, t(next.label))),
    ]);
  }

  const advance = guard(async (button, orderId, status) => {
    await window.App.withBusy(button, () => api.patch(`/rest/orders/${orderId}/status`, { status }));
    toast(t('kds.markedAs', { status: statusLabel(status) }), 'success');
    load();
  });

  load();

  const refresh = window.App.debounce(load, 700);
  stream('/rest/stream', {
    'order.created': (order) => {
      chime();
      toast(t('kds.newTicket', { table: order.table_label || t('common.takeaway') }), 'success');
      refresh();
    },
    'order.updated': refresh,
  });

  // Re-render every 30s so ageing colours stay accurate on an idle screen.
  setInterval(render, 30000);
})();
