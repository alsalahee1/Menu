/* Landing page: demo restaurant directory, hero QR code and the lead form. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, api, mount, toast, guard, $ } = window.App;

  const t = (key, params) => window.I18n.t(key, params);

  async function loadRestaurants() {
    const host = $('#restaurant-list');
    try {
      const { restaurants } = await api.get('/public/restaurants', { anonymous: true });

      if (!restaurants.length) {
        mount(host, el('div.empty', t('landing.noDemo')));
        return;
      }

      mount(
        host,
        restaurants.map((restaurant) => {
          const tableLink = restaurant.sample_table
            ? `/t/${restaurant.slug}/${restaurant.sample_table}`
            : `/r/${restaurant.slug}`;

          return el('div.card.card-pad', [
            el('div.row.between.top', [
              el('div.grow', [
                el('h3', { style: { marginBottom: '2px' } }, window.I18n.localised(restaurant, 'name')),
                el('div.small.muted', restaurant.cuisine || t('landing.restaurant')),
              ]),
              restaurant.avg_rating
                ? el('span.badge.badge-warn', `★ ${restaurant.avg_rating}`)
                : null,
            ]),
            el('p.small.muted.mt-8', { style: { minHeight: '2.6em' } }, window.I18n.localised(restaurant, 'description')),
            el('div.row.gap-8.small.faint.mb-16', [
              el('span', `${restaurant.item_count} ${t('landing.dishes')}`),
              el('span', '·'),
              el('span', restaurant.currency),
            ]),
            el('div.row.gap-8', [
              el('a.btn.btn-primary.btn-sm.grow', { href: tableLink }, t('landing.openATable')),
              el('a.btn.btn-sm', { href: `/r/${restaurant.slug}` }, t('landing.menu')),
            ]),
          ]);
        })
      );

      // Point the hero at the first restaurant's first table.
      const first = restaurants.find((r) => r.sample_table);
      if (first) {
        const link = $('#hero-link');
        link.href = `/t/${first.slug}/${first.sample_table}`;
        link.textContent = `${t('landing.openATable')} · ${window.I18n.localised(first, 'name')}`;

        const qr = $('#hero-qr');
        qr.classList.remove('skeleton');
        mount(
          qr,
          el('img', {
            src: `/api/public/r/${first.slug}/table/${first.sample_table}/qr.svg?size=380`,
            alt: `QR code for ${first.name}, table 1`,
            width: 190,
            height: 190,
            style: { borderRadius: '10px' },
          })
        );
      }
    } catch (error) {
      mount(host, el('div.empty', error.message));
    }
  }

  $('#lead-form').addEventListener(
    'submit',
    guard(async (event) => {
      event.preventDefault();
      await api.post(
        '/public/signup-interest',
        {
          name: $('#lead-name').value,
          email: $('#lead-email').value,
          restaurant: $('#lead-restaurant').value,
        },
        { anonymous: true }
      );
      event.target.reset();
      toast(t('landing.leadThanks'), 'success');
    })
  );

  loadRestaurants();
})();
