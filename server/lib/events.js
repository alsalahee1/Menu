'use strict';

/**
 * Tiny in-process pub/sub used to push live updates over Server-Sent Events.
 *
 * Channels:
 *   restaurant:<id>  → staff dashboards / kitchen display
 *   order:<code>     → the guest tracking a single order
 *
 * This is deliberately in-memory: a single Node process serves the whole app.
 * Swapping in Redis pub/sub later only requires changing this file.
 */
const channels = new Map();

function subscribe(channel, listener) {
  if (!channels.has(channel)) channels.set(channel, new Set());
  channels.get(channel).add(listener);

  return function unsubscribe() {
    const set = channels.get(channel);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) channels.delete(channel);
  };
}

function publish(channel, event, data) {
  const set = channels.get(channel);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event, data);
    } catch {
      // A broken client must never take down the publisher.
    }
  }
}

/**
 * Wire an Express response up as an SSE stream on the given channels.
 * Returns nothing — the response stays open until the client disconnects.
 */
function sseHandler(req, res, channelNames) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('ready', { channels: channelNames });

  const unsubscribers = channelNames.map((name) => subscribe(name, send));
  // Comment frames keep proxies from closing an idle connection.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribers.forEach((fn) => fn());
    res.end();
  });
}

const restaurantChannel = (id) => `restaurant:${id}`;
const orderChannel = (code) => `order:${code}`;

module.exports = { subscribe, publish, sseHandler, restaurantChannel, orderChannel };
