'use strict';

const { db } = require('../db');

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Load the menu tree (categories → items → option groups → options).
 *
 * `publicOnly` hides inactive categories, unavailable options and items the
 * guest should never see, so the same function serves both the guest menu and
 * the manager's editor.
 */
function getMenu(restaurantId, { publicOnly = false } = {}) {
  const categories = db
    .prepare(
      `SELECT id, name, name_ar, description, description_ar, icon, sort_order, is_active
         FROM categories
        WHERE restaurant_id = ? ${publicOnly ? 'AND is_active = 1' : ''}
        ORDER BY sort_order ASC, name ASC`
    )
    .all(restaurantId);

  const items = db
    .prepare(
      `SELECT id, category_id, name, name_ar, description, description_ar, price, image_url,
              is_available, is_featured, prep_minutes, calories, tags, sort_order
         FROM menu_items
        WHERE restaurant_id = ?
        ORDER BY sort_order ASC, name ASC`
    )
    .all(restaurantId);

  const itemIds = items.map((i) => i.id);
  let groups = [];
  let options = [];

  if (itemIds.length) {
    const placeholders = itemIds.map(() => '?').join(',');
    groups = db
      .prepare(
        `SELECT id, item_id, name, name_ar, min_select, max_select, sort_order
           FROM option_groups
          WHERE item_id IN (${placeholders})
          ORDER BY sort_order ASC, id ASC`
      )
      .all(...itemIds);

    const groupIds = groups.map((g) => g.id);
    if (groupIds.length) {
      const gp = groupIds.map(() => '?').join(',');
      options = db
        .prepare(
          `SELECT id, group_id, name, name_ar, price_delta, is_available, sort_order
             FROM options
            WHERE group_id IN (${gp}) ${publicOnly ? 'AND is_available = 1' : ''}
            ORDER BY sort_order ASC, id ASC`
        )
        .all(...groupIds);
    }
  }

  const optionsByGroup = new Map();
  for (const opt of options) {
    if (!optionsByGroup.has(opt.group_id)) optionsByGroup.set(opt.group_id, []);
    optionsByGroup.get(opt.group_id).push({
      id: opt.id,
      name: opt.name,
      name_ar: opt.name_ar,
      price_delta: opt.price_delta,
      is_available: !!opt.is_available,
    });
  }

  const groupsByItem = new Map();
  for (const group of groups) {
    if (!groupsByItem.has(group.item_id)) groupsByItem.set(group.item_id, []);
    groupsByItem.get(group.item_id).push({
      id: group.id,
      name: group.name,
      name_ar: group.name_ar,
      min_select: group.min_select,
      max_select: group.max_select,
      options: optionsByGroup.get(group.id) || [],
    });
  }

  const shapedItems = items.map((item) => ({
    id: item.id,
    category_id: item.category_id,
    name: item.name,
    name_ar: item.name_ar,
    description: item.description,
    description_ar: item.description_ar,
    price: item.price,
    image_url: item.image_url,
    is_available: !!item.is_available,
    is_featured: !!item.is_featured,
    prep_minutes: item.prep_minutes,
    calories: item.calories,
    tags: parseTags(item.tags),
    sort_order: item.sort_order,
    option_groups: groupsByItem.get(item.id) || [],
  }));

  return {
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      name_ar: c.name_ar,
      description: c.description,
      description_ar: c.description_ar,
      icon: c.icon,
      sort_order: c.sort_order,
      is_active: !!c.is_active,
      items: shapedItems.filter((i) => i.category_id === c.id),
    })),
    // Items whose category was deleted still need a home in the editor.
    uncategorized: shapedItems.filter((i) => !i.category_id),
  };
}

module.exports = { getMenu, parseTags };
