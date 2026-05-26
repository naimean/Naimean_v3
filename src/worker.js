const DEFAULT_HOTSPOTS = [
  { id: '1', name: 'Hotspot 1', x: 100, y: 100 },
  { id: '2', name: 'Hotspot 2', x: 200, y: 200 },
];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function sanitizeHotspots(hotspots) {
  return (hotspots || []).map(h => ({
    id: String(h.id),
    name: String(h.name || ''),
    x: Number(h.x || 0),
    y: Number(h.y || 0),
  }));
}

function rewriteRequestPath(request, newPath) {
  const url = new URL(request.url);
  url.pathname = newPath;
  return new Request(url.toString(), request);
}

const HTML_ROUTE_ALIASES = new Map([
  ['/den', '/index.html'],
  ['/den.html', '/index.html'],
  ['/hallway', '/index.html'],
]);

export class HotspotStore {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (request.method === 'GET') {
      try {
        const saved = await this.state.storage.get('hotspots');
        return Response.json({ hotspots: sanitizeHotspots(saved) });
      } catch (error) {
        return Response.json({ error: `Failed to load hotspots: ${error?.message || 'Unknown error'}` }, { status: 500 });
      }
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
      }

      try {
        const hotspots = sanitizeHotspots(body?.hotspots);
        await this.state.storage.put('hotspots', hotspots);
        return Response.json({ ok: true, hotspots });
      } catch (error) {
        return Response.json({ error: `Failed to save hotspots: ${error?.message || 'Unknown error'}` }, { status: 500 });
      }
    }

    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/hotspots') {
      if (!env.HOTSPOT_STORE) {
        return Response.json({ error: 'HOTSPOT_STORE binding is missing.' }, { status: 500 });
      }
      const id = env.HOTSPOT_STORE.idFromName('den-hotspots');
      return env.HOTSPOT_STORE.get(id).fetch(request);
    }

    const aliasedPath = HTML_ROUTE_ALIASES.get(url.pathname);
    
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      if (aliasedPath) {
        return env.ASSETS.fetch(rewriteRequestPath(request, aliasedPath));
      }
      return env.ASSETS.fetch(request);
    }

    return fetch(request);
  },
};
