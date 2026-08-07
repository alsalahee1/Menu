/* Small SVG chart set: area-line, column, ranked bar and a segmented bar.
 *
 * Design rules applied throughout:
 *   - one y-axis only, never a second scale
 *   - thin marks: 2px lines, 8px markers, 4px rounded ends anchored to the baseline
 *   - a 2px surface gap between adjacent fills
 *   - recessive grid and axis text; labels wear text tokens, never the series colour
 *   - every chart ships a hover layer; multi-series charts ship a legend
 */
/* eslint-env browser */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const { el } = window.App;

  function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined) continue;
      node.setAttribute(key, String(value));
    }
    return node;
  }

  /** Round up to a 1/2/5 × 10ⁿ step. */
  function niceStep(value) {
    if (value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalised = value / magnitude;
    const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
    return step * magnitude;
  }

  /**
   * Choose an axis maximum and a gridline count together.
   *
   * Nicing the step (rather than the maximum) keeps every label on a readable
   * number; trying several division counts then picks the one that wastes the
   * least headroom, so the data still fills the plot.
   *
   * @returns {{max: number, divisions: number, step: number}}
   */
  function niceScale(value, preferred = [4, 5, 3]) {
    if (value <= 0) return { max: 4, divisions: 4, step: 1 };

    let best = null;
    for (const divisions of preferred) {
      const step = niceStep(value / divisions);
      const max = step * divisions;
      if (!best || max / value < best.max / value) best = { max, divisions, step };
    }
    return best;
  }

  /**
   * Wrap a render function so the chart redraws at the container's true pixel
   * width — text then renders at its real size instead of being scaled by a
   * viewBox.
   */
  function responsive(host, draw) {
    let frame = null;
    let current = null;

    const paint = () => {
      const width = host.clientWidth;
      if (width < 40) return;
      const next = draw(width);
      // Swap only the SVG. Clearing the host would also remove the tooltip
      // node, which lives alongside it for the lifetime of the chart.
      if (current) host.replaceChild(next, current);
      else host.insertBefore(next, host.firstChild);
      current = next;
    };

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(paint);
      });
      observer.observe(host);
    } else {
      window.addEventListener('resize', () => { if (frame) cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); });
    }
    paint();
    return host;
  }

  function tooltip(host) {
    const tip = el('div.chart-tip');
    host.appendChild(tip);
    return {
      show(x, y, lines) {
        window.App.mount(tip, lines.map((line, index) =>
          el('div', { style: index === 0 ? { fontWeight: '650' } : null }, line)));
        tip.style.left = `${x}px`;
        tip.style.top = `${y - 8}px`;
        tip.classList.add('show');
      },
      hide() { tip.classList.remove('show'); },
    };
  }

  /**
   * Time series as a 2px line over a soft area fill, with a crosshair tooltip.
   * Single series, so the card title names it and no legend box is needed.
   */
  function areaLine(options) {
    const host = el('div.chart');
    const points = options.data || [];
    const format = options.format || ((n) => String(n));
    const height = options.height || 200;

    if (points.length < 2) {
      return el('div.empty', window.I18n.t('rep.notEnoughTrend'));
    }

    const tip = tooltip(host);

    responsive(host, (width) => {
      const pad = { top: 12, right: 8, bottom: 26, left: 52 };
      const plotW = Math.max(10, width - pad.left - pad.right);
      const plotH = height - pad.top - pad.bottom;
      const scale = niceScale(Math.max(...points.map((p) => p.value)));
      const max = scale.max;

      const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': options.ariaLabel || 'Trend chart' });
      const xAt = (i) => pad.left + (i / (points.length - 1)) * plotW;
      const yAt = (v) => pad.top + plotH - (v / max) * plotH;

      // Gridlines and the single y-axis.
      for (let i = 0; i <= scale.divisions; i += 1) {
        const value = scale.step * i;
        const y = yAt(value);
        svg.appendChild(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
        const label = svgEl('text', { class: 'axis-label', x: pad.left - 8, y: y + 4, 'text-anchor': 'end' });
        label.textContent = format(value);
        svg.appendChild(label);
      }

      const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(p.value)}`).join(' ');
      svg.appendChild(svgEl('path', {
        d: `${linePath} L${xAt(points.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`,
        fill: options.color || 'var(--series-2)',
        opacity: 0.12,
      }));
      svg.appendChild(svgEl('path', {
        d: linePath, fill: 'none',
        stroke: options.color || 'var(--series-2)',
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));

      // X labels thinned so they never collide.
      const stride = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 62))));
      points.forEach((point, i) => {
        if (i % stride !== 0 && i !== points.length - 1) return;
        const label = svgEl('text', { class: 'axis-label', x: xAt(i), y: height - 8, 'text-anchor': 'middle' });
        label.textContent = point.label;
        svg.appendChild(label);
      });

      const crosshair = svgEl('line', {
        class: 'grid-line', y1: pad.top, y2: pad.top + plotH,
        stroke: 'var(--axis-text)', 'stroke-dasharray': '3 3', opacity: 0,
      });
      const marker = svgEl('circle', {
        r: 4.5, fill: options.color || 'var(--series-2)',
        stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0,
      });
      svg.append(crosshair, marker);

      // One transparent band per point keeps the hit target far larger than the mark.
      points.forEach((point, i) => {
        const bandW = plotW / points.length;
        const hit = svgEl('rect', {
          class: 'hit', x: xAt(i) - bandW / 2, y: pad.top, width: bandW, height: plotH,
        });
        hit.addEventListener('mouseenter', () => {
          crosshair.setAttribute('x1', xAt(i));
          crosshair.setAttribute('x2', xAt(i));
          crosshair.setAttribute('opacity', 1);
          marker.setAttribute('cx', xAt(i));
          marker.setAttribute('cy', yAt(point.value));
          marker.setAttribute('opacity', 1);
          tip.show(xAt(i), yAt(point.value), [point.title || point.label, ...(point.detail || [format(point.value)])]);
        });
        hit.addEventListener('mouseleave', () => {
          crosshair.setAttribute('opacity', 0);
          marker.setAttribute('opacity', 0);
          tip.hide();
        });
        svg.appendChild(hit);
      });

      return svg;
    });

    return host;
  }

  /** Vertical columns for a categorical count, e.g. orders per hour. */
  function columns(options) {
    const host = el('div.chart');
    const points = options.data || [];
    const format = options.format || ((n) => String(n));
    const height = options.height || 190;

    if (!points.length) return el('div.empty', window.I18n.t('rep.noData'));

    const tip = tooltip(host);

    responsive(host, (width) => {
      const pad = { top: 12, right: 6, bottom: 24, left: 38 };
      const plotW = Math.max(10, width - pad.left - pad.right);
      const plotH = height - pad.top - pad.bottom;
      const scale = niceScale(Math.max(...points.map((p) => p.value), 1), [2, 3]);
      const max = scale.max;

      const svg = svgEl('svg', { width, height, role: 'img', 'aria-label': options.ariaLabel || 'Column chart' });
      const slot = plotW / points.length;
      // 2px of surface between neighbouring fills.
      const barW = Math.max(3, slot - 2);
      const yAt = (v) => pad.top + plotH - (v / max) * plotH;

      for (let i = 0; i <= scale.divisions; i += 1) {
        const value = scale.step * i;
        const y = yAt(value);
        svg.appendChild(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
        const label = svgEl('text', { class: 'axis-label', x: pad.left - 8, y: y + 4, 'text-anchor': 'end' });
        label.textContent = format(value);
        svg.appendChild(label);
      }

      points.forEach((point, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        const y = yAt(point.value);
        const barH = Math.max(point.value > 0 ? 2 : 0, pad.top + plotH - y);

        const bar = svgEl('rect', {
          class: 'mark', x, y: pad.top + plotH - barH, width: barW, height: barH,
          // Rounded data-end only; the baseline end stays square.
          rx: Math.min(4, barW / 2),
          fill: options.color || 'var(--series-2)',
        });
        svg.appendChild(bar);

        const hit = svgEl('rect', { class: 'hit', x: pad.left + i * slot, y: pad.top, width: slot, height: plotH });
        hit.addEventListener('mouseenter', () => {
          bar.classList.add('is-hover');
          tip.show(x + barW / 2, y, [point.title || point.label, ...(point.detail || [format(point.value)])]);
        });
        hit.addEventListener('mouseleave', () => { bar.classList.remove('is-hover'); tip.hide(); });
        svg.appendChild(hit);

        if (points.length <= 14 || i % 3 === 0) {
          const label = svgEl('text', { class: 'axis-label', x: x + barW / 2, y: height - 8, 'text-anchor': 'middle' });
          label.textContent = point.label;
          svg.appendChild(label);
        }
      });

      return svg;
    });

    return host;
  }

  /**
   * Ranked horizontal bars with the name and value written directly beside each
   * bar — no legend needed and no reliance on colour to identify a row.
   */
  function rankedBars(options) {
    const points = (options.data || []).slice(0, options.limit || 10);
    if (!points.length) return el('div.empty', window.I18n.t('rep.noData'));

    const format = options.format || ((n) => String(n));
    const max = Math.max(...points.map((p) => p.value), 1);

    return el('div.col.gap-8', points.map((point) =>
      el('div', { title: `${point.label}: ${format(point.value)}` }, [
        el('div.row.between.gap-8', { style: { marginBottom: '3px' } }, [
          el('span.small.truncate', point.label),
          el('span.small.strong.nowrap', point.detail || format(point.value)),
        ]),
        el('div', { style: { height: '8px', background: 'var(--surface-3)', borderRadius: '4px', overflow: 'hidden' } },
          el('div', {
            style: {
              width: `${Math.max(2, (point.value / max) * 100)}%`,
              height: '100%',
              background: options.color || 'var(--series-2)',
              borderRadius: '4px',
            },
          })),
      ])
    ));
  }

  /**
   * Segmented bar for a small part-to-whole split (≤ 3 slots).
   * Ships a legend plus direct labels, so identity never rests on colour alone.
   */
  function segmentedBar(options) {
    const points = (options.data || []).filter((p) => p.value > 0);
    if (!points.length) return el('div.empty', window.I18n.t('rep.noData'));

    const format = options.format || ((n) => String(n));
    const total = points.reduce((sum, p) => sum + p.value, 0);
    const colors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

    return el('div', [
      el('div.row', {
        style: { height: '26px', borderRadius: '6px', overflow: 'hidden', gap: '2px', background: 'var(--surface-3)' },
      }, points.map((point, index) =>
        el('div', {
          title: `${point.label}: ${format(point.value)}`,
          style: {
            width: `${(point.value / total) * 100}%`,
            background: colors[index % colors.length],
            height: '100%',
          },
        })
      )),
      el('div.chart-legend', points.map((point, index) =>
        el('span.key', [
          el('span.swatch', { style: { background: colors[index % colors.length] } }),
          el('span', `${point.label} · ${format(point.value)} (${Math.round((point.value / total) * 100)}%)`),
        ])
      )),
    ]);
  }

  window.Charts = { areaLine, columns, rankedBars, segmentedBar };
})();
