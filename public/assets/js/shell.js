/* Sidebar + topbar shell shared by the restaurant dashboard and admin console. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, api, auth, viewRestaurant, toast, modal, guard, $ } = window.App;

  const RESTAURANT_NAV = [
    { section: 'Service' },
    { href: '/dashboard/', icon: '📊', label: 'Overview', roles: ['owner', 'manager'] },
    { href: '/dashboard/orders.html', icon: '🧾', label: 'Live orders' },
    { href: '/dashboard/kitchen.html', icon: '👨‍🍳', label: 'Kitchen display' },
    { href: '/dashboard/requests.html', icon: '🔔', label: 'Guest requests', badge: 'requests' },
    { href: '/dashboard/tables.html', icon: '🪑', label: 'Tables & QR codes' },
    { section: 'Manage', roles: ['owner', 'manager'] },
    { href: '/dashboard/menu.html', icon: '🍽️', label: 'Menu', roles: ['owner', 'manager'] },
    { href: '/dashboard/reports.html', icon: '📈', label: 'Reports', roles: ['owner', 'manager'] },
    { href: '/dashboard/staff.html', icon: '👥', label: 'Staff', roles: ['owner', 'manager'] },
    { href: '/dashboard/settings.html', icon: '⚙️', label: 'Settings', roles: ['owner', 'manager'] },
  ];

  const ADMIN_NAV = [
    { section: 'Platform' },
    { href: '/admin/', icon: '📊', label: 'Overview' },
    { href: '/admin/restaurants.html', icon: '🏪', label: 'Restaurants' },
    { href: '/admin/users.html', icon: '👥', label: 'Users' },
    { href: '/admin/orders.html', icon: '🧾', label: 'All orders' },
    { href: '/admin/audit.html', icon: '🛡️', label: 'Audit log' },
  ];

  function isCurrent(href) {
    const path = location.pathname.replace(/index\.html$/, '');
    return href.replace(/index\.html$/, '') === path;
  }

  /**
   * Build the application chrome.
   *
   * @param {object} options
   *   kind    'restaurant' | 'admin'
   *   title   page heading
   *   roles   roles permitted on this page
   *   actions optional nodes rendered on the right of the topbar
   * @returns {{ user, page: HTMLElement, setActions(nodes) }} or null when redirected
   */
  function boot(options) {
    const user = auth.require(options.roles);
    if (!user) return null;

    const nav = options.kind === 'admin' ? ADMIN_NAV : RESTAURANT_NAV;
    const viewing = viewRestaurant.get();

    const contextName = options.kind === 'admin'
      ? 'Platform console'
      : (viewing && viewing.name) || (user.restaurant && user.restaurant.name) || 'Restaurant';

    // ---- sidebar --------------------------------------------------------
    const navList = el('nav.sidebar-nav');
    for (const entry of nav) {
      if (entry.roles && !entry.roles.includes(user.role) && user.role !== 'super_admin') continue;
      if (entry.section) {
        navList.appendChild(el('div.sidebar-section', entry.section));
        continue;
      }
      const link = el('a', { href: entry.href, class: isCurrent(entry.href) ? 'active' : '' }, [
        el('span.nav-icon', entry.icon),
        el('span.grow', entry.label),
      ]);
      if (entry.badge) link.dataset.badge = entry.badge;
      navList.appendChild(link);
    }

    const sidebar = el('aside.sidebar', [
      el('a.sidebar-brand', { href: options.kind === 'admin' ? '/admin/' : '/dashboard/' }, [
        el('span.logo-mark', '🍽'),
        el('span.grow.truncate', contextName),
      ]),
      navList,
      el('div.sidebar-foot', [
        el('div.row.gap-8', [
          el('div.grow', { style: { minWidth: 0 } }, [
            el('div.small.strong.truncate', user.name),
            el('div.tiny.faint', user.role.replace('_', ' ')),
          ]),
          el('button.btn.btn-ghost.btn-sm', { onclick: () => auth.logout(), title: 'Sign out' }, 'Sign out'),
        ]),
        el('div.mt-8', [
          el('a.btn.btn-sm.btn-block', { href: '/', target: '_blank' }, 'View guest site ↗'),
        ]),
      ]),
    ]);

    // ---- topbar ---------------------------------------------------------
    const actionSlot = el('div.row.gap-8');
    const toggle = el('button.btn.btn-ghost.btn-icon.menu-toggle', { 'aria-label': 'Open navigation' }, '☰');

    let scrim = null;
    toggle.addEventListener('click', () => {
      sidebar.classList.add('open');
      scrim = el('div.scrim', { onclick: () => { sidebar.classList.remove('open'); scrim.remove(); } });
      document.body.appendChild(scrim);
    });

    const topbar = el('header.topbar', [
      toggle,
      el('h1.grow.truncate', options.title || ''),
      actionSlot,
    ]);

    // A super_admin browsing a tenant gets a persistent reminder + exit route.
    let banner = null;
    if (viewing && options.kind !== 'admin' && user.role === 'super_admin') {
      banner = el('div', {
        style: {
          background: 'var(--warn-soft)', color: 'var(--warn)', padding: '8px 20px',
          fontSize: '.84rem', fontWeight: '600', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        },
      }, [
        el('span', `Platform admin view — you are managing "${viewing.name}"`),
        el('button.btn.btn-sm', {
          onclick: () => { viewRestaurant.clear(); location.href = '/admin/restaurants.html'; },
        }, 'Exit'),
      ]);
    }

    const page = el('main.page');
    const main = el('div.main', [topbar, banner, page].filter(Boolean));
    document.body.appendChild(el('div.app', [sidebar, main]));

    if (options.kind !== 'admin') refreshRequestBadge(navList);

    return {
      user,
      page,
      sidebar,
      setActions(nodes) { window.App.mount(actionSlot, nodes); },
    };
  }

  /** Show a live count of unresolved guest requests next to the nav entry. */
  async function refreshRequestBadge(navList) {
    const link = navList.querySelector('a[data-badge="requests"]');
    if (!link) return;

    const paint = (count) => {
      const existing = link.querySelector('.nav-count');
      if (existing) existing.remove();
      if (count > 0) link.appendChild(el('span.nav-count', String(count)));
    };

    try {
      const data = await api.get('/rest/service-requests');
      paint(data.requests.length);
    } catch {
      return; // A failed badge fetch should never block the page.
    }

    window.App.stream('/rest/stream', {
      'service_request.created': () => paint((Number(link.querySelector('.nav-count')?.textContent) || 0) + 1),
      'service_request.resolved': () =>
        paint(Math.max(0, (Number(link.querySelector('.nav-count')?.textContent) || 0) - 1)),
    });
  }

  /** Reusable "change my password" dialog for the settings pages. */
  function passwordDialog() {
    modal({
      title: 'Change your password',
      body: el('form#pwd-form', [
        el('div.field', [
          el('label', { for: 'pw-current' }, 'Current password'),
          el('input', { type: 'password', id: 'pw-current', required: true, autocomplete: 'current-password' }),
        ]),
        el('div.field', [
          el('label', { for: 'pw-new' }, 'New password'),
          el('input', { type: 'password', id: 'pw-new', required: true, minlength: 8, autocomplete: 'new-password' }),
          el('div.hint', 'At least 8 characters.'),
        ]),
      ]),
      actions: (handle) => [
        el('button.btn', { onclick: handle.close }, 'Cancel'),
        el('button.btn.btn-primary', {
          onclick: guard(async () => {
            const current = $('#pw-current').value;
            const next = $('#pw-new').value;
            if (next.length < 8) return toast('New password must be at least 8 characters', 'error');
            await api.post('/auth/change-password', { current_password: current, new_password: next });
            handle.close();
            return toast('Password updated', 'success');
          }),
        }, 'Update password'),
      ],
    });
  }

  window.Shell = { boot, passwordDialog };
})();
