/* Staff accounts: invite, change role, disable, reset password. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, formatDateTime, toast, modal, confirmDialog, guard } = window.App;

  const shell = window.Shell.boot({
    kind: 'restaurant', title: 'Staff', roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  const ROLES = [
    { value: 'owner', label: 'Owner', description: 'Full access, including staff and billing settings.' },
    { value: 'manager', label: 'Manager', description: 'Everything except creating or editing owners.' },
    { value: 'waiter', label: 'Waiter', description: 'Orders, tables and guest requests. Can mark dishes sold out.' },
    { value: 'kitchen', label: 'Kitchen', description: 'Kitchen display and order status only.' },
  ];

  const isOwner = ['owner', 'super_admin'].includes(shell.user.role);

  let staff = [];
  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([el('button.btn.btn-primary.btn-sm', { onclick: () => staffDialog() }, '+ Add staff member')]);

  async function load() {
    try {
      const data = await api.get('/rest/staff');
      staff = data.staff;
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render() {
    mount(root, [
      el('div.card.mb-16', [
        el('div.card-head', [
          el('h2', 'Team'),
          el('span.badge', `${staff.length} member${staff.length === 1 ? '' : 's'}`),
        ]),
        el('div.table-wrap', el('table.data', [
          el('thead', el('tr', [
            el('th', 'Name'), el('th', 'Email'), el('th', 'Role'),
            el('th', 'Status'), el('th', 'Last sign-in'), el('th', ''),
          ])),
          el('tbody', staff.map(staffRow)),
        ])),
      ]),

      el('div.card.card-pad', [
        el('h2', 'What each role can do'),
        el('div.grid.grid-2.mt-8', ROLES.map((role) =>
          el('div', [
            el('div.strong.small', role.label),
            el('div.tiny.muted', role.description),
          ])
        )),
      ]),
    ]);
  }

  function staffRow(member) {
    const isSelf = member.id === shell.user.id;
    const locked = member.role === 'owner' && !isOwner;

    return el('tr', [
      el('td', [
        el('div.strong', member.name),
        isSelf ? el('div.tiny.faint', 'This is you') : null,
      ]),
      el('td.small.muted', member.email),
      el('td', el('span.badge', { class: member.role === 'owner' ? 'badge-brand' : '' }, member.role)),
      el('td', el('span.badge', { class: member.status === 'active' ? 'badge-ok' : 'badge-danger' }, member.status)),
      el('td.small.muted', member.last_login_at ? formatDateTime(member.last_login_at) : 'Never'),
      el('td.actions', locked
        ? el('span.tiny.faint', 'Owner only')
        : [
            el('button.btn.btn-sm', { onclick: () => staffDialog(member) }, 'Edit'),
            !isSelf ? el('button.btn.btn-sm.btn-ghost', { onclick: () => remove(member) }, '🗑') : null,
          ]),
    ]);
  }

  function staffDialog(member) {
    const editing = Boolean(member);
    const assignable = ROLES.filter((role) => role.value !== 'owner' || isOwner);

    modal({
      title: editing ? `Edit ${member.name}` : 'Add a staff member',
      body: el('form', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'st-name' }, 'Full name'),
            el('input', { id: 'st-name', type: 'text', required: true, maxlength: 120, value: editing ? member.name : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'st-phone' }, 'Phone'),
            el('input', { id: 'st-phone', type: 'tel', maxlength: 40, value: editing ? member.phone : '' }),
          ]),
          !editing
            ? el('div.field.full', [
                el('label', { for: 'st-email' }, 'Email (used to sign in)'),
                el('input', { id: 'st-email', type: 'email', required: true, maxlength: 200 }),
              ])
            : el('div.field.full', [
                el('label', 'Email'),
                el('input', { type: 'email', value: member.email, disabled: true }),
                el('div.hint', 'Sign-in addresses cannot be changed. Create a new account instead.'),
              ]),
          el('div.field', [
            el('label', { for: 'st-role' }, 'Role'),
            el('select', { id: 'st-role' }, assignable.map((role) =>
              el('option', { value: role.value, selected: editing && member.role === role.value }, role.label))),
            el('div.hint', { id: 'role-hint' }, ''),
          ]),
          editing
            ? el('div.field', [
                el('label', { for: 'st-status' }, 'Status'),
                el('select', { id: 'st-status' }, ['active', 'disabled'].map((status) =>
                  el('option', { value: status, selected: member.status === status },
                    status === 'active' ? 'Active' : 'Disabled'))),
              ])
            : null,
          el('div.field.full', [
            el('label', { for: 'st-password' }, editing ? 'New password (leave blank to keep)' : 'Password'),
            el('input', {
              id: 'st-password', type: 'password', minlength: 8, maxlength: 200,
              required: !editing, autocomplete: 'new-password',
            }),
            el('div.hint', 'At least 8 characters.'),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#st-name').value.trim(),
              phone: $('#st-phone').value.trim(),
              role: $('#st-role').value,
            };
            if (!payload.name) return toast('Please enter a name', 'error');

            const password = $('#st-password').value;
            if (editing) {
              payload.status = $('#st-status').value;
              if (password) payload.password = password;
            } else {
              payload.email = $('#st-email').value.trim();
              if (password.length < 8) return toast('Password must be at least 8 characters', 'error');
              payload.password = password;
            }

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/staff/${member.id}`, payload) : api.post('/rest/staff', payload));
            handle.close();
            toast(editing ? 'Staff member updated' : 'Staff member added', 'success');
            return load();
          }),
        }, editing ? 'Save changes' : 'Add staff member'),
      ],
    });

    const select = $('#st-role');
    const hint = $('#role-hint');
    const paintHint = () => {
      const role = ROLES.find((r) => r.value === select.value);
      hint.textContent = role ? role.description : '';
    };
    select.addEventListener('change', paintHint);
    paintHint();
  }

  const remove = guard(async (member) => {
    const ok = await confirmDialog({
      title: `Remove ${member.name}?`,
      message: 'They lose access immediately. Past orders they handled are kept.',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    await api.del(`/rest/staff/${member.id}`);
    toast('Staff member removed', 'success');
    load();
  });

  load();
})();
