/* Landing page: demo restaurant directory, hero QR code and the lead form. */
/* eslint-env browser */
(function () {
  'use strict';

  const { el, api, mount, toast, guard, $ } = window.App;

  async function loadRestaurants() {
    const host = $('#restaurant-list');
    try {
      const { restaurants } = await api.get('/public/restaurants', { anonymous: true });

      if (!restaurants.length) {
        mount(host, el('div.empty', 'No demo restaurants yet. Run "npm run seed" to create them.'));
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
                el('h3', { style: { marginBottom: '2px' } }, restaurant.name),
                el('div.small.muted', restaurant.cuisine || 'Restaurant'),
              ]),
              restaurant.avg_rating
                ? el('span.badge.badge-warn', `★ ${restaurant.avg_rating}`)
                : null,
            ]),
            el('p.small.muted.mt-8', { style: { minHeight: '2.6em' } }, restaurant.description || ''),
            el('div.row.gap-8.small.faint.mb-16', [
              el('span', `${restaurant.item_count} dishes`),
              el('span', '·'),
              el('span', restaurant.currency),
            ]),
            el('div.row.gap-8', [
              el('a.btn.btn-primary.btn-sm.grow', { href: tableLink }, 'Open a table'),
              el('a.btn.btn-sm', { href: `/r/${restaurant.slug}` }, 'Menu'),
            ]),
          ]);
        })
      );

      // Point the hero at the first restaurant's first table.
      const first = restaurants.find((r) => r.sample_table);
      if (first) {
        const link = $('#hero-link');
        link.href = `/t/${first.slug}/${first.sample_table}`;
        link.textContent = `Open ${first.name} · Table 1`;

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
      toast('Thanks — we will be in touch shortly.', 'success');
    })
  );

  loadRestaurants();
})();
