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
  assert.equal(body.hotspots.length, 7);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
  assert.deepEqual(body.hotspots[1], { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 });
  assert.deepEqual(body.hotspots[2], { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 });
  assert.deepEqual(body.hotspots[4], { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 });
  assert.deepEqual(body.hotspots[5], { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 });
  assert.deepEqual(body.hotspots[6], { id: 'overlay-left-monitor-control', x: 1322, y: 1028, w: 298, h: 206 });
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
  assert.equal(body.hotspots.length, 7);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
  assert.deepEqual(body.hotspots[1], { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 });
  assert.deepEqual(body.hotspots[2], { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 });
  assert.deepEqual(body.hotspots[4], { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 });
  assert.deepEqual(body.hotspots[5], { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 });
  assert.deepEqual(body.hotspots[6], { id: 'overlay-left-monitor-control', x: 1322, y: 1028, w: 298, h: 206 });

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

test('worker preserves existing frame-src CSP for den path', async () => {
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
      async fetch() {
        return new Response('den page', {
          status: 200,
          headers: {
            'content-security-policy': "default-src 'self'; frame-src https://discord.com https://discordapp.com;"
          }
        });
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/den.html'), env);
  const csp = response.headers.get('content-security-policy');
  assert.equal(
    csp,
    "default-src 'self'; frame-src https://discord.com https://discordapp.com;"
  );
});

test('worker preserves existing frame-src CSP on extensionless den paths', async () => {
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
      async fetch() {
        return new Response('den page', {
          status: 200,
          headers: {
            'content-security-policy': "default-src 'self'; frame-src https://discord.com https://discordapp.com;"
          }
        });
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/den'), env);
  const csp = response.headers.get('content-security-policy');

  assert.equal(
    csp,
    "default-src 'self'; frame-src https://discord.com https://discordapp.com;"
  );
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

// --- src/worker.js HotspotStore additional coverage ---

test('HotspotStore GET returns saved hotspots when storage has data', async () => {
  const saved = [
    { id: 'noahs-arcade', x: 100, y: 200, w: 300, h: 400 },
    { id: 'aquarium', x: 500, y: 600, w: 200, h: 150 },
    { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 },
    { id: 'pencil-sharpener', x: 2562, y: 1220, w: 221, h: 245 },
    { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 },
    { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 },
    { id: 'overlay-left-monitor-control', x: 1322, y: 1028, w: 298, h: 206 }
  ];
  const { state } = makeState(saved);
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 100, y: 200, w: 300, h: 400 });
  assert.deepEqual(body.hotspots[1], { id: 'aquarium', x: 500, y: 600, w: 200, h: 150 });
});

test('HotspotStore GET returns 500 when storage.get throws', async () => {
  const state = {
    storage: {
      async get() { throw new Error('disk failure'); },
      async put() {}
    }
  };
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /Failed to load hotspots/);
  assert.match(body.error, /disk failure/);
});

test('HotspotStore POST returns 500 when storage.put throws', async () => {
  const state = {
    storage: {
      async get() { return undefined; },
      async put() { throw new Error('quota exceeded'); }
    }
  };
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: [] })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /Failed to save hotspots/);
  assert.match(body.error, /quota exceeded/);
});

// --- sanitizeHotspots edge cases (exercised through HotspotStore) ---

test('HotspotStore POST uses defaults when hotspots payload is null', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: null })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.hotspots.length, 7);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
});

test('HotspotStore POST uses defaults when hotspots payload is a non-array', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: 'oops' })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
});

test('HotspotStore POST skips non-object and null entries in hotspots array', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          null,
          42,
          'string-entry',
          { id: 123, x: 1, y: 2, w: 3, h: 4 },
          { id: 'noahs-arcade', x: 100, y: 200, w: 300, h: 400 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 100, y: 200, w: 300, h: 400 });
  assert.deepEqual(body.hotspots[1], { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 });
});

test('HotspotStore POST uses last entry when hotspot id is duplicated', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: 10, y: 20, w: 100, h: 200 },
          { id: 'noahs-arcade', x: 50, y: 60, w: 500, h: 600 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 50, y: 60, w: 500, h: 600 });
});

test('HotspotStore POST clamps coordinates to boundary min values', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: -999, y: -999, w: 1, h: 1 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 0, y: 0, w: 20, h: 20 });
});

test('HotspotStore POST clamps coordinates to boundary max values', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: 99999, y: 99999, w: 99999, h: 99999 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 3840, y: 2160, w: 3840, h: 2160 });
});

test('HotspotStore POST falls back to default for NaN coordinate values', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: NaN, y: NaN, w: NaN, h: NaN }
        ]
      })
    })
  );
  const body = await response.json();

  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
});

test('HotspotStore POST rounds fractional coordinate values', async () => {
  const { state } = makeState(undefined);
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: 100.4, y: 200.5, w: 300.6, h: 400.9 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 100, y: 201, w: 301, h: 401 });
});

// --- worker router additional coverage ---

