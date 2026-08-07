/* Staff accounts: invite, change role, disable, reset password. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, formatDateTime, toast, modal, confirmDialog, guard } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({
    kind: 'restaurant', title: t('nav.staff'), roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  const ROLES = [
    { value: 'owner', label: 'staff.role.owner', description: 'staff.role.ownerDesc' },
    { value: 'manager', label: 'staff.role.manager', description: 'staff.role.managerDesc' },
    { value: 'waiter', label: 'staff.role.waiter', description: 'staff.role.waiterDesc' },
    { value: 'kitchen', label: 'staff.role.kitchen', description: 'staff.role.kitchenDesc' },
  ];

  const isOwner = ['owner', 'super_admin'].includes(shell.user.role);

  let staff = [];
  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([el('button.btn.btn-primary.btn-sm', { onclick: () => staffDialog() }, `+ ${t('staff.addMember')}`)]);

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
          el('h2', t('staff.team')),
          el('span.badge', t('staff.members', { n: staff.length })),
        ]),
        el('div.table-wrap', el('table.data', [
          el('thead', el('tr', [
            el('th', t('common.name')), el('th', t('common.email')), el('th', t('common.role')),
            el('th', t('common.status')), el('th', t('staff.lastSignIn')), el('th', ''),
          ])),
          el('tbody', staff.map(staffRow)),
        ])),
      ]),

      el('div.card.card-pad', [
        el('h2', t('staff.whatRolesDo')),
        el('div.grid.grid-2.mt-8', ROLES.map((role) =>
          el('div', [
            el('div.strong.small', t(role.label)),
            el('div.tiny.muted', t(role.description)),
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
        isSelf ? el('div.tiny.faint', t('staff.thisIsYou')) : null,
      ]),
      el('td.small.muted', member.email),
      el('td', el('span.badge', { class: member.role === 'owner' ? 'badge-brand' : '' }, member.role)),
      el('td', el('span.badge', { class: member.status === 'active' ? 'badge-ok' : 'badge-danger' }, member.status)),
      el('td.small.muted', member.last_login_at ? formatDateTime(member.last_login_at) : t('common.never')),
      el('td.actions', locked
        ? el('span.tiny.faint', t('staff.ownerOnly'))
        : [
            el('button.btn.btn-sm', { onclick: () => staffDialog(member) }, t('common.edit')),
            !isSelf ? el('button.btn.btn-sm.btn-ghost', { onclick: () => remove(member) }, '🗑') : null,
          ]),
    ]);
  }

  function staffDialog(member) {
    const editing = Boolean(member);
    const assignable = ROLES.filter((role) => role.value !== 'owner' || isOwner);

    modal({
      title: editing ? t('staff.editMember', { name: member.name }) : t('staff.addMember'),
      body: el('form', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'st-name' }, t('staff.fullName')),
            el('input', { id: 'st-name', type: 'text', required: true, maxlength: 120, value: editing ? member.name : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'st-phone' }, t('common.phone')),
            el('input', { id: 'st-phone', type: 'tel', maxlength: 40, value: editing ? member.phone : '' }),
          ]),
          !editing
            ? el('div.field.full', [
                el('label', { for: 'st-email' }, t('staff.emailSignIn')),
                el('input', { id: 'st-email', type: 'email', required: true, maxlength: 200 }),
              ])
            : el('div.field.full', [
                el('label', t('common.email')),
                el('input', { type: 'email', value: member.email, disabled: true }),
                el('div.hint', t('staff.emailFixed')),
              ]),
          el('div.field', [
            el('label', { for: 'st-role' }, t('common.role')),
            el('select', { id: 'st-role' }, assignable.map((role) =>
              el('option', { value: role.value, selected: editing && member.role === role.value }, t(role.label)))),
            el('div.hint', { id: 'role-hint' }, ''),
          ]),
          editing
            ? el('div.field', [
                el('label', { for: 'st-status' }, t('common.status')),
                el('select', { id: 'st-status' }, ['active', 'disabled'].map((status) =>
                  el('option', { value: status, selected: member.status === status },
                    status === 'active' ? t('staff.active') : t('staff.disabled')))),
              ])
            : null,
          el('div.field.full', [
            el('label', { for: 'st-password' }, editing ? t('staff.newPassword') : t('common.password')),
            el('input', {
              id: 'st-password', type: 'password', minlength: 8, maxlength: 200,
              required: !editing, autocomplete: 'new-password',
            }),
            el('div.hint', t('staff.passwordHint')),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#st-name').value.trim(),
              phone: $('#st-phone').value.trim(),
              role: $('#st-role').value,
            };
            if (!payload.name) return toast(t('staff.fullName'), 'error');

            const password = $('#st-password').value;
            if (editing) {
              payload.status = $('#st-status').value;
              if (password) payload.password = password;
            } else {
              payload.email = $('#st-email').value.trim();
              if (password.length < 8) return toast(t('staff.passwordHint'), 'error');
              payload.password = password;
            }

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/staff/${member.id}`, payload) : api.post('/rest/staff', payload));
            handle.close();
            toast(editing ? t('staff.updated') : t('staff.added'), 'success');
            return load();
          }),
        }, editing ? t('common.saveChanges') : t('staff.addMember')),
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
      title: t('staff.removeTitle', { name: member.name }),
      message: t('staff.removeBody'),
      confirmLabel: t('staff.remove'),
    });
    if (!ok) return;
    await api.del(`/rest/staff/${member.id}`);
    toast(t('staff.removed'), 'success');
    load();
  });

  load();
})();
