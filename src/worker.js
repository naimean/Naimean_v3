const DEFAULT_HOTSPOTS = [
  { id: 'big-tv', x: 1148, y: 568, w: 924, h: 505 },
  { id: 'left-monitor', x: 1488, y: 1072, w: 292, h: 205 },
  { id: 'commodore-screen', x: 1852, y: 1050, w: 348, h: 227 },
  { id: 'right-monitor', x: 2292, y: 1036, w: 262, h: 198 },
  { id: 'aquarium', x: 2704, y: 720, w: 455, h: 420 },
  { id: 'rca-board', x: 3220, y: 260, w: 470, h: 1060 },
  { id: 'pencil-sharpener', x: 1682, y: 1338, w: 135, h: 150 },
  { id: 'date-tracker', x: 2484, y: 912, w: 200, h: 130 },
  { id: 'ashtray', x: 2055, y: 1336, w: 176, h: 128 }
];

const HOTSPOT_LIMITS = {
  minX: 0,
  maxX: 3840,
  minY: 0,
  maxY: 2160,
  minW: 20,
  maxW: 3840,
  minH: 20,
  maxH: 2160
};

const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeHotspots(input) {
  if (!Array.isArray(input)) return DEFAULT_HOTSPOTS;

  const entriesById = new Map();
  input.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return;
    entriesById.set(entry.id, entry);
  });

  return DEFAULT_HOTSPOTS.map((fallback) => {
    const entry = entriesById.get(fallback.id);
    if (!entry) return { ...fallback };

    const x = isFiniteNumber(entry.x) ? clamp(Math.round(entry.x), HOTSPOT_LIMITS.minX, HOTSPOT_LIMITS.maxX) : fallback.x;
    const y = isFiniteNumber(entry.y) ? clamp(Math.round(entry.y), HOTSPOT_LIMITS.minY, HOTSPOT_LIMITS.maxY) : fallback.y;
    const w = isFiniteNumber(entry.w) ? clamp(Math.round(entry.w), HOTSPOT_LIMITS.minW, HOTSPOT_LIMITS.maxW) : fallback.w;
    const h = isFiniteNumber(entry.h) ? clamp(Math.round(entry.h), HOTSPOT_LIMITS.minH, HOTSPOT_LIMITS.maxH) : fallback.h;

    return { id: fallback.id, x, y, w, h };
  });
}

export class HotspotStore {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === 'GET') {
      const saved = await this.state.storage.get('hotspots');
      return json({ hotspots: sanitizeHotspots(saved) });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body.' }, 400);
      }

      const hotspots = sanitizeHotspots(body?.hotspots);
      await this.state.storage.put('hotspots', hotspots);
      return json({ ok: true, hotspots });
    }

    return json({ error: 'Method not allowed.' }, 405);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hotspots') {
      const id = env.HOTSPOT_STORE.idFromName('den-hotspots');
      return env.HOTSPOT_STORE.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
