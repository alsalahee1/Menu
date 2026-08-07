/* Guest menu: browse, customise, cart, checkout, call-a-waiter. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, toast, modal, confirmDialog, guard, store, sessionId,
  } = window.App;

  const t = (key, params) => window.I18n.t(key, params);
  const loc = (row, field) => window.I18n.localised(row, field);

  // Route shapes: /t/<slug>/<tableCode> (scanned) or /r/<slug> (browse only).
  const segments = location.pathname.split('/').filter(Boolean);
  const slug = segments[1] || '';
  const tableCode = segments[0] === 't' ? (segments[2] || '').toUpperCase() : null;

  const cartKey = `menu.cart.${slug}${tableCode ? `.${tableCode}` : ''}`;

  let restaurant = null;
  let categories = [];
  let cart = store.get(cartKey, []);
  let activeCategoryId = null;

  const itemsById = new Map();
  const cartTotal = () => cart.reduce((sum, line) => sum + line.unit_price * line.qty, 0);
  const cartCount = () => cart.reduce((sum, line) => sum + line.qty, 0);
  const saveCart = () => store.set(cartKey, cart);

  // ---------------------------------------------------------------- load ---
  async function load() {
    try {
      if (tableCode) {
        const data = await api.get(
          `/public/r/${encodeURIComponent(slug)}/table/${encodeURIComponent(tableCode)}`,
          { anonymous: true }
        );
        restaurant = data.restaurant;
        $('#r-context').textContent = `${data.table.label} · ${data.table.zone}`;
      }

      const menu = await api.get(`/public/r/${encodeURIComponent(slug)}`, { anonymous: true });
      restaurant = menu.restaurant;
      categories = menu.categories;

      if (!tableCode) $('#r-context').textContent = t('menu.browsingOnly');

      document.title = `${loc(restaurant, 'name')} — ${t('landing.menu')}`;
      $('#r-name').textContent = loc(restaurant, 'name');
      if (restaurant.primary_color) {
        document.documentElement.style.setProperty('--brand', restaurant.primary_color);
      }

      categories.forEach((c) => c.items.forEach((i) => itemsById.set(i.id, i)));

      // Drop cart lines for dishes that vanished or sold out since last visit.
      const before = cart.length;
      cart = cart.filter((line) => {
        const item = itemsById.get(line.item_id);
        return item && item.is_available;
      });
      if (cart.length !== before) {
        saveCart();
        toast(t('menu.itemsRemoved'), 'error');
      }

      render();
    } catch (error) {
      mount(
        $('#content'),
        el('div.empty', [
          el('div.empty-icon', '🍽️'),
          el('h2', t('menu.unavailable')),
          el('p', error.message),
          el('a.btn.btn-primary', { href: '/' }, t('menu.backHome')),
        ])
      );
    }
  }

  // -------------------------------------------------------------- render ---
  function render() {
    renderTabs();
    renderMenu();
    renderCartBar();
  }

  function renderTabs() {
    const host = $('#cat-tabs');
    host.hidden = false;
    mount(
      host,
      categories.map((category) =>
        el(
          'button.cat-tab',
          {
            type: 'button',
            role: 'tab',
            class: category.id === activeCategoryId ? 'active' : '',
            onclick: () => {
              activeCategoryId = category.id;
              renderTabs();
              const target = document.getElementById(`cat-${category.id}`);
              if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
          `${category.icon ? `${category.icon} ` : ''}${loc(category, 'name')}`
        )
      )
    );
  }

  function dishThumb(item, categoryIcon) {
    if (item.image_url) {
      return el('div.dish-thumb', el('img', { src: item.image_url, alt: '', loading: 'lazy' }));
    }
    return el('div.dish-thumb', categoryIcon || '🍽️');
  }

  function renderMenu() {
    const host = $('#content');
    const blocks = [];

    blocks.push(
      el('div.hero-cover.mb-16', restaurant.logo_url
        ? el('img', { src: restaurant.logo_url, alt: '', style: { height: '100%', width: '100%', objectFit: 'cover' } })
        : '🍽️')
    );

    blocks.push(
      el('div.mb-16', [
        el('h1', { style: { marginBottom: '4px' } }, loc(restaurant, 'name')),
        el('p.small.muted', { style: { marginBottom: '8px' } }, loc(restaurant, 'description')),
        el('div.row.wrap.gap-8.small.faint', [
          restaurant.cuisine ? el('span', restaurant.cuisine) : null,
          restaurant.opening_hours ? el('span', `· ${restaurant.opening_hours}`) : null,
        ]),
        !restaurant.accepts_orders
          ? el('div.card.card-pad.mt-16', { style: { background: 'var(--warn-soft)', borderColor: 'transparent' } },
              el('div.small.strong', { style: { color: 'var(--warn)' } },
                t('menu.pausedNotice')))
          : null,
        !tableCode
          ? el('div.card.card-pad.mt-16', { style: { background: 'var(--info-soft)', borderColor: 'transparent' } },
              el('div.small', { style: { color: 'var(--info)' } },
                t('menu.previewNotice')))
          : null,
      ])
    );

    const featured = categories.flatMap((c) => c.items.filter((i) => i.is_featured && i.is_available));
    if (featured.length) {
      blocks.push(
        el('section.mb-24', [
          el('h2', `⭐ ${t('menu.popular')}`),
          el('div.card', el('div', { style: { padding: '0 16px' } },
            featured.slice(0, 4).map((item) => dishRow(item, findCategoryIcon(item))))),
        ])
      );
    }

    for (const category of categories) {
      blocks.push(
        el('section', { id: `cat-${category.id}`, style: { scrollMarginTop: '118px', marginBottom: '26px' } }, [
          el('h2', `${category.icon ? `${category.icon} ` : ''}${loc(category, 'name')}`),
          loc(category, 'description') ? el('p.small.muted', { style: { marginTop: '-6px' } }, loc(category, 'description')) : null,
          el('div.card', el('div', { style: { padding: '0 16px' } },
            category.items.map((item) => dishRow(item, category.icon)))),
        ])
      );
    }

    blocks.push(
      el('div.card.card-pad.mt-24', [
        el('h3', t('menu.needSomething')),
        el('div.row.wrap.gap-8', [
          serviceButton('waiter', `🙋 ${t('menu.callWaiter')}`),
          serviceButton('water', `💧 ${t('menu.askWater')}`),
          serviceButton('bill', `🧾 ${t('menu.requestBill')}`),
          serviceButton('cleanup', `🧽 ${t('menu.clearTable')}`),
        ]),
        !tableCode ? el('p.tiny.faint.mt-8', { style: { marginBottom: 0 } }, t('menu.serviceAfterScan')) : null,
      ])
    );

    blocks.push(
      el('div.center.mt-24', [
        el('a.btn.btn-sm', { href: '/orders' }, t('menu.previousOrders')),
      ])
    );

    mount(host, blocks);
  }

  function findCategoryIcon(item) {
    const category = categories.find((c) => c.id === item.category_id);
    return category ? category.icon : '';
  }

  function dishRow(item, categoryIcon) {
    const inCart = cart.filter((line) => line.item_id === item.id).reduce((sum, line) => sum + line.qty, 0);

    return el(
      'div.dish',
      {
        class: item.is_available ? '' : 'sold-out',
        onclick: () => { if (item.is_available) openItem(item, categoryIcon); },
      },
      [
        dishThumb(item, categoryIcon),
        el('div.grow', [
          el('div.row.gap-8', [
            el('div.dish-name.grow', loc(item, 'name')),
            inCart ? el('span.badge.badge-brand', `${inCart} ${t('menu.inCart')}`) : null,
          ]),
          loc(item, 'description') ? el('div.dish-desc', loc(item, 'description')) : null,
          el('div.row.wrap.gap-8', [
            el('span.dish-price', money(item.price, restaurant.currency)),
            !item.is_available ? el('span.badge.badge-danger', t('menu.soldOut')) : null,
            ...item.tags.map((tag) => el('span.badge', tag)),
            item.calories ? el('span.tiny.faint', t('menu.kcal', { n: item.calories })) : null,
          ]),
        ]),
      ]
    );
  }

  // ----------------------------------------------------------- item modal ---
  function openItem(item, categoryIcon) {
    let qty = 1;
    const selected = new Map(); // groupId → Set(optionId)
    item.option_groups.forEach((group) => selected.set(group.id, new Set()));

    // Pre-select the first choice of a required single-pick group.
    for (const group of item.option_groups) {
      if (group.min_select >= 1 && group.max_select === 1 && group.options.length) {
        selected.get(group.id).add(group.options[0].id);
      }
    }

    const priceNode = el('span', '');
    const qtyNode = el('span', '1');

    function currentUnitPrice() {
      let price = item.price;
      for (const group of item.option_groups) {
        for (const option of group.options) {
          if (selected.get(group.id).has(option.id)) price += option.price_delta;
        }
      }
      return price;
    }

    function refreshPrice() {
      priceNode.textContent = money(currentUnitPrice() * qty, restaurant.currency);
      qtyNode.textContent = String(qty);
    }

    const groupNodes = item.option_groups.map((group) => {
      const requirement = group.min_select > 0
        ? t('menu.requiredChoose', {
            range: group.min_select === group.max_select
              ? group.min_select
              : `${group.min_select}–${group.max_select}`,
          })
        : t('menu.optionalUpTo', { n: group.max_select });
      const single = group.max_select === 1;

      return el('div.mb-16', [
        el('div.row.between', [
          el('strong', loc(group, 'name')),
          el('span.tiny.faint', requirement),
        ]),
        el('div.mt-8', group.options.map((option) =>
          el('label.check', { style: { padding: '7px 0', borderBottom: '1px solid var(--border)' } }, [
            el('input', {
              type: single ? 'radio' : 'checkbox',
              name: `group-${group.id}`,
              checked: selected.get(group.id).has(option.id),
              onchange: (event) => {
                const set = selected.get(group.id);
                if (single) {
                  set.clear();
                  if (event.target.checked) set.add(option.id);
                } else if (event.target.checked) {
                  if (set.size >= group.max_select) {
                    event.target.checked = false;
                    toast(t('menu.chooseAtMost', { n: group.max_select, group: loc(group, 'name') }), 'error');
                    return;
                  }
                  set.add(option.id);
                } else {
                  set.delete(option.id);
                }
                refreshPrice();
              },
            }),
            el('span.grow', loc(option, 'name')),
            option.price_delta
              ? el('span.small.muted', `${option.price_delta > 0 ? '+' : ''}${money(option.price_delta, restaurant.currency)}`)
              : null,
          ])
        )),
      ]);
    });

    const noteInput = el('textarea', {
      id: 'item-note', rows: 2, maxlength: 300,
      placeholder: t('menu.notePlaceholder'),
    });

    const handle = modal({
      title: loc(item, 'name'),
      body: [
        item.image_url
          ? el('img', { src: item.image_url, alt: '', style: { borderRadius: '12px', marginBottom: '14px' } })
          : el('div.hero-cover.mb-16', { style: { height: '110px' } }, categoryIcon || '🍽️'),
        loc(item, 'description') ? el('p.muted', loc(item, 'description')) : null,
        el('div.row.wrap.gap-8.mb-16', [
          el('span.badge', t('menu.minutes', { n: item.prep_minutes })),
          item.calories ? el('span.badge', t('menu.kcal', { n: item.calories })) : null,
          ...item.tags.map((tag) => el('span.badge.badge-ok', tag)),
        ]),
        ...groupNodes,
        el('div.field', [el('label', { for: 'item-note' }, t('menu.noteForKitchen')), noteInput]),
      ],
      actions: (h) => [
        el('div.qty', [
          el('button', { type: 'button', onclick: () => { if (qty > 1) { qty -= 1; refreshPrice(); } }, 'aria-label': 'Decrease' }, '−'),
          qtyNode,
          el('button', { type: 'button', onclick: () => { if (qty < 50) { qty += 1; refreshPrice(); } }, 'aria-label': 'Increase' }, '+'),
        ]),
        el('button.btn.btn-primary.grow', {
          onclick: () => {
            for (const group of item.option_groups) {
              if (selected.get(group.id).size < group.min_select) {
                toast(t('menu.chooseAtLeast', { n: group.min_select, group: loc(group, 'name') }), 'error');
                return;
              }
            }
            addToCart(item, qty, selected, noteInput.value.trim());
            h.close();
          },
        }, [`${t('common.add')} · `, priceNode]),
      ],
    });

    refreshPrice();
    return handle;
  }

  function addToCart(item, qty, selected, note) {
    const optionIds = [];
    const optionLabels = [];
    for (const group of item.option_groups) {
      for (const option of group.options) {
        if (selected.get(group.id).has(option.id)) {
          optionIds.push(option.id);
          optionLabels.push(loc(option, 'name'));
        }
      }
    }

    let unitPrice = item.price;
    for (const group of item.option_groups) {
      for (const option of group.options) {
        if (optionIds.includes(option.id)) unitPrice += option.price_delta;
      }
    }

    // Identical configurations merge into one line.
    const signature = `${item.id}|${optionIds.slice().sort((a, b) => a - b).join(',')}|${note}`;
    const existing = cart.find((line) => line.signature === signature);
    if (existing) {
      existing.qty = Math.min(50, existing.qty + qty);
    } else {
      cart.push({
        signature,
        item_id: item.id,
        name: loc(item, 'name'),
        unit_price: unitPrice,
        qty,
        option_ids: optionIds,
        option_labels: optionLabels,
        note,
      });
    }

    saveCart();
    render();
    toast(t('menu.addedToOrder', { name: loc(item, 'name') }), 'success');
  }

  // ------------------------------------------------------------ cart bar ---
  function renderCartBar() {
    const bar = $('#cart-bar');
    const count = cartCount();
    bar.hidden = count === 0;
    if (count === 0) return;

    $('#cart-count').textContent = `${count} ${t('common.items')}`;
    $('#cart-total').textContent = money(cartTotal(), restaurant.currency);
  }

  function openCart() {
    if (!cart.length) return;

    const body = el('div');

    function paint() {
      const subtotal = cartTotal();
      const service = subtotal * restaurant.service_charge_rate;
      const tax = (subtotal + service) * restaurant.tax_rate;

      mount(body, [
        el('div.mb-16', cart.map((line, index) =>
          el('div.row.top.gap-8', { style: { padding: '10px 0', borderBottom: '1px solid var(--border)' } }, [
            el('div.grow', [
              el('div.strong', line.name),
              line.option_labels.length ? el('div.tiny.muted', line.option_labels.join(' · ')) : null,
              line.note ? el('div.tiny.faint', `Note: ${line.note}`) : null,
              el('div.small.muted.mt-4', money(line.unit_price, restaurant.currency)),
            ]),
            el('div.col.gap-4', { style: { alignItems: 'flex-end' } }, [
              el('div.qty', [
                el('button', {
                  type: 'button', 'aria-label': 'Decrease',
                  onclick: () => {
                    if (line.qty > 1) line.qty -= 1;
                    else cart.splice(index, 1);
                    saveCart();
                    if (!cart.length) { handle.close(); render(); return; }
                    paint();
                    render();
                  },
                }, '−'),
                el('span', String(line.qty)),
                el('button', {
                  type: 'button', 'aria-label': 'Increase',
                  onclick: () => { line.qty = Math.min(50, line.qty + 1); saveCart(); paint(); render(); },
                }, '+'),
              ]),
              el('div.small.strong', money(line.unit_price * line.qty, restaurant.currency)),
            ]),
          ])
        )),

        el('div.col.gap-4.small', [
          totalRow(t('common.subtotal'), subtotal),
          restaurant.service_charge_rate
            ? totalRow(`${t('common.serviceCharge')} (${Math.round(restaurant.service_charge_rate * 100)}%)`, service)
            : null,
          restaurant.tax_rate ? totalRow(`${t('common.tax')} (${Math.round(restaurant.tax_rate * 100)}%)`, tax) : null,
          el('hr', { style: { margin: '8px 0' } }),
          el('div.row.between', [
            el('strong', t('common.total')),
            el('strong', { style: { fontSize: '1.15rem' } }, money(subtotal + service + tax, restaurant.currency)),
          ]),
        ]),

        el('div.field.mt-24', [
          el('label', { for: 'order-note' }, t('menu.noteWholeOrder')),
          el('textarea', { id: 'order-note', rows: 2, maxlength: 500, placeholder: t('menu.notePlaceholder2') }),
        ]),
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'guest-name' }, t('menu.guestName')),
            el('input', { id: 'guest-name', type: 'text', maxlength: 80, value: store.get('menu.guestName', '') }),
          ]),
          el('div.field', [
            el('label', { for: 'guest-phone' }, t('menu.guestPhone')),
            el('input', { id: 'guest-phone', type: 'tel', maxlength: 40, value: store.get('menu.guestPhone', '') }),
          ]),
        ]),
      ]);
    }

    function totalRow(label, value) {
      return el('div.row.between', [el('span.muted', label), el('span', money(value, restaurant.currency))]);
    }

    const handle = modal({
      title: `${t('menu.yourOrder')} · ${tableCode ? t('menu.tableCode', { code: tableCode }) : t('common.takeaway')}`,
      body,
      actions: (h) => [
        el('button.btn', {
          onclick: async () => {
            if (await confirmDialog({ title: t('menu.emptyCartTitle'), message: t('menu.emptyCartBody'), confirmLabel: t('menu.emptyCart') })) {
              cart = [];
              saveCart();
              h.close();
              render();
            }
          },
        }, t('menu.emptyCart')),
        el('button.btn.btn-primary.grow', { id: 'place-order', onclick: () => placeOrder(h) },
          tableCode ? t('menu.sendToKitchen') : t('menu.scanToOrder')),
      ],
    });

    paint();
    if (!tableCode) $('#place-order').disabled = true;
    return handle;
  }

  const placeOrder = guard(async (handle) => {
    if (!tableCode) {
      toast(t('menu.helpNoTable'), 'error');
      return;
    }
    if (!restaurant.accepts_orders) {
      toast(t('menu.pausedNotice'), 'error');
      return;
    }

    const button = $('#place-order');
    const name = $('#guest-name').value.trim();
    const phone = $('#guest-phone').value.trim();
    store.set('menu.guestName', name);
    store.set('menu.guestPhone', phone);

    button.disabled = true;
    button.textContent = t('menu.sending');

    try {
      const { order } = await api.post(
        '/public/orders',
        {
          slug,
          table_code: tableCode,
          type: 'dine_in',
          customer_name: name,
          customer_phone: phone,
          note: $('#order-note').value.trim(),
          session_id: sessionId(),
          items: cart.map((line) => ({ item_id: line.item_id, qty: line.qty, option_ids: line.option_ids, note: line.note })),
        },
        { anonymous: true }
      );

      cart = [];
      saveCart();
      handle.close();
      location.href = `/order/${order.code}`;
    } catch (error) {
      button.disabled = false;
      button.textContent = t('menu.sendToKitchen');
      throw error;
    }
  });

  // ------------------------------------------------------ service buttons ---
  function serviceButton(type, label) {
    return el('button.btn.btn-sm', {
      type: 'button',
      disabled: !tableCode,
      onclick: guard(async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await api.post('/public/service-requests', { slug, table_code: tableCode, type }, { anonymous: true });
          toast(t('menu.staffNotified'), 'success');
        } finally {
          setTimeout(() => { button.disabled = false; }, 8000);
        }
      }),
    }, label);
  }

  // --------------------------------------------------------------- wiring ---
  $('#view-cart').addEventListener('click', openCart);
  $('#help-btn').addEventListener('click', () => {
    modal({
      title: t('menu.howOrderingWorks'),
      body: [
        el('ol', { style: { paddingLeft: '20px', lineHeight: '1.9' } }, [
          el('li', t('menu.help1')),
          el('li', t('menu.help2')),
          el('li', t('menu.help3')),
          el('li', t('menu.help4')),
        ]),
        tableCode
          ? el('p.small.muted', t('menu.helpTable', { code: tableCode }))
          : el('p.small.muted', t('menu.helpNoTable')),
        restaurant && restaurant.phone ? el('p.small', t('menu.callRestaurant', { phone: restaurant.phone })) : null,
      ],
      actions: (h) => [el('button.btn.btn-primary', { onclick: h.close }, t('menu.gotIt'))],
    });
  });

  load();
})();
