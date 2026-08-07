/* Menu editor: categories, dishes, option groups and the sold-out switch. */
/* eslint-env browser */
(function () {
  'use strict';

  const {
    el, $, mount, api, money, toast, modal, confirmDialog, guard, viewRestaurant,
  } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  const loc = (row, field) => window.I18n.localised(row, field);

  const shell = window.Shell.boot({
    kind: 'restaurant', title: t('nav.menu'), roles: ['owner', 'manager', 'super_admin'],
  });
  if (!shell) return;

  const viewing = viewRestaurant.get();
  const currency = (viewing && viewing.currency) || (shell.user.restaurant && shell.user.restaurant.currency) || 'USD';

  let menu = { categories: [], uncategorized: [] };
  let search = '';

  const root = el('div');
  shell.page.appendChild(root);

  shell.setActions([
    el('button.btn.btn-sm', { onclick: () => categoryDialog() }, `+ ${t('edit.category')}`),
    el('button.btn.btn-primary.btn-sm', { onclick: () => itemDialog() }, `+ ${t('edit.dish')}`),
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
          el('div.small.strong', t('edit.dishesInCategories', { items: itemCount, categories: menu.categories.length })),
          el('div.tiny.muted', soldOut ? t('edit.markedSoldOut', { n: soldOut }) : t('edit.everythingAvailable')),
        ]),
        el('input', {
          type: 'search', placeholder: t('edit.searchDishes'), value: search, style: { maxWidth: '260px' },
          oninput: window.App.debounce((event) => { search = event.target.value; render(); }, 200),
        }),
      ])),

      groups.length === 0 || groups.every((g) => g.items.length === 0)
        ? el('div.card.empty', [
            el('div.empty-icon', '🍽️'),
            el('p', search ? t('edit.noMatch') : t('edit.emptyMenu')),
            !search ? el('button.btn.btn-primary', { onclick: () => categoryDialog() }, t('edit.addFirstCategory')) : null,
          ])
        : el('div.col.gap-16', groups.map(categoryBlock)),
    ]);
  }

  function categoryBlock({ category, items }) {
    if (search && !items.length) return null;

    return el('div.card', [
      el('div.card-head', [
        el('div.row.gap-8', [
          el('h2', category ? `${category.icon ? `${category.icon} ` : ''}${category.name}` : t('edit.uncategorised')),
          category && !category.is_active ? el('span.badge.badge-warn', t('edit.hiddenFromGuests')) : null,
          el('span.badge', `${items.length}`),
        ]),
        category
          ? el('div.row.gap-8', [
              el('button.btn.btn-sm', { onclick: () => itemDialog(null, category.id) }, `+ ${t('edit.dish')}`),
              el('button.btn.btn-sm', { onclick: () => categoryDialog(category) }, t('common.edit')),
              el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteCategory(category) }, '🗑'),
            ])
          : el('span.tiny.faint', t('edit.uncategorisedHint')),
      ]),

      items.length
        ? el('div.table-wrap', el('table.data', [
            el('thead', el('tr', [
              el('th', t('edit.dish')), el('th.right', t('common.price')), el('th', t('edit.options')),
              el('th', t('edit.available')), el('th', ''),
            ])),
            el('tbody', items.map(itemRow)),
          ]))
        : el('div.empty', t('edit.noDishesHere')),
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
        toast(value ? t('edit.nowAvailable', { name: item.name }) : t('edit.nowSoldOut', { name: item.name }), 'success');
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
          item.option_groups.length ? t('edit.groupCount', { n: item.option_groups.length }) : `+ ${t('common.add')}`),
      ]),
      el('td', el('label.check', [toggle, el('span.tiny', item.is_available ? t('edit.onMenu') : t('edit.soldOut'))])),
      el('td.actions', [
        el('button.btn.btn-sm', { onclick: () => itemDialog(item) }, t('common.edit')),
        el('button.btn.btn-sm.btn-ghost', { onclick: () => deleteItem(item) }, '🗑'),
      ]),
    ]);
  }

  // ------------------------------------------------------------ category ---
  function categoryDialog(category) {
    const editing = Boolean(category);

    modal({
      title: editing ? t('edit.editCategory', { name: category.name }) : t('edit.newCategory'),
      body: el('form', [
        el('div.form-grid', [
          el('div.field', [
            el('label', { for: 'cat-name' }, t('common.name')),
            el('input', { id: 'cat-name', type: 'text', required: true, maxlength: 80, value: editing ? category.name : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'cat-icon' }, t('edit.iconEmoji')),
            el('input', { id: 'cat-icon', type: 'text', maxlength: 4, value: editing ? category.icon : '', placeholder: '🍕' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'cat-desc' }, t('edit.description')),
            el('input', { id: 'cat-desc', type: 'text', maxlength: 300, value: editing ? category.description : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'cat-name-ar' }, t('edit.arabicName')),
            el('input', {
              id: 'cat-name-ar', type: 'text', maxlength: 80, dir: 'rtl', lang: 'ar',
              value: editing ? category.name_ar || '' : '',
            }),
          ]),
          el('div.field', [
            el('label', { for: 'cat-desc-ar' }, t('edit.arabicDescription')),
            el('input', {
              id: 'cat-desc-ar', type: 'text', maxlength: 300, dir: 'rtl', lang: 'ar',
              value: editing ? category.description_ar || '' : '',
            }),
            el('div.hint', t('edit.arabicHint')),
          ]),
          el('div.field', [
            el('label', { for: 'cat-sort' }, t('edit.sortOrder')),
            el('input', { id: 'cat-sort', type: 'number', min: 0, max: 9999, value: editing ? category.sort_order : menu.categories.length }),
          ]),
          el('div.field', [
            el('label', t('edit.visibility')),
            el('label.check', [
              el('input', { id: 'cat-active', type: 'checkbox', checked: editing ? category.is_active : true }),
              el('span', t('edit.showToGuests')),
            ]),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#cat-name').value.trim(),
              name_ar: $('#cat-name-ar').value.trim(),
              icon: $('#cat-icon').value.trim(),
              description: $('#cat-desc').value.trim(),
              description_ar: $('#cat-desc-ar').value.trim(),
              sort_order: Number($('#cat-sort').value || 0),
              is_active: $('#cat-active').checked,
            };
            if (!payload.name) return toast(t('common.name'), 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/categories/${category.id}`, payload) : api.post('/rest/categories', payload));
            handle.close();
            toast(editing ? t('edit.categoryUpdated') : t('edit.categoryCreated'), 'success');
            return load();
          }),
        }, editing ? t('common.saveChanges') : t('edit.createCategory')),
      ],
    });
  }

  const deleteCategory = guard(async (category) => {
    const ok = await confirmDialog({
      title: t('edit.deleteCategoryTitle', { name: category.name }),
      message: t('edit.deleteCategoryBody', { n: category.items.length }),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.del(`/rest/categories/${category.id}`);
    toast(t('edit.categoryDeleted'), 'success');
    load();
  });

  // ---------------------------------------------------------------- item ---
  function itemDialog(item, presetCategoryId) {
    const editing = Boolean(item);

    modal({
      wide: true,
      title: editing ? t('edit.editDish', { name: item.name }) : t('edit.newDish'),
      body: el('form', [
        el('div.form-grid', [
          el('div.field.full', [
            el('label', { for: 'item-name' }, t('common.name')),
            el('input', { id: 'item-name', type: 'text', required: true, maxlength: 120, value: editing ? item.name : '' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-desc' }, t('edit.description')),
            el('textarea', { id: 'item-desc', rows: 2, maxlength: 600 }, editing ? item.description : ''),
          ]),
          el('div.field', [
            el('label', { for: 'item-price' }, `${t('common.price')} (${currency})`),
            el('input', { id: 'item-price', type: 'number', step: '0.01', min: 0, required: true, value: editing ? item.price : '' }),
          ]),
          el('div.field', [
            el('label', { for: 'item-category' }, t('edit.category')),
            el('select', { id: 'item-category' }, [
              el('option', { value: '' }, `— ${t('edit.uncategorised')} —`),
              ...allCategories().map((category) =>
                el('option', {
                  value: category.id,
                  selected: editing ? item.category_id === category.id : presetCategoryId === category.id,
                }, category.name)),
            ]),
          ]),
          el('div.field', [
            el('label', { for: 'item-prep' }, t('edit.prepTime')),
            el('input', { id: 'item-prep', type: 'number', min: 0, max: 600, value: editing ? item.prep_minutes : 10 }),
          ]),
          el('div.field', [
            el('label', { for: 'item-cal' }, t('edit.calories')),
            el('input', { id: 'item-cal', type: 'number', min: 0, max: 10000, value: editing && item.calories ? item.calories : '' }),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-tags' }, t('edit.tags')),
            el('input', {
              id: 'item-tags', type: 'text', maxlength: 200,
              placeholder: 'vegan, spicy, gluten-free',
              value: editing ? item.tags.join(', ') : '',
            }),
            el('div.hint', t('edit.tagsHint')),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-name-ar' }, t('edit.arabicName')),
            el('input', {
              id: 'item-name-ar', type: 'text', maxlength: 120, dir: 'rtl', lang: 'ar',
              value: editing ? item.name_ar || '' : '',
            }),
          ]),
          el('div.field.full', [
            el('label', { for: 'item-desc-ar' }, t('edit.arabicDescription')),
            el('textarea', {
              id: 'item-desc-ar', rows: 2, maxlength: 600, dir: 'rtl', lang: 'ar',
            }, editing ? item.description_ar || '' : ''),
            el('div.hint', t('edit.arabicHint')),
          ]),
          el('div.field.full', imageField(editing ? item.image_url : '')),
          el('div.field', [
            el('label', t('edit.availability')),
            el('label.check', [
              el('input', { id: 'item-available', type: 'checkbox', checked: editing ? item.is_available : true }),
              el('span', t('edit.availableToOrder')),
            ]),
          ]),
          el('div.field', [
            el('label', t('edit.highlight')),
            el('label.check', [
              el('input', { id: 'item-featured', type: 'checkbox', checked: editing ? item.is_featured : false }),
              el('span', t('edit.showUnderPopular')),
            ]),
          ]),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, t('common.cancel')),
        el('button.btn.btn-primary', {
          onclick: guard(async (event) => {
            const payload = {
              name: $('#item-name').value.trim(),
              name_ar: $('#item-name-ar').value.trim(),
              description: $('#item-desc').value.trim(),
              description_ar: $('#item-desc-ar').value.trim(),
              price: Number($('#item-price').value),
              category_id: $('#item-category').value || null,
              prep_minutes: Number($('#item-prep').value || 10),
              calories: $('#item-cal').value === '' ? null : Number($('#item-cal').value),
              tags: $('#item-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
              image_url: $('#item-image').value.trim(),
              is_available: $('#item-available').checked,
              is_featured: $('#item-featured').checked,
            };
            if (!payload.name) return toast(t('common.name'), 'error');
            if (!Number.isFinite(payload.price) || payload.price < 0) return toast(t('common.price'), 'error');

            await window.App.withBusy(event.currentTarget, () =>
              editing ? api.patch(`/rest/items/${item.id}`, payload) : api.post('/rest/items', payload));
            handle.close();
            toast(editing ? t('edit.dishUpdated') : t('edit.dishAdded'), 'success');
            return load();
          }),
        }, editing ? t('common.saveChanges') : t('edit.addDish')),
      ],
    });
  }

  /**
   * Image picker: uploads the chosen file to /api/uploads/image and writes the
   * returned path into the hidden URL field, which is what actually gets saved.
   * A URL can still be pasted directly.
   */
  function imageField(currentUrl) {
    const preview = el('div', {
      style: {
        width: '84px', height: '84px', borderRadius: 'var(--radius)', flex: 'none',
        background: 'var(--surface-3)', display: 'grid', placeItems: 'center',
        overflow: 'hidden', fontSize: '1.6rem',
      },
    });

    const urlInput = el('input', {
      id: 'item-image', type: 'url', maxlength: 500, value: currentUrl || '',
      placeholder: 'https://…',
      oninput: () => paint(urlInput.value.trim()),
    });

    const fileInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp',
      style: { display: 'none' },
      onchange: guard(async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        uploadButton.disabled = true;
        uploadButton.textContent = t('edit.uploading');
        try {
          // The endpoint takes the raw file as the body — no multipart needed.
          const response = await fetch('/api/uploads/image', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${window.App.auth.token}`,
              'Content-Type': file.type || 'application/octet-stream',
              ...(viewing ? { 'X-Restaurant-Id': String(viewing.id) } : {}),
            },
            body: file,
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error((payload && payload.error) || t('common.somethingWrong'));

          urlInput.value = payload.url;
          paint(payload.url);
          toast(t('edit.imageUploaded'), 'success');
        } finally {
          uploadButton.disabled = false;
          uploadButton.textContent = `⬆ ${t('edit.uploadImage')}`;
          fileInput.value = '';
        }
      }),
    });

    const uploadButton = el('button.btn.btn-sm', {
      type: 'button',
      onclick: () => fileInput.click(),
    }, `⬆ ${t('edit.uploadImage')}`);

    const clearButton = el('button.btn.btn-sm.btn-ghost', {
      type: 'button',
      onclick: () => { urlInput.value = ''; paint(''); },
    }, t('edit.removeImage'));

    function paint(url) {
      window.App.mount(preview, url
        ? el('img', {
            src: url, alt: '',
            style: { width: '100%', height: '100%', objectFit: 'cover' },
            onerror: () => window.App.mount(preview, '🖼️'),
          })
        : '🍽️');
      clearButton.style.display = url ? '' : 'none';
    }

    paint(currentUrl || '');

    return [
      el('label', t('edit.image')),
      el('div.row.gap-16.top', [
        preview,
        el('div.grow', [
          el('div.row.gap-8.mb-8', [uploadButton, clearButton, fileInput]),
          el('div.hint.mb-8', t('edit.imageHint')),
          urlInput,
        ]),
      ]),
    ];
  }

  const deleteItem = guard(async (item) => {
    const ok = await confirmDialog({
      title: t('edit.deleteDishTitle', { name: item.name }),
      message: t('edit.deleteDishBody'),
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;
    await api.del(`/rest/items/${item.id}`);
    toast(t('edit.dishDeleted'), 'success');
    load();
  });

  // ------------------------------------------------------------- options ---
  function optionsDialog(item) {
    const body = el('div');

    function paint(groups) {
      mount(body, [
        el('p.small.muted', t('edit.optionsIntro')),
        groups.length
          ? el('div.col.gap-16', groups.map((group) =>
              el('div.card.card-pad', [
                el('div.row.between.mb-8', [
                  el('div', [
                    el('strong', group.name),
                    el('div.tiny.muted',
                      group.min_select > 0
                        ? t('menu.requiredChoose', { range: `${group.min_select}–${group.max_select}` })
                        : t('menu.optionalUpTo', { n: group.max_select })),
                  ]),
                  el('button.btn.btn-sm.btn-ghost', {
                    onclick: guard(async () => {
                      const ok = await confirmDialog({
                        title: t('edit.deleteGroupTitle', { name: group.name }),
                        message: t('edit.deleteGroupBody'),
                        confirmLabel: t('common.delete'),
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
                          : t('common.free')),
                        el('button.btn.btn-sm.btn-ghost', {
                          onclick: guard(async () => { await api.del(`/rest/options/${option.id}`); refresh(); }),
                        }, '✕'),
                      ])
                    ))
                  : el('div.tiny.faint.mb-8', t('edit.noChoicesYet')),

                el('form.row.gap-8', {
                  onsubmit: guard(async (event) => {
                    event.preventDefault();
                    const nameInput = event.target.querySelector('.opt-name');
                    const nameArInput = event.target.querySelector('.opt-name-ar');
                    const priceInput = event.target.querySelector('.opt-price');
                    if (!nameInput.value.trim()) return;
                    await api.post(`/rest/option-groups/${group.id}/options`, {
                      name: nameInput.value.trim(),
                      name_ar: nameArInput.value.trim(),
                      price_delta: Number(priceInput.value || 0),
                    });
                    refresh();
                  }),
                }, [
                  el('input.opt-name', { type: 'text', placeholder: t('edit.choiceName'), maxlength: 80, required: true }),
                  el('input.opt-name-ar', {
                    type: 'text', placeholder: t('edit.arabicName'), maxlength: 80, dir: 'rtl', lang: 'ar',
                  }),
                  el('input.opt-price', { type: 'number', step: '0.01', placeholder: '+0.00', style: { maxWidth: '110px' } }),
                  el('button.btn.btn-sm', { type: 'submit' }, t('common.add')),
                ]),
              ])
            ))
          : el('div.empty', t('edit.noOptionGroups')),

        el('div.card.card-pad.mt-16', [
          el('h3', t('edit.newOptionGroup')),
          el('form', {
            onsubmit: guard(async (event) => {
              event.preventDefault();
              const min = Number($('#group-min').value || 0);
              const max = Number($('#group-max').value || 1);
              if (min > max) return toast(t('edit.minChoices'), 'error');
              await api.post(`/rest/items/${item.id}/option-groups`, {
                name: $('#group-name').value.trim(),
                name_ar: $('#group-name-ar').value.trim(),
                min_select: min,
                max_select: max,
              });
              $('#group-name').value = '';
              return refresh();
            }),
          }, [
            el('div.form-grid', [
              el('div.field.full', [
                el('label', { for: 'group-name' }, t('edit.groupName')),
                el('input', { id: 'group-name', type: 'text', required: true, maxlength: 80, placeholder: t('edit.groupNamePlaceholder') }),
              ]),
              el('div.field.full', [
                el('label', { for: 'group-name-ar' }, t('edit.arabicName')),
                el('input', { id: 'group-name-ar', type: 'text', maxlength: 80, dir: 'rtl', lang: 'ar' }),
              ]),
              el('div.field', [
                el('label', { for: 'group-min' }, t('edit.minChoices')),
                el('input', { id: 'group-min', type: 'number', min: 0, max: 20, value: 0 }),
              ]),
              el('div.field', [
                el('label', { for: 'group-max' }, t('edit.maxChoices')),
                el('input', { id: 'group-max', type: 'number', min: 1, max: 20, value: 1 }),
              ]),
            ]),
            el('button.btn.btn-primary.btn-sm', { type: 'submit' }, t('edit.addGroup')),
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
      title: t('edit.optionsFor', { name: item.name }),
      body,
      actions: (handle) => [el('button.btn.btn-primary', { onclick: handle.close }, t('common.done'))],
    });
    paint(item.option_groups);
  }

  load();
})();
