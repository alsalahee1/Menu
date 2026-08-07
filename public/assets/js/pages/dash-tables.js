/* Floor plan: tables, their status, and printable QR codes. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, toast, modal, confirmDialog, guard, copyText, stream } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({ kind: 'restaurant', title: t('nav.tables') });
  if (!shell) return;

  const canManage = ['owner', 'manager', 'super_admin'].includes(shell.user.role);

  let tables = [];
  let view = 'list';

  const root = el('div');
  shell.page.appendChild(root);

  if (canManage) {
    shell.setActions([
      el('button.btn.btn-sm', { onclick: () => { view = view === 'list' ? 'qr' : 'list'; render(); } }, `🔳 ${t('tables.qrSheet')}`),
      el('button.btn.btn-primary.btn-sm', { onclick: () => tableDialog() }, `+ ${t('tables.table')}`),
    ]);
  } else {
    shell.setActions([
      el('button.btn.btn-sm', { onclick: () => { view = view === 'list' ? 'qr' : 'list'; render(); } }, `🔳 ${t('tables.qrSheet')}`),
    ]);
  }

  async function load() {
    try {
      const data = await api.get('/rest/tables');
      tables = data.tables;
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  const STATUS_TONE = { free: 'badge-ok', occupied: 'badge-warn', reserved: 'badge-info', inactive: '' };

  function render() {
    if (!tables.length) {
      mount(root, el('div.card.empty', [
        el('div.empty-icon', '🪑'),
        el('h2', t('tables.noTables')),
        el('p', t('tables.noTablesBody')),
        canManage ? el('button.btn.btn-primary', { onclick: () => tableDialog() }, t('tables.addFirst')) : null,
      ]));
      return;
    }

    mount(root, view === 'qr' ? qrSheet() : tableList());
  }

  function tableList() {
    const zones = [...new Set(tables.map((t) => t.zone))];
    const counts = tables.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

    return [
      el('div.card.card-pad.mb-16', el('div.row.wrap.gap-16', [
        el('div.grow', [
          el('div.small.strong', t('tables.summary', { tables: tables.length, zones: zones.length })),
          el('div.row.wrap.gap-8.mt-4', Object.entries(counts).map(([status, n]) =>
            el('span.badge', { class: STATUS_TONE[status] }, `${n} ${t(`status.${status}`)}`))),
        ]),
        el('div.small.muted', t('tables.printHint')),
      ])),

      ...zones.map((zone) =>
        el('div.card.mb-16', [
          el('div.card-head', [el('h2', zone), el('span.badge', String(tables.filter((t) => t.zone === zone).length))]),
          el('div.table-wrap', el('table.data', [
            el('thead', el('tr', [
              el('th', t('tables.table')), el('th', t('dash.code')), el('th', t('tables.seats')),
              el('th', t('common.status')), el('th', t('tables.activeOrders')), el('th', ''),
            ])),
            el('tbody', tables.filter((t) => t.zone === zone).map(tableRow)),
          ])),
        ])
      ),
    ];
  }

  function tableRow(table) {
    return el('tr', [
      el('td.strong', table.label),
      el('td', el('button.btn.btn-sm.btn-ghost.mono.ltr-inline', {
        onclick: () => copyText(table.url), title: t('tables.guestLink'),
      }, table.code)),
      el('td.small', String(table.seats)),
      el('td', el('select', {
        style: { maxWidth: '130px', fontSize: '.82rem', padding: '4px 8px' },
        onchange: guard(async (event) => {
          await api.patch(`/rest/tables/${table.id}`, { status: event.target.value });
          table.status = event.target.value;
          toast(t('tables.statusChanged', { label: table.label, status: t(`status.${event.target.value}`) }), 'success');
        }),
      }, ['free', 'occupied', 'reserved', 'inactive'].map((status) =>
        el('option', { value: status, selected: table.status === status },
          t(`status.${status}`))))),
      el('td', table.active_orders
        ? el('span.badge.badge-warn', t('tables.openCount', { n: table.active_orders }))
        : el('span.tiny.faint', '—')),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => qrDialog(table) }, 'QR'),
        canManage ? el('button.btn.btn-sm', { onclick: () => tableDialog(table) }, t('common.edit')) : null,
        canManage ? el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteTable(table) }, '🗑') : null,
      ]),
    ]);
  }

  function qrSheet() {
    return [
      el('div.card.card-pad.mb-16.no-print', el('div.row.wrap.between.gap-8', [
        el('div', [
          el('h2', { style: { margin: 0 } }, t('tables.printableTitle')),
          el('div.small.muted', t('tables.printableBody')),
        ]),
        el('div.row.gap-8', [
          el('button.btn.btn-sm', { onclick: () => { view = 'list'; render(); } }, `← ${t('tables.backToList')}`),
          el('button.btn.btn-primary.btn-sm', { onclick: () => window.print() }, `🖨 ${t('common.print')}`),
        ]),
      ])),

      el('div.qr-grid', tables.filter((t) => t.status !== 'inactive').map((table) =>
        el('div.card.qr-card', [
          el('img', {
            src: `/api/rest/tables/${table.id}/qr?size=400&token=${encodeURIComponent(window.App.auth.token)}`,
            alt: `QR code for ${table.label}`, width: 168, height: 168, loading: 'lazy',
          }),
          el('div.strong', table.label),
          el('div.tiny.muted', t('tables.scanToOrder')),
          el('div.tiny.faint.mono.mt-4.ltr-inline', table.code),
        ])
      )),
    ];
  }

  function qrDialog(table) {
    modal({
      title: t('tables.qrTitle', { label: table.label }),
      body: [
        el('div.center', [
          el('img', {
            src: `/api/rest/tables/${table.id}/qr?size=480&token=${encodeURIComponent(window.App.auth.token)}`,
            alt: `QR code for ${table.label}`,
            style: { width: '230px', margin: '0 auto 14px' },
          }),
        ]),
        el('div.field', [
          el('label', t('tables.guestLink')),
          el('div.copy-field', [
            el('span.grow.truncate.ltr', table.url),
            el('button.btn.btn-sm', { onclick: () => copyText(table.url) }, t('common.copy')),
          ]),
        ]),
        el('p.small.muted', t('tables.qrExplain')),
        canManage
          ? el('div.card.card-pad', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } }, [
              el('div.small.strong', { style: { color: 'var(--warn)' } }, t('tables.rotate')),
              el('div.tiny.mb-8', { style: { color: 'var(--warn)' } },
                t('tables.rotateHint')),
              el('button.btn.btn-sm', {
                onclick: guard(async () => {
                  const ok = await confirmDialog({
                    title: t('tables.rotateTitle'),
                    message: t('tables.rotateBody'),
                    confirmLabel: t('tables.rotate'),
                  });
                  if (!ok) return;
                  await api.post(`/rest/tables/${table.id}/rotate-code`);
                  toast(t('tables.rotated'), 'success');
                  load();
                }),
              }, t('tables.rotate')),
            ])
          : null,
      ],
      actions: (handle) => [
        el('a.btn', {
          href: `/api/rest/tables/${table.id}/qr?format=png&size=1000&token=${encodeURIComponent(window.App.auth.token)}`,
          download: `qr-${table.code}.png`,
        }, t('tables.downloadPng')),
        el('button.btn.btn-primary', { onclick: handle.close }, t('common.close')),
      ],
    });
  }

  function tableDialog(table) {
    const editing = Boolean(table);

    modal({
      title: editing ? t('tables.editTable', { label: table.label }) : t('tables.newTable'),
      body: el('form', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'tbl-label' }, t('tables.label')),
          el('input', { id: 'tbl-label', type: 'text', required: true, maxlength: 40, value: editing ? table.label : `Table ${tables.length + 1}` }),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-zone' }, t('tables.zone')),
          el('input', { id: 'tbl-zone', type: 'text', maxlength: 40, value: editing ? table.zone : 'Main', list: 'zones' }),
          el('datalist', { id: 'zones' }, [...new Set(tables.map((t) => t.zone))].map((zone) => el('option', { value: zone }))),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-seats' }, t('tables.seats')),
          el('input', { id: 'tbl-seats', type: 'number', min: 1, max: 40, value: editing ? table.seats : 4 }),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-status' }, t('common.status')),
          el('select', { id: 'tbl-status' }, ['free', 'occupied', 'reserved', 'inactive'].map((status) =>
            el('option', { value: status, selected: editing && table.status === status },
              t(`status.${status}`)))),
        ]),
        !editing
          ? el('div.field.full', [
              el('label', { for: 'tbl-code' }, t('tables.codeOptional')),
              el('input', { id: 'tbl-code', type: 'text', maxlength: 20, placeholder: t('tables.codeGenerate') }),
              el('div.hint', t('tables.codeHint')),
            ])
          : null,
      ])),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              label: $('#tbl-label').value.trim(),
              zone: $('#tbl-zone').value.trim() || 'Main',
              seats: Number($('#tbl-seats').value || 4),
              status: $('#tbl-status').value,
            };
            if (!editing) payload.code = $('#tbl-code').value.trim();
            if (!payload.label) return toast(t('tables.label'), 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/tables/${table.id}`, payload) : api.post('/rest/tables', payload));
            handle.close();
            toast(editing ? t('tables.updated') : t('tables.added'), 'success');
            return load();
          }),
        }, editing ? t('common.saveChanges') : `${t('common.add')} ${t('tables.table')}`),
      ],
    });
  }

  const deleteTable = guard(async (table) => {
    const ok = await confirmDialog({
      title: t('tables.deleteTitle', { label: table.label }),
      message: t('tables.deleteBody'),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.del(`/rest/tables/${table.id}`);
    toast(t('tables.deleted'), 'success');
    load();
  });

  load();
  stream('/rest/stream', { 'order.created': window.App.debounce(load, 1500), 'order.updated': window.App.debounce(load, 1500) });
})();
