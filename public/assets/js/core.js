/* Shared browser helpers: DOM building, API access, auth, formatting, toasts. */
/* eslint-env browser */
(function () {
  'use strict';

  // ---------------------------------------------------------------- DOM ---
  /**
   * el('div.card', { onclick }, [children]) — terse element builder.
   * Any string child is inserted as text, so nothing here can inject markup.
   */
  function el(spec, props, children) {
    const [tagAndId, ...classes] = String(spec).split('.');
    const [tag, id] = tagAndId.split('#');
    const node = document.createElement(tag || 'div');
    if (id) node.id = id;
    if (classes.length) node.className = classes.join(' ');

    if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
      children = props;
      props = null;
    }

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className += (node.className ? ' ' : '') + value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'html') node.innerHTML = value; // only ever called with our own markup
        else if (key.startsWith('on') && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key in node && key !== 'list' && typeof value !== 'object') {
          node[key] = value;
        } else {
          node.setAttribute(key, value);
        }
      }
    }

    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    if (Array.isArray(children)) {
      children.forEach((child) => appendChildren(node, child));
      return;
    }
    node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };
  const mount = (node, ...children) => { clear(node); appendChildren(node, children); return node; };

  // --------------------------------------------------------------- auth ---
  const TOKEN_KEY = 'menu.token';
  const USER_KEY = 'menu.user';

  const auth = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
    },
    save(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clear() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem('menu.viewRestaurant');
    },
    logout() {
      this.clear();
      location.href = '/login';
    },
    /** Redirect to the login page unless the signed-in user holds one of `roles`. */
    require(roles) {
      const user = this.user;
      if (!this.token || !user) {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return null;
      }
      if (roles && roles.length && !roles.includes(user.role)) {
        // Never bounce a user back to the page they were just refused —
        // a stale `home` would otherwise become a redirect loop.
        const home = user.home || '/login';
        const current = location.pathname.replace(/index\.html$/, '');
        location.href = home.replace(/index\.html$/, '') === current ? '/login' : home;
        return null;
      }
      return user;
    },
  };

  /**
   * When a platform admin opens a tenant's dashboard we pin the tenant id in
   * sessionStorage and send it on every /api/rest call.
   */
  const viewRestaurant = {
    get() {
      const raw = sessionStorage.getItem('menu.viewRestaurant');
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    set(restaurant) { sessionStorage.setItem('menu.viewRestaurant', JSON.stringify(restaurant)); },
    clear() { sessionStorage.removeItem('menu.viewRestaurant'); },
  };

  // ---------------------------------------------------------------- api ---
  class ApiError extends Error {
    constructor(message, status, body) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  async function request(method, path, body, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth.token && !opts.anonymous) headers.Authorization = `Bearer ${auth.token}`;

    const viewing = viewRestaurant.get();
    if (viewing && path.startsWith('/rest/')) headers['X-Restaurant-Id'] = viewing.id;

    let response;
    try {
      response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection.', 0, null);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text }; }

    if (!response.ok) {
      // An expired or revoked token should bounce the user to the sign-in page.
      if (response.status === 401 && auth.token && !opts.anonymous) {
        auth.clear();
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
      }
      throw new ApiError((payload && payload.error) || `Request failed (${response.status})`, response.status, payload);
    }
    return payload;
  }

  const api = {
    get: (path, options) => request('GET', path, undefined, options),
    post: (path, body, options) => request('POST', path, body || {}, options),
    patch: (path, body, options) => request('PATCH', path, body || {}, options),
    del: (path, body, options) => request('DELETE', path, body || {}, options),
    ApiError,
  };

  // ------------------------------------------------------------ formatting ---
  /** The active locale, or the browser default before i18n has loaded. */
  const locale = () => (window.I18n ? window.I18n.locale : undefined);

  function money(amount, currency) {
    const value = Number(amount || 0);
    try {
      return new Intl.NumberFormat(locale(), {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${currency || ''} ${value.toFixed(2)}`.trim();
    }
  }

  /** SQLite stores naive UTC strings; normalise them before display. */
  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const date = new Date(normalised);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatTime(value) {
    const date = parseDate(value);
    return date ? date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '—';
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date
      ? date.toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—';
  }

  function formatDate(value) {
    const date = parseDate(value);
    return date ? date.toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) : '—';
  }

  function timeAgo(value) {
    const date = parseDate(value);
    if (!date) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

    // Intl.RelativeTimeFormat gives idiomatic phrasing in both languages,
    // including Arabic's dual and plural forms.
    let rtf = null;
    try {
      rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    } catch {
      rtf = null;
    }
    if (!rtf) return `${Math.floor(seconds / 60)}m`;

    if (seconds < 60) return rtf.format(0, 'minute');
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return rtf.format(-minutes, 'minute');
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return rtf.format(-hours, 'hour');
    return rtf.format(-Math.floor(hours / 24), 'day');
  }

  /** Whole minutes since a timestamp — drives the kitchen ageing colours. */
  function minutesSince(value) {
    const date = parseDate(value);
    if (!date) return 0;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  }

  const ORDER_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'];

  const statusLabel = (status) =>
    (window.I18n && ORDER_STATUSES.includes(status) ? window.I18n.t(`status.${status}`) : status);
  const statusBadge = (status) =>
    el('span.badge', { class: `status-${status}` }, [el('span.dot'), statusLabel(status)]);

  // -------------------------------------------------------------- toasts ---
  function toast(message, kind) {
    let host = $('.toasts');
    if (!host) {
      host = el('div.toasts', { role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(host);
    }
    const node = el('div.toast', { class: kind || '' }, message);
    host.appendChild(node);
    setTimeout(() => {
      node.style.transition = 'opacity .25s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 260);
    }, kind === 'error' ? 4200 : 2600);
  }

  // --------------------------------------------------------------- modal ---
  /**
   * modal({ title, body, actions, wide }) → { close }
   * `body` and `actions` receive the modal handle so buttons can close it.
   */
  function modal(options) {
    const handle = {};
    const backdrop = el('div.modal-backdrop', {
      onclick: (event) => { if (event.target === backdrop) handle.close(); },
    });

    const dialog = el('div.modal', { class: options.wide ? 'modal-wide' : '', role: 'dialog', 'aria-modal': 'true' });

    handle.close = () => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      document.body.style.overflow = '';
    };
    const onKey = (event) => { if (event.key === 'Escape') handle.close(); };

    if (options.title !== false) {
      dialog.appendChild(
        el('div.modal-head', [
          el('h2', options.title || ''),
          el('button.btn.btn-ghost.btn-icon', { onclick: handle.close, 'aria-label': 'Close' }, '✕'),
        ])
      );
    }

    const body = el('div.modal-body');
    appendChildren(body, typeof options.body === 'function' ? options.body(handle) : options.body);
    dialog.appendChild(body);
    handle.body = body;

    if (options.actions) {
      dialog.appendChild(
        el('div.modal-foot', typeof options.actions === 'function' ? options.actions(handle) : options.actions)
      );
    }

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);

    const firstField = dialog.querySelector('input, select, textarea');
    if (firstField) setTimeout(() => firstField.focus(), 40);
    return handle;
  }

  function confirmDialog(options) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value, handle) => { settled = true; handle.close(); resolve(value); };
      const handle = modal({
        title: options.title || 'Are you sure?',
        body: el('p', options.message || ''),
        actions: (h) => [
          el('button.btn', { onclick: () => finish(false, h) }, options.cancelLabel || 'Cancel'),
          el('button.btn', {
            class: options.danger === false ? 'btn-primary' : 'btn-danger',
            onclick: () => finish(true, h),
          }, options.confirmLabel || 'Confirm'),
        ],
      });
      const observer = new MutationObserver(() => {
        if (!document.body.contains(handle.body) && !settled) { observer.disconnect(); resolve(false); }
      });
      observer.observe(document.body, { childList: true });
    });
  }

  /** Run an async action while showing a spinner on the triggering button. */
  async function withBusy(button, fn) {
    if (!button) return fn();
    const original = button.innerHTML;
    button.classList.add('is-loading');
    button.disabled = true;
    try {
      return await fn();
    } finally {
      button.classList.remove('is-loading');
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  /** Wrap a handler so API errors surface as a toast instead of a silent failure. */
  function guard(fn) {
    return async function guarded(...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        const fallback = window.I18n ? window.I18n.t('common.somethingWrong') : 'Something went wrong';
        toast(error && error.message ? error.message : fallback, 'error');
        return undefined;
      }
    };
  }

  // ----------------------------------------------------------------- sse ---
  /**
   * Subscribe to a Server-Sent Events endpoint with automatic reconnection.
   * `handlers` maps event names to callbacks. Returns a close function.
   */
  function stream(path, handlers) {
    let source = null;
    let closed = false;
    let retry = 1000;
    const startedAuthenticated = Boolean(auth.token);

    const connect = () => {
      if (closed) return;
      // The tab signed out while this stream was open. Reconnecting would just
      // loop on 401s, so retire the stream instead.
      if (startedAuthenticated && !auth.token) {
        closed = true;
        return;
      }

      // EventSource cannot set headers, so auth and tenant scope ride along
      // in the query string instead.
      const query = new URLSearchParams();
      if (auth.token) query.set('token', auth.token);
      const viewing = viewRestaurant.get();
      if (viewing && path.startsWith('/rest/')) query.set('restaurant_id', viewing.id);

      const separator = path.includes('?') ? '&' : '?';
      const search = query.toString();
      source = new EventSource(`/api${path}${search ? separator + search : ''}`);

      source.addEventListener('ready', () => { retry = 1000; });
      for (const [name, handler] of Object.entries(handlers)) {
        source.addEventListener(name, (event) => {
          try {
            handler(JSON.parse(event.data));
          } catch {
            /* ignore malformed frames */
          }
        });
      }
      source.onerror = () => {
        source.close();
        if (closed) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 20000);
      };
    };

    connect();
    return () => { closed = true; if (source) source.close(); };
  }

  // ------------------------------------------------------------- storage ---
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota — non fatal */ }
    },
    remove(key) { localStorage.removeItem(key); },
  };

  /** Stable anonymous id so a guest can see their own past orders. */
  function sessionId() {
    let id = store.get('menu.session', null);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 40);
      store.set('menu.session', id);
    }
    return id;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(window.I18n ? window.I18n.t('common.copied') : 'Copied to clipboard', 'success');
    } catch {
      toast('Could not copy — select the text manually', 'error');
    }
  }

  const params = () => new URLSearchParams(location.search);
  const debounce = (fn, wait) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait || 250); };
  };

  window.App = {
    el, $, $$, clear, mount, appendChildren,
    api, auth, viewRestaurant,
    money, formatTime, formatDate, formatDateTime, timeAgo, minutesSince, parseDate,
    statusLabel, statusBadge, ORDER_STATUSES,
    toast, modal, confirmDialog, withBusy, guard,
    stream, store, sessionId, copyText, params, debounce,
  };
})();
