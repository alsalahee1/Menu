/* Restaurant settings: identity, charges, ordering switches and the menu link. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, toast, guard, copyText } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({
    kind: 'restaurant', title: t('nav.settings'), roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  let restaurant = null;
  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('button.btn.btn-sm', { onclick: () => window.Shell.passwordDialog() }, t('nav.changePassword')),
  ]);

  async function load() {
    try {
      const data = await api.get('/rest/settings');
      restaurant = data.restaurant;
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  function render() {
    mount(root, el('div.grid', { style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', alignItems: 'start' } }, [
      el('div.col.gap-16', [profileCard(), chargesCard(), orderingCard()]),
      el('div.col.gap-16', [linkCard(), planCard()]),
    ]));
  }

  function profileCard() {
    return el('form.card', { onsubmit: (event) => { event.preventDefault(); save(); } }, [
      el('div.card-head', [el('h2', t('set.profile'))]),
      el('div.card-body', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'set-name' }, t('common.name')),
          el('input', { id: 'set-name', type: 'text', required: true, maxlength: 120, value: restaurant.name }),
        ]),
        el('div.field', [
          el('label', { for: 'set-cuisine' }, t('set.cuisine')),
          el('input', { id: 'set-cuisine', type: 'text', maxlength: 80, value: restaurant.cuisine }),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-desc' }, t('edit.description')),
          el('textarea', { id: 'set-desc', rows: 2, maxlength: 800 }, restaurant.description),
        ]),
        el('div.field', [
          el('label', { for: 'set-phone' }, t('common.phone')),
          el('input', { id: 'set-phone', type: 'tel', maxlength: 40, value: restaurant.phone }),
        ]),
        el('div.field', [
          el('label', { for: 'set-email' }, t('set.contactEmail')),
          el('input', { id: 'set-email', type: 'text', maxlength: 200, value: restaurant.email }),
        ]),
        el('div.field', [
          el('label', { for: 'set-name-ar' }, t('edit.arabicName')),
          el('input', { id: 'set-name-ar', type: 'text', maxlength: 120, dir: 'rtl', lang: 'ar', value: restaurant.name_ar || '' }),
        ]),
        el('div.field', [
          el('label', { for: 'set-desc-ar' }, t('edit.arabicDescription')),
          el('input', { id: 'set-desc-ar', type: 'text', maxlength: 800, dir: 'rtl', lang: 'ar', value: restaurant.description_ar || '' }),
          el('div.hint', t('edit.arabicHint')),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-address' }, t('set.address')),
          el('input', { id: 'set-address', type: 'text', maxlength: 300, value: restaurant.address }),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-hours' }, t('set.openingHours')),
          el('input', { id: 'set-hours', type: 'text', maxlength: 400, value: restaurant.opening_hours, placeholder: 'Mon–Sun · 11:00 – 23:00' }),
        ]),
        el('div.field', [
          el('label', { for: 'set-logo' }, t('set.logoUrl')),
          el('input', { id: 'set-logo', type: 'url', maxlength: 500, value: restaurant.logo_url }),
        ]),
        el('div.field', [
          el('label', { for: 'set-color' }, t('set.brandColour')),
          el('input', { id: 'set-color', type: 'color', value: restaurant.primary_color || '#e2603f' }),
          el('div.hint', t('set.brandColourHint')),
        ]),
      ])),
      el('div.card-head', { style: { borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' } },
        el('button.btn.btn-primary', { type: 'submit' }, t('set.saveSettings'))),
    ]);
  }

  function chargesCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', t('set.currencyCharges'))]),
      el('div.card-body', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'set-currency' }, t('set.currencyCode')),
            el('input', { id: 'set-currency', type: 'text', maxlength: 8, value: restaurant.currency, style: { textTransform: 'uppercase' } }),
            el('div.hint', t('set.currencyHint')),
          ]),
          el('div.field', [
            el('label', { for: 'set-tax' }, t('set.taxRate')),
            el('input', { id: 'set-tax', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.tax_rate * 100).toFixed(2) }),
          ]),
          el('div.field', [
            el('label', { for: 'set-service' }, t('set.serviceRate')),
            el('input', { id: 'set-service', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.service_charge_rate * 100).toFixed(2) }),
          ]),
        ]),
        el('p.tiny.faint', { style: { marginBottom: 0 } },
          t('set.chargesHint')),
      ]),
    ]);
  }

  function orderingCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', t('set.ordering'))]),
      el('div.card-body.col.gap-16', [
        el('label.check', [
          el('input', { id: 'set-accepts', type: 'checkbox', checked: restaurant.accepts_orders }),
          el('span', [
            el('div.strong.small', t('set.acceptOrders')),
            el('div.tiny.muted', t('set.acceptOrdersHint')),
          ]),
        ]),
        el('label.check', [
          el('input', { id: 'set-autoaccept', type: 'checkbox', checked: restaurant.auto_accept_orders }),
          el('span', [
            el('div.strong.small', t('set.autoAccept')),
            el('div.tiny.muted', t('set.autoAcceptHint')),
          ]),
        ]),
        el('label.check', [
          el('input', { id: 'set-online-pay', type: 'checkbox', checked: restaurant.online_payments_enabled }),
          el('span', [
            el('div.strong.small', t('set.onlinePayments')),
            el('div.tiny.muted', t('set.onlinePaymentsHint')),
          ]),
        ]),
        el('div.card.card-pad', {
          style: {
            background: restaurant.payment_provider === 'mock' ? 'var(--warn-soft)' : 'var(--ok-soft)',
            borderColor: 'transparent',
          },
        }, el('div.tiny', {
          style: { color: restaurant.payment_provider === 'mock' ? 'var(--warn)' : 'var(--ok)' },
        }, restaurant.payment_provider === 'mock' ? t('set.paymentProviderMock') : t('set.paymentProviderLive'))),
      ]),
    ]);
  }

  function linkCard() {
    const menuUrl = restaurant.menu_url;
    return el('div.card', [
      el('div.card-head', [el('h2', t('set.yourMenuLink'))]),
      el('div.card-body', [
        el('div.copy-field.mb-8', [
          el('span.grow.truncate.ltr', menuUrl),
          el('button.btn.btn-sm', { onclick: () => copyText(menuUrl) }, t('common.copy')),
        ]),
        el('p.tiny.muted', t('set.menuLinkHint')),
        el('div.row.gap-8', [
          el('a.btn.btn-sm', { href: menuUrl, target: '_blank', rel: 'noopener' }, `${t('set.preview')} ↗`),
          el('a.btn.btn-sm', { href: '/dashboard/tables.html' }, t('set.qrCodes')),
        ]),
      ]),
    ]);
  }

  function planCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', t('set.account'))]),
      el('div.card-body.col.gap-8', [
        row(t('set.plan'), el('span.badge.badge-brand', restaurant.plan)),
        row(t('common.status'), el('span.badge', { class: restaurant.status === 'active' ? 'badge-ok' : 'badge-warn' }, restaurant.status)),
        row(t('adm.webAddress'), el('span.mono.tiny.ltr-inline', `/r/${restaurant.slug}`)),
        el('p.tiny.faint', { style: { margin: '8px 0 0' } },
          t('set.planHint')),
      ]),
    ]);

    function row(label, value) {
      return el('div.row.between', [el('span.small.muted', label), value]);
    }
  }

  const save = guard(async () => {
    const payload = {
      name: $('#set-name').value.trim(),
      name_ar: $('#set-name-ar').value.trim(),
      description_ar: $('#set-desc-ar').value.trim(),
      cuisine: $('#set-cuisine').value.trim(),
      description: $('#set-desc').value.trim(),
      phone: $('#set-phone').value.trim(),
      email: $('#set-email').value.trim(),
      address: $('#set-address').value.trim(),
      opening_hours: $('#set-hours').value.trim(),
      logo_url: $('#set-logo').value.trim(),
      primary_color: $('#set-color').value,
      currency: $('#set-currency').value.trim().toUpperCase(),
      tax_rate: Number($('#set-tax').value || 0) / 100,
      service_charge_rate: Number($('#set-service').value || 0) / 100,
      accepts_orders: $('#set-accepts').checked,
      auto_accept_orders: $('#set-autoaccept').checked,
      online_payments_enabled: $('#set-online-pay').checked,
    };

    if (!payload.name) return toast(t('common.name'), 'error');
    if (!payload.currency) return toast(t('set.currencyCode'), 'error');
    if (payload.tax_rate < 0 || payload.tax_rate > 1) return toast(t('set.taxRate'), 'error');
    if (payload.service_charge_rate < 0 || payload.service_charge_rate > 1) {
      return toast(t('set.serviceRate'), 'error');
    }

    await api.patch('/rest/settings', payload);
    toast(t('set.saved'), 'success');
    return load();
  });

  load();
})();
