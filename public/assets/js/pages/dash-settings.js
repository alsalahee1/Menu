/* Restaurant settings: identity, charges, ordering switches and the menu link. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, $, mount, api, toast, guard, copyText } = window.App;

  const shell = window.Shell.boot({
    kind: 'restaurant', title: 'Settings', roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  let restaurant = null;
  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('button.btn.btn-sm', { onclick: () => window.Shell.passwordDialog() }, 'Change my password'),
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
      el('div.card-head', [el('h2', 'Restaurant profile')]),
      el('div.card-body', el('div.form-grid', [
        el('div.field', [
          el('label', { for: 'set-name' }, 'Name'),
          el('input', { id: 'set-name', type: 'text', required: true, maxlength: 120, value: restaurant.name }),
        ]),
        el('div.field', [
          el('label', { for: 'set-cuisine' }, 'Cuisine'),
          el('input', { id: 'set-cuisine', type: 'text', maxlength: 80, value: restaurant.cuisine }),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-desc' }, 'Description'),
          el('textarea', { id: 'set-desc', rows: 2, maxlength: 800 }, restaurant.description),
        ]),
        el('div.field', [
          el('label', { for: 'set-phone' }, 'Phone'),
          el('input', { id: 'set-phone', type: 'tel', maxlength: 40, value: restaurant.phone }),
        ]),
        el('div.field', [
          el('label', { for: 'set-email' }, 'Contact email'),
          el('input', { id: 'set-email', type: 'text', maxlength: 200, value: restaurant.email }),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-address' }, 'Address'),
          el('input', { id: 'set-address', type: 'text', maxlength: 300, value: restaurant.address }),
        ]),
        el('div.field.full', [
          el('label', { for: 'set-hours' }, 'Opening hours'),
          el('input', { id: 'set-hours', type: 'text', maxlength: 400, value: restaurant.opening_hours, placeholder: 'Mon–Sun · 11:00 – 23:00' }),
        ]),
        el('div.field', [
          el('label', { for: 'set-logo' }, 'Logo image URL'),
          el('input', { id: 'set-logo', type: 'url', maxlength: 500, value: restaurant.logo_url }),
        ]),
        el('div.field', [
          el('label', { for: 'set-color' }, 'Brand colour'),
          el('input', { id: 'set-color', type: 'color', value: restaurant.primary_color || '#e2603f' }),
          el('div.hint', 'Used across the guest menu.'),
        ]),
      ])),
      el('div.card-head', { style: { borderTop: '1px solid var(--border)', borderBottom: 0, justifyContent: 'flex-end' } },
        el('button.btn.btn-primary', { type: 'submit' }, 'Save settings')),
    ]);
  }

  function chargesCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', 'Currency & charges')]),
      el('div.card-body', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'set-currency' }, 'Currency code'),
            el('input', { id: 'set-currency', type: 'text', maxlength: 8, value: restaurant.currency, style: { textTransform: 'uppercase' } }),
            el('div.hint', 'ISO code, e.g. USD, EUR, SAR, AED.'),
          ]),
          el('div.field', [
            el('label', { for: 'set-tax' }, 'Tax rate (%)'),
            el('input', { id: 'set-tax', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.tax_rate * 100).toFixed(2) }),
          ]),
          el('div.field', [
            el('label', { for: 'set-service' }, 'Service charge (%)'),
            el('input', { id: 'set-service', type: 'number', min: 0, max: 100, step: '0.01', value: (restaurant.service_charge_rate * 100).toFixed(2) }),
          ]),
        ]),
        el('p.tiny.faint', { style: { marginBottom: 0 } },
          'Service charge is applied to the subtotal; tax is then applied to the subtotal plus service charge.'),
      ]),
    ]);
  }

  function orderingCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', 'Ordering')]),
      el('div.card-body.col.gap-16', [
        el('label.check', [
          el('input', { id: 'set-accepts', type: 'checkbox', checked: restaurant.accepts_orders }),
          el('span', [
            el('div.strong.small', 'Accept online orders'),
            el('div.tiny.muted', 'Turn this off at closing time. Guests can still browse the menu but cannot send an order.'),
          ]),
        ]),
        el('label.check', [
          el('input', { id: 'set-autoaccept', type: 'checkbox', checked: restaurant.auto_accept_orders }),
          el('span', [
            el('div.strong.small', 'Auto-confirm new orders'),
            el('div.tiny.muted', 'Orders skip the "pending" step and land in the kitchen straight away.'),
          ]),
        ]),
      ]),
    ]);
  }

  function linkCard() {
    const menuUrl = restaurant.menu_url;
    return el('div.card', [
      el('div.card-head', [el('h2', 'Your menu link')]),
      el('div.card-body', [
        el('div.copy-field.mb-8', [
          el('span.grow.truncate', menuUrl),
          el('button.btn.btn-sm', { onclick: () => copyText(menuUrl) }, 'Copy'),
        ]),
        el('p.tiny.muted', 'Share this to let anyone browse the menu. To place an order, guests must scan a table QR code.'),
        el('div.row.gap-8', [
          el('a.btn.btn-sm', { href: menuUrl, target: '_blank', rel: 'noopener' }, 'Preview ↗'),
          el('a.btn.btn-sm', { href: '/dashboard/tables.html' }, 'QR codes'),
        ]),
      ]),
    ]);
  }

  function planCard() {
    return el('div.card', [
      el('div.card-head', [el('h2', 'Account')]),
      el('div.card-body.col.gap-8', [
        row('Plan', el('span.badge.badge-brand', restaurant.plan)),
        row('Status', el('span.badge', { class: restaurant.status === 'active' ? 'badge-ok' : 'badge-warn' }, restaurant.status)),
        row('Address', el('span.mono.tiny', `/r/${restaurant.slug}`)),
        el('p.tiny.faint', { style: { margin: '8px 0 0' } },
          'Plan changes and the public address are managed by the platform administrator.'),
      ]),
    ]);

    function row(label, value) {
      return el('div.row.between', [el('span.small.muted', label), value]);
    }
  }

  const save = guard(async () => {
    const payload = {
      name: $('#set-name').value.trim(),
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
    };

    if (!payload.name) return toast('Please enter a restaurant name', 'error');
    if (!payload.currency) return toast('Please enter a currency code', 'error');
    if (payload.tax_rate < 0 || payload.tax_rate > 1) return toast('Tax rate must be between 0 and 100%', 'error');
    if (payload.service_charge_rate < 0 || payload.service_charge_rate > 1) {
      return toast('Service charge must be between 0 and 100%', 'error');
    }

    await api.patch('/rest/settings', payload);
    toast('Settings saved', 'success');
    return load();
  });

  load();
})();
