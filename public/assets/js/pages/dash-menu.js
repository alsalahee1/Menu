/* Menu editor: categories, dishes, option groups and the sold-out switch. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, toast, modal, confirmDialog, guard, viewRestaurant,
  } = window.App;

  const shell = window.Shell.boot({
    kind: 'restaurant', title: 'Menu', roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  const viewing = viewRestaurant.get();
  const currency = (viewing && viewing.currency) || (shell.user.restaurant && shell.user.restaurant.currency) || 'USD';

  let menu = { categories: [], uncategorized: [] };
  let search = '';

  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('button.btn.btn-sm', { onclick: () => categoryDialog() }, '+ Category'),
    el('button.btn.btn-primary.btn-sm', { onclick: () => itemDialog() }, '+ Dish'),
  ]);

  async function load() {
    try {
      menu = await api.get('/rest/menu');
      render();
    } catch (error) {
      mount(root, el('div.card.empty', error.message));
    }
  }

  const allCategories = () => menu.categories;

  function matches(item) {
    if (!search) return true;
    const needle = search.toLowerCase();
    return item.name.toLowerCase().includes(needle) || item.description.toLowerCase().includes(needle);
  }

  function render() {
    const groups = [
      ...menu.categories.map((category) => ({ category, items: category.items.filter(matches) })),
      ...(menu.uncategorized.length
        ? [{ category: null, items: menu.uncategorized.filter(matches) }]
        : []),
    ];

    const itemCount = menu.categories.reduce((sum, c) => sum + c.items.length, 0) + menu.uncategorized.length;
    const soldOut = menu.categories.flatMap((c) => c.items).concat(menu.uncategorized).filter((i) => !i.is_available).length;

    mount(root, [
      el('div.card.card-pad.mb-16', el('div.row.wrap.gap-8', [
        el('div.grow', [
          el('div.small.strong', `${itemCount} dishes in ${menu.categories.length} categories`),
          el('div.tiny.muted', soldOut ? `${soldOut} marked sold out` : 'Everything is available'),
        ]),
        el('input', {
          type: 'search', placeholder: 'Search dishes', value: search, style: { maxWidth: '260px' },
          oninput: window.App.debounce((event) => { search = event.target.value; render(); }, 200),
        }),
      ])),

      groups.length === 0 || groups.every((g) => g.items.length === 0)
        ? el('div.card.empty', [
            el('div.empty-icon', '🍽️'),
            el('p', search ? 'No dishes match your search.' : 'Your menu is empty. Add a category, then add dishes to it.'),
            !search ? el('button.btn.btn-primary', { onclick: () => categoryDialog() }, 'Add first category') : null,
          ])
        : el('div.col.gap-16', groups.map(categoryBlock)),
    ]);
  }

  function categoryBlock({ category, items }) {
    if (search && !items.length) return null;

    return el('div.card', [
      el('div.card-head', [
        el('div.row.gap-8', [
          el('h2', category ? `${category.icon ? `${category.icon} ` : ''}${category.name}` : 'Uncategorised'),
          category && !category.is_active ? el('span.badge.badge-warn', 'Hidden from guests') : null,
          el('span.badge', `${items.length}`),
        ]),
        category
          ? el('div.row.gap-8', [
              el('button.btn.btn-sm', { onclick: () => itemDialog(null, category.id) }, '+ Dish'),
              el('button.btn.btn-sm', { onclick: () => categoryDialog(category) }, 'Edit'),
              el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteCategory(category) }, '🗑'),
            ])
          : el('span.tiny.faint', 'These dishes have no category and stay hidden from the guest menu.'),
      ]),

      items.length
        ? el('div.table-wrap', el('table.data', [
            el('thead', el('tr', [
              el('th', 'Dish'), el('th.right', 'Price'), el('th', 'Options'),
              el('th', 'Available'), el('th', ''),
            ])),
            el('tbody', items.map(itemRow)),
          ]))
        : el('div.empty', 'No dishes here yet.'),
    ]);
  }

  function itemRow(item) {
    const toggle = el('input', {
      type: 'checkbox',
      checked: item.is_available,
      onchange: guard(async (event) => {
        const value = event.target.checked;
        await api.patch(`/rest/items/${item.id}/availability`, { is_available: value });
        item.is_available = value;
        toast(`${item.name} is now ${value ? 'available' : 'sold out'}`, 'success');
      }),
    });

    return el('tr', [
      el('td', [
        el('div.row.gap-8', [
          el('span.strong', item.name),
          item.is_featured ? el('span.badge.badge-warn', '⭐') : null,
          ...item.tags.map((tag) => el('span.badge', tag)),
        ]),
        item.description ? el('div.tiny.muted.truncate', { style: { maxWidth: '380px' } }, item.description) : null,
      ]),
      el('td.right.nowrap', money(item.price, currency)),
      el('td', [
        el('button.btn.btn-sm.btn-ghost', { onclick: () => optionsDialog(item) },
          item.option_groups.length ? `${item.option_groups.length} group${item.option_groups.length === 1 ? '' : 's'}` : '+ Add'),
      ]),
      el('td', el('label.check', [toggle, el('span.tiny', item.is_available ? 'On menu' : 'Sold out')])),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => itemDialog(item) }, 'Edit'),
        el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteItem(item) }, '🗑'),
      ]),
    ]);
  }

  // ------------------------------------------------------------ category ---
  function categoryDialog(category) {
    const editing = Boolean(category);

    modal({
      title: editing ? `Edit "${category.name}"` : 'New category',
      body: el('form', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'cat-name' }, 'Name'),
            el('input', { id: 'cat-name', type: 'text', required: true, maxlength: 80, value: editing ? category.name : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'cat-icon' }, 'Icon (emoji)'),
            el('input', { id: 'cat-icon', type: 'text', maxlength: 4, value: editing ? category.icon : '', placeholder: '🍕' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'cat-desc' }, 'Description'),
            el('input', { id: 'cat-desc', type: 'text', maxlength: 300, value: editing ? category.description : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'cat-sort' }, 'Sort order'),
            el('input', { id: 'cat-sort', type: 'number', min: 0, max: 9999, value: editing ? category.sort_order : menu.categories.length }),
          ]),
          el('div.field', [
            el('label', 'Visibility'),
            el('label.check', [
              el('input', { id: 'cat-active', type: 'checkbox', checked: editing ? category.is_active : true }),
              el('span', 'Show this category to guests'),
            ]),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#cat-name').value.trim(),
              icon: $('#cat-icon').value.trim(),
              description: $('#cat-desc').value.trim(),
              sort_order: Number($('#cat-sort').value || 0),
              is_active: $('#cat-active').checked,
            };
            if (!payload.name) return toast('Please give the category a name', 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/categories/${category.id}`, payload) : api.post('/rest/categories', payload));
            handle.close();
            toast(editing ? 'Category updated' : 'Category created', 'success');
            return load();
          }),
        }, editing ? 'Save changes' : 'Create category'),
      ],
    });
  }

  const deleteCategory = guard(async (category) => {
    const ok = await confirmDialog({
      title: `Delete "${category.name}"?`,
      message: `The ${category.items.length} dish(es) in it are kept but become uncategorised and hidden from guests until you move them.`,
      confirmLabel: 'Delete category',
    });
    if (!ok) return;
    await api.del(`/rest/categories/${category.id}`);
    toast('Category deleted', 'success');
    load();
  });

  // ---------------------------------------------------------------- item ---
  function itemDialog(item, presetCategoryId) {
    const editing = Boolean(item);

    modal({
      wide: true,
      title: editing ? `Edit "${item.name}"` : 'New dish',
      body: el('form', [
        el('div.form-grid', [
          el('div.field.full', [
            el('label', { for: 'item-name' }, 'Name'),
            el('input', { id: 'item-name', type: 'text', required: true, maxlength: 120, value: editing ? item.name : '' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-desc' }, 'Description'),
            el('textarea', { id: 'item-desc', rows: 2, maxlength: 600 }, editing ? item.description : ''),
          ]),
          el('div.field', [
            el('label', { for: 'item-price' }, `Price (${currency})`),
            el('input', { id: 'item-price', type: 'number', step: '0.01', min: 0, required: true, value: editing ? item.price : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'item-category' }, 'Category'),
            el('select', { id: 'item-category' }, [
              el('option', { value: '' }, '— Uncategorised —'),
              ...allCategories().map((category) =>
                el('option', {
                  value: category.id,
                  selected: editing ? item.category_id === category.id : presetCategoryId === category.id,
                }, category.name)),
            ]),
          ]),
          el('div.field', [
            el('label', { for: 'item-prep' }, 'Prep time (minutes)'),
            el('input', { id: 'item-prep', type: 'number', min: 0, max: 600, value: editing ? item.prep_minutes : 10 }),
          ]),
          el('div.field', [
            el('label', { for: 'item-cal' }, 'Calories (optional)'),
            el('input', { id: 'item-cal', type: 'number', min: 0, max: 10000, value: editing && item.calories ? item.calories : '' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-tags' }, 'Tags'),
            el('input', {
              id: 'item-tags', type: 'text', maxlength: 200,
              placeholder: 'vegan, spicy, gluten-free',
              value: editing ? item.tags.join(', ') : '',
            }),
            el('div.hint', 'Comma separated. Shown as small labels on the guest menu.'),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-image' }, 'Image URL (optional)'),
            el('input', { id: 'item-image', type: 'url', maxlength: 500, value: editing ? item.image_url : '', placeholder: 'https://…' }),
          ]),
          el('div.field', [
            el('label', 'Availability'),
            el('label.check', [
              el('input', { id: 'item-available', type: 'checkbox', checked: editing ? item.is_available : true }),
              el('span', 'Available to order'),
            ]),
          ]),
          el('div.field', [
            el('label', 'Highlight'),
            el('label.check', [
              el('input', { id: 'item-featured', type: 'checkbox', checked: editing ? item.is_featured : false }),
              el('span', 'Show under "Popular right now"'),
            ]),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#item-name').value.trim(),
              description: $('#item-desc').value.trim(),
              price: Number($('#item-price').value),
              category_id: $('#item-category').value || null,
              prep_minutes: Number($('#item-prep').value || 10),
              calories: $('#item-cal').value === '' ? null : Number($('#item-cal').value),
              tags: $('#item-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
              image_url: $('#item-image').value.trim(),
              is_available: $('#item-available').checked,
              is_featured: $('#item-featured').checked,
            };
            if (!payload.name) return toast('Please give the dish a name', 'error');
            if (!Number.isFinite(payload.price) || payload.price < 0) return toast('Enter a valid price', 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/items/${item.id}`, payload) : api.post('/rest/items', payload));
            handle.close();
            toast(editing ? 'Dish updated' : 'Dish added', 'success');
            return load();
          }),
        }, editing ? 'Save changes' : 'Add dish'),
      ],
    });
  }

  const deleteItem = guard(async (item) => {
    const ok = await confirmDialog({
      title: `Delete "${item.name}"?`,
      message: 'Past orders keep their record of this dish, but it disappears from the menu.',
      confirmLabel: 'Delete dish',
    });
    if (!ok) return;
    await api.del(`/rest/items/${item.id}`);
    toast('Dish deleted', 'success');
    load();
  });

  // ------------------------------------------------------------- options ---
  function optionsDialog(item) {
    const body = el('div');

    function paint(groups) {
      mount(body, [
        el('p.small.muted', 'Option groups let guests choose sizes, sides and extras. A group with a minimum of 1 forces a choice.'),
        groups.length
          ? el('div.col.gap-16', groups.map((group) =>
              el('div.card.card-pad', [
                el('div.row.between.mb-8', [
                  el('div', [
                    el('strong', group.name),
                    el('div.tiny.muted',
                      group.min_select > 0
                        ? `Required · choose ${group.min_select}–${group.max_select}`
                        : `Optional · up to ${group.max_select}`),
                  ]),
                  el('button.btn.btn-sm.btn-ghost', {
                    onclick: guard(async () => {
                      const ok = await confirmDialog({
                        title: `Delete "${group.name}"?`,
                        message: 'All of its choices are removed too.',
                        confirmLabel: 'Delete group',
                      });
                      if (!ok) return;
                      await api.del(`/rest/option-groups/${group.id}`);
                      refresh();
                    }),
                  }, '🗑'),
                ]),

                group.options.length
                  ? el('div.col.gap-4.mb-8', group.options.map((option) =>
                      el('div.row.between.small', { style: { padding: '4px 0', borderBottom: '1px solid var(--border)' } }, [
                        el('span.grow', option.name),
                        el('span.muted', option.price_delta
                          ? `${option.price_delta > 0 ? '+' : ''}${money(option.price_delta, currency)}`
                          : 'Free'),
                        el('button.btn.btn-sm.btn-ghost', {
                          onclick: guard(async () => { await api.del(`/rest/options/${option.id}`); refresh(); }),
                        }, '✕'),
                      ])
                    ))
                  : el('div.tiny.faint.mb-8', 'No choices yet.'),

                el('form.row.gap-8', {
                  onsubmit: guard(async (event) => {
                    event.preventDefault();
                    const nameInput = event.target.querySelector('.opt-name');
                    const priceInput = event.target.querySelector('.opt-price');
                    if (!nameInput.value.trim()) return;
                    await api.post(`/rest/option-groups/${group.id}/options`, {
                      name: nameInput.value.trim(),
                      price_delta: Number(priceInput.value || 0),
                    });
                    refresh();
                  }),
                }, [
                  el('input.opt-name', { type: 'text', placeholder: 'Choice name', maxlength: 80, required: true }),
                  el('input.opt-price', { type: 'number', step: '0.01', placeholder: '+0.00', style: { maxWidth: '110px' } }),
                  el('button.btn.btn-sm', { type: 'submit' }, 'Add'),
                ]),
              ])
            ))
          : el('div.empty', 'This dish has no option groups yet.'),

        el('div.card.card-pad.mt-16', [
          el('h3', 'New option group'),
          el('form', {
            onsubmit: guard(async (event) => {
              event.preventDefault();
              const min = Number($('#group-min').value || 0);
              const max = Number($('#group-max').value || 1);
              if (min > max) return toast('Minimum cannot be larger than maximum', 'error');
              await api.post(`/rest/items/${item.id}/option-groups`, {
                name: $('#group-name').value.trim(),
                min_select: min,
                max_select: max,
              });
              $('#group-name').value = '';
              return refresh();
            }),
          }, [
            el('div.form-grid', [
              el('div.field.full', [
                el('label', { for: 'group-name' }, 'Group name'),
                el('input', { id: 'group-name', type: 'text', required: true, maxlength: 80, placeholder: 'e.g. Choose a size' }),
              ]),
              el('div.field', [
                el('label', { for: 'group-min' }, 'Minimum choices'),
                el('input', { id: 'group-min', type: 'number', min: 0, max: 20, value: 0 }),
              ]),
              el('div.field', [
                el('label', { for: 'group-max' }, 'Maximum choices'),
                el('input', { id: 'group-max', type: 'number', min: 1, max: 20, value: 1 }),
              ]),
            ]),
            el('button.btn.btn-primary.btn-sm', { type: 'submit' }, 'Add group'),
          ]),
        ]),
      ]);
    }

    async function refresh() {
      menu = await api.get('/rest/menu');
      const fresh = menu.categories.flatMap((c) => c.items).concat(menu.uncategorized).find((i) => i.id === item.id);
      paint(fresh ? fresh.option_groups : []);
      render();
    }

    modal({
      wide: true,
      title: `Options for "${item.name}"`,
      body,
      actions: (handle) => [el('button.btn.btn-primary', { onclick: handle.close }, 'Done')],
    });
    paint(item.option_groups);
  }

  load();
})();