test('worker serves non-hotspot /api/* requests through ASSETS binding', async () => {
  const calls = { assetsFetch: [] };
  const env = {
    HOTSPOT_STORE: {
      idFromName() { throw new Error('HOTSPOT_STORE should not be called'); },
      get() { throw new Error('HOTSPOT_STORE should not be called'); }
    },
    ASSETS: {
      async fetch(request) {
        calls.assetsFetch.push(new URL(request.url).pathname);
        return new Response('other api', { status: 200 });
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/api/other'), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'other api');
  assert.deepEqual(calls.assetsFetch, ['/api/other']);
});

test('worker serves root path through ASSETS binding', async () => {
  const calls = { assetsFetch: [] };
  const env = {
    HOTSPOT_STORE: {},
    ASSETS: {
      async fetch(request) {
        calls.assetsFetch.push(new URL(request.url).pathname);
        return new Response('index', { status: 200 });
      }
    }
  };

  const response = await router.fetch(new Request('https://example.com/'), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'index');
  assert.deepEqual(calls.assetsFetch, ['/']);
});

// --- functions/api/hotspots.js HotspotStore class coverage ---

import { HotspotStore as FunctionsHotspotStore } from '../functions/api/hotspots.js';

function makeFunctionsState(initialHotspots) {
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

test('functions HotspotStore GET returns default hotspots when storage is empty', async () => {
  const { state } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.hotspots.length, 6);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
});

test('functions HotspotStore GET returns saved hotspots when storage has data', async () => {
  const saved = [
    { id: 'noahs-arcade', x: 10, y: 20, w: 100, h: 200 },
    { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 },
    { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 },
    { id: 'pencil-sharpener', x: 2562, y: 1220, w: 221, h: 245 },
    { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 },
    { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 }
  ];
  const { state } = makeFunctionsState(saved);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 10, y: 20, w: 100, h: 200 });
});

test('functions HotspotStore POST rejects invalid JSON', async () => {
  const { state } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json'
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON body.' });
});

test('functions HotspotStore POST sanitizes and stores hotspot payloads', async () => {
  const { state, calls, getStored } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          { id: 'noahs-arcade', x: 50, y: 60, w: 500, h: 600 }
        ]
      })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.hotspots.length, 6);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 50, y: 60, w: 500, h: 600 });
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].key, 'hotspots');
  assert.deepEqual(getStored(), body.hotspots);
});

test('functions HotspotStore returns 405 for unsupported methods', async () => {
  const { state } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'DELETE' }));

  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: 'Method not allowed.' });
});

// --- functions/api/hotspots.js onRequest additional coverage ---

test('functions/api/hotspots onRequest handles OPTIONS preflight', async () => {
  const response = await onRequest({
    request: new Request('https://example.com/api/hotspots', { method: 'OPTIONS' }),
    env: {}
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
});

test('functions/api/hotspots onRequest returns 500 when stub.fetch throws', async () => {
  const env = {
    HOTSPOT_STORE: {
      idFromName() { return 'id:den-hotspots'; },
      get() {
        return {
          async fetch() { throw new Error('connection refused'); }
        };
      }
    }
  };

  const response = await onRequest({
    request: new Request('https://example.com/api/hotspots', { method: 'GET' }),
    env
  });
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.match(body.error, /Hotspot store request failed/);
  assert.match(body.error, /connection refused/);
});

test('functions/api/hotspots onRequest delegates POST requests', async () => {
  const calls = { fetch: 0 };
  const expected = new Response(JSON.stringify({ ok: true }), { status: 200 });

  const env = {
    HOTSPOT_STORE: {
      idFromName() { return 'id:den-hotspots'; },
      get() {
        return {
          async fetch(request) {
            calls.fetch += 1;
            assert.equal(request.method, 'POST');
            return expected;
          }
        };
      }
    }
  };

  const response = await onRequest({
    request: new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: [] })
    }),
    env
  });

  assert.equal(response, expected);
  assert.equal(calls.fetch, 1);
});

test('HotspotStore GET reports unknown load errors without message text', async () => {
  const state = {
    storage: {
      async get() { throw null; },
      async put() {}
    }
  };
  const store = new HotspotStore(state);

  const response = await store.fetch(new Request('https://example.com/api/hotspots', { method: 'GET' }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to load hotspots: Unknown error' });
});

test('HotspotStore POST reports unknown save errors without message text', async () => {
  const state = {
    storage: {
      async get() { return undefined; },
      async put() { throw undefined; }
    }
  };
  const store = new HotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: [] })
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Failed to save hotspots: Unknown error' });
});

test('functions HotspotStore POST falls back to defaults for non-finite values', async () => {
  const { state } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hotspots: [
          null,
          { id: 'noahs-arcade', x: 'bad', y: null, w: Infinity, h: undefined }
        ]
      })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[0], { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 });
});

test('functions HotspotStore POST uses defaults when hotspots payload is not an array', async () => {
  const { state } = makeFunctionsState(undefined);
  const store = new FunctionsHotspotStore(state);

  const response = await store.fetch(
    new Request('https://example.com/api/hotspots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hotspots: null })
    })
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.hotspots[1], { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 });
});

test('functions/api/hotspots onRequest returns unknown error text when durable object throws non-Error', async () => {
  const env = {
    HOTSPOT_STORE: {
      idFromName() { return 'id:den-hotspots'; },
      get() {
        return {
          async fetch() { throw {}; }
        };
      }
    }
  };

  const response = await onRequest({
    request: new Request('https://example.com/api/hotspots', { method: 'GET' }),
    env
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Hotspot store request failed: Unknown error' });
});
