/* Floor plan: tables, their status, and printable QR codes. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, toast, modal, confirmDialog, guard, copyText, stream } = window.App;

  const shell = window.Shell.boot({ kind: 'restaurant', title: 'Tables & QR codes' });
  if (!shell) return;

  const canManage = ['owner', 'manager', 'super_admin'].includes(shell.user.role);

  let tables = [];
  let view = 'list';

  const root = el('div');
  shell.page.appendChild(root);

  if (canManage) {
    shell.setActions([
      el('button.btn.btn-sm', { onclick: () => { view = view === 'list' ? 'qr' : 'list'; render(); } }, '🔳 QR sheet'),
      el('button.btn.btn-primary.btn-sm', { onclick: () => tableDialog() }, '+ Table'),
    ]);
  } else {
    shell.setActions([
      el('button.btn.btn-sm', { onclick: () => { view = view === 'list' ? 'qr' : 'list'; render(); } }, '🔳 QR sheet'),
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
        el('h2', 'No tables yet'),
        el('p', 'Add a table to generate its QR code — that code is what guests scan.'),
        canManage ? el('button.btn.btn-primary', { onclick: () => tableDialog() }, 'Add first table') : null,
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
          el('div.small.strong', `${tables.length} tables across ${zones.length} zone${zones.length === 1 ? '' : 's'}`),
          el('div.row.wrap.gap-8.mt-4', Object.entries(counts).map(([status, n]) =>
            el('span.badge', { class: STATUS_TONE[status] }, `${n} ${status}`))),
        ]),
        el('div.small.muted', 'Print the QR sheet and stick one code on each table.'),
      ])),

      ...zones.map((zone) =>
        el('div.card.mb-16', [
          el('div.card-head', [el('h2', zone), el('span.badge', String(tables.filter((t) => t.zone === zone).length))]),
          el('div.table-wrap', el('table.data', [
            el('thead', el('tr', [
              el('th', 'Table'), el('th', 'Code'), el('th', 'Seats'),
              el('th', 'Status'), el('th', 'Active orders'), el('th', ''),
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
      el('td', el('button.btn.btn-sm.btn-ghost.mono', {
        onclick: () => copyText(table.url), title: 'Copy the guest link',
      }, table.code)),
      el('td.small', String(table.seats)),
      el('td', el('select', {
        style: { maxWidth: '130px', fontSize: '.82rem', padding: '4px 8px' },
        onchange: guard(async (event) => {
          await api.patch(`/rest/tables/${table.id}`, { status: event.target.value });
          table.status = event.target.value;
          toast(`${table.label} is now ${event.target.value}`, 'success');
        }),
      }, ['free', 'occupied', 'reserved', 'inactive'].map((status) =>
        el('option', { value: status, selected: table.status === status },
          status.charAt(0).toUpperCase() + status.slice(1))))),
      el('td', table.active_orders
        ? el('span.badge.badge-warn', `${table.active_orders} open`)
        : el('span.tiny.faint', '—')),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => qrDialog(table) }, 'QR'),
        canManage ? el('button.btn.btn-sm', { onclick: () => tableDialog(table) }, 'Edit') : null,
        canManage ? el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteTable(table) }, '🗑') : null,
      ]),
    ]);
  }

  function qrSheet() {
    return [
      el('div.card.card-pad.mb-16.no-print', el('div.row.wrap.between.gap-8', [
        el('div', [
          el('h2', { style: { margin: 0 } }, 'Printable QR sheet'),
          el('div.small.muted', 'Print this page, cut along the cards and place one on each table.'),
        ]),
        el('div.row.gap-8', [
          el('button.btn.btn-sm', { onclick: () => { view = 'list'; render(); } }, '← Back to list'),
          el('button.btn.btn-primary.btn-sm', { onclick: () => window.print() }, '🖨 Print'),
        ]),
      ])),

      el('div.qr-grid', tables.filter((t) => t.status !== 'inactive').map((table) =>
        el('div.card.qr-card', [
          el('img', {
            src: `/api/rest/tables/${table.id}/qr?size=400&token=${encodeURIComponent(window.App.auth.token)}`,
            alt: `QR code for ${table.label}`, width: 168, height: 168, loading: 'lazy',
          }),
          el('div.strong', table.label),
          el('div.tiny.muted', 'Scan to see the menu and order'),
          el('div.tiny.faint.mono.mt-4', table.code),
        ])
      )),
    ];
  }

  function qrDialog(table) {
    modal({
      title: `${table.label} · QR code`,
      body: [
        el('div.center', [
          el('img', {
            src: `/api/rest/tables/${table.id}/qr?size=480&token=${encodeURIComponent(window.App.auth.token)}`,
            alt: `QR code for ${table.label}`,
            style: { width: '230px', margin: '0 auto 14px' },
          }),
        ]),
        el('div.field', [
          el('label', 'Guest link'),
          el('div.copy-field', [
            el('span.grow.truncate', table.url),
            el('button.btn.btn-sm', { onclick: () => copyText(table.url) }, 'Copy'),
          ]),
        ]),
        el('p.small.muted', 'Anyone who scans this code lands on your menu with this table already selected.'),
        canManage
          ? el('div.card.card-pad', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } }, [
              el('div.small.strong', { style: { color: 'var(--warn)' } }, 'Rotate the code'),
              el('div.tiny.mb-8', { style: { color: 'var(--warn)' } },
                'Generates a new code and invalidates the printed one. Use this if a sticker is copied or misused.'),
              el('button.btn.btn-sm', {
                onclick: guard(async () => {
                  const ok = await confirmDialog({
                    title: 'Rotate this table code?',
                    message: 'The current printed QR code will stop working immediately.',
                    confirmLabel: 'Rotate code',
                  });
                  if (!ok) return;
                  await api.post(`/rest/tables/${table.id}/rotate-code`);
                  toast('Code rotated — reprint the QR for this table', 'success');
                  load();
                }),
              }, 'Rotate code'),
            ])
          : null,
      ],
      actions: (handle) => [
        el('a.btn', {
          href: `/api/rest/tables/${table.id}/qr?format=png&size=1000&token=${encodeURIComponent(window.App.auth.token)}`,
          download: `qr-${table.code}.png`,
        }, 'Download PNG'),
        el('button.btn.btn-primary', { onclick: handle.close }, 'Close'),
      ],
    });
  }

  function tableDialog(table) {
    const editing = Boolean(table);

    modal({
      title: editing ? `Edit ${table.label}` : 'New table',
      body: el('form', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'tbl-label' }, 'Label'),
          el('input', { id: 'tbl-label', type: 'text', required: true, maxlength: 40, value: editing ? table.label : `Table ${tables.length + 1}` }),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-zone' }, 'Zone'),
          el('input', { id: 'tbl-zone', type: 'text', maxlength: 40, value: editing ? table.zone : 'Main', list: 'zones' }),
          el('datalist', { id: 'zones' }, [...new Set(tables.map((t) => t.zone))].map((zone) => el('option', { value: zone }))),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-seats' }, 'Seats'),
          el('input', { id: 'tbl-seats', type: 'number', min: 1, max: 40, value: editing ? table.seats : 4 }),
        ]),
        el('div.field', [
          el('label', { for: 'tbl-status' }, 'Status'),
          el('select', { id: 'tbl-status' }, ['free', 'occupied', 'reserved', 'inactive'].map((status) =>
            el('option', { value: status, selected: editing && table.status === status },
              status.charAt(0).toUpperCase() + status.slice(1)))),
        ]),
        !editing
          ? el('div.field.full', [
              el('label', { for: 'tbl-code' }, 'Code (optional)'),
              el('input', { id: 'tbl-code', type: 'text', maxlength: 20, placeholder: 'Leave blank to generate one' }),
              el('div.hint', 'This short code is embedded in the QR link.'),
            ])
          : null,
      ])),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              label: $('#tbl-label').value.trim(),
              zone: $('#tbl-zone').value.trim() || 'Main',
              seats: Number($('#tbl-seats').value || 4),
              status: $('#tbl-status').value,
            };
            if (!editing) payload.code = $('#tbl-code').value.trim();
            if (!payload.label) return toast('Please give the table a label', 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/tables/${table.id}`, payload) : api.post('/rest/tables', payload));
            handle.close();
            toast(editing ? 'Table updated' : 'Table added', 'success');
            return load();
          }),
        }, editing ? 'Save changes' : 'Add table'),
      ],
    });
  }

  const deleteTable = guard(async (table) => {
    const ok = await confirmDialog({
      title: `Delete ${table.label}?`,
      message: 'Its QR code stops working immediately.',
      confirmLabel: 'Delete table',
    });
    if (!ok) return;
    await api.del(`/rest/tables/${table.id}`);
    toast('Table deleted', 'success');
    load();
  });

  load();
  stream('/rest/stream', { 'order.created': window.App.debounce(load, 1500), 'order.updated': window.App.debounce(load, 1500) });
})();
