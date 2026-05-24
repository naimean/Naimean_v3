import { test } from 'node:test';
import assert from 'node:assert/strict';
import router, { HotspotStore } from '../src/worker.js';
import { onRequest } from '../functions/api/hotspots.js';

function makeState(initialHotspots) {
  let stored = initialHotspots;
  const calls = { get: 0, put: [] };

  return {
    state: {
      storage: {
        async get(key) {
          calls.get += 1;
          if (key === 'hotspots') return stored;
          return undefined;
        },
        async put(key, value) {
          calls.put.push({ key, value });
          if (key === 'hotspots') stored = value;
        }
      }
    },
    calls,
    getStored: () => stored
  };
}

test('HotspotStore GET returns default hotspots when storage is empty', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=UTF-8');
  assert.equal(body.hotspots.length, 9);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
  assert.deepEqual(body.hotspots[1], { id: 'left-monitor', x: 1278, y: 1002, w: 386, h: 258 });
  assert.deepEqual(body.hotspots[5], { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 });
  assert.deepEqual(body.hotspots[8], { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 });
});

test('HotspotStore POST rejects invalid JSON', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json'
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body.' });
});

test('HotspotStore POST sanitizes, clamps and stores hotspot payloads', async () => {
  const { state, calls, getStored } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'big-tv', x: -100.8, y: 2200.2, w: 10, h: 99999 },
          { id: 'left-monitor', x: 1500.7, y: 1072.4, w: 292.4, h: 205.6 },
          { id: 'commodore-screen', x: 'oops', y: null, w: Infinity, h: undefined },
          { id: 'unknown-id', x: 1, y: 2, w: 3, h: 4 }
        ]
      })
    })
  );

  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.hotspots.length, 9);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
  assert.deepEqual(body.hotspots[1], { id: 'left-monitor', x: 1501, y: 1072, w: 292, h: 206 });
  assert.deepEqual(body.hotspots[2], { id: 'commodore-screen', x: 1703, y: 994, w: 372, h: 246 });
  assert.deepEqual(body.hotspots[3], { id: 'right-monitor', x: 1763, y: 1020, w: 278, h: 216 });
  assert.deepEqual(body.hotspots[8], { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 });

  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].key, 'hotspots');
  assert.deepEqual(calls.put[0].value, body.hotspots);
  assert.deepEqual(getStored(), body.hotspots);
});

test('HotspotStore returns 405 for unsupported methods', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'DELETE' }));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: 'Method not allowed.' });
});

test('HotspotStore handles OPTIONS preflight requests', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'OPTIONS' }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
});

test('worker routes /api/hotspots through HOTSPOT_STORE durable object', async () => {
  const calls = { idFromName: [], get: [], stubFetch: 0, assetsFetch: 0 };
  const expectedResponse = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const env = {
    HOTSPOT_STORE: {
      idFromName(name) {
        calls.idFromName.push(name);
        return `id:${name}`;
      },
      get(id) {
        calls.get.push(id);
        return {
          async fetch(request) {
            calls.stubFetch += 1;
            assert.equal(new URL(request.url).pathname, '/api/hotspots');
            return expectedResponse;
          }
        };
      }
    },
    ASSETS: {
      async fetch() {
        calls.assetsFetch += 1;
        return new Response('assets');
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }), env);

  assert.equal(response, expectedResponse);
  assert.deepEqual(calls.idFromName, ['den-hotspots']);
  assert.deepEqual(calls.get, ['id:den-hotspots']);
  assert.equal(calls.stubFetch, 1);
  assert.equal(calls.assetsFetch, 0);
});

test('worker returns 500 for /api/hotspots when HOTSPOT_STORE binding is missing', async () => {
  const env = {
    ASSETS: {
      async fetch() {
        return new Response('assets');
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/api/hotspots', { method: 'POST' }), env);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'HOTSPOT_STORE binding is missing.' });
});

test('worker serves non-api requests through ASSETS binding', async () => {
  const calls = { assetsFetch: [] };
  const env = {
    HOTSPOT_STORE: {
      idFromName() {
        throw new Error('HOTSPOT_STORE should not be used for non-api requests');
      },
      get() {
        throw new Error('HOTSPOT_STORE should not be used for non-api requests');
      }
    },
    ASSETS: {
      async fetch(request) {
        calls.assetsFetch.push(new URL(request.url).pathname);
        return new Response('den page', { status: 200 });
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/den.html'), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'den page');
  assert.deepEqual(calls.assetsFetch, ['/den.html']);
});

test('functions/api/hotspots onRequest delegates to HOTSPOT_STORE durable object', async () => {
  const calls = { idFromName: [], get: [], fetch: 0 };
  const expected = new Response('ok', { status: 200 });

  const env = {
    HOTSPOT_STORE: {
      idFromName(name) {
        calls.idFromName.push(name);
        return `id:${name}`;
      },
      get(id) {
        calls.get.push(id);
        return {
          async fetch(request) {
            calls.fetch += 1;
            assert.equal(request.method, 'GET');
            return expected;
          }
        };
      }
    }
  };

  const response = await onRequest({ request: new Request('https://example.com/api/hotspots'), env });

  assert.equal(response, expected);
  assert.deepEqual(calls.idFromName, ['den-hotspots']);
  assert.deepEqual(calls.get, ['id:den-hotspots']);
  assert.equal(calls.fetch, 1);
});

test('functions/api/hotspots onRequest returns 500 when HOTSPOT_STORE binding is missing', async () => {
  const response = await onRequest({
    request: new Request('https://example.com/api/hotspots', { method: 'POST' }),
    env: {}
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'HOTSPOT_STORE binding is missing.' });
});
