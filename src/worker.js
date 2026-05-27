const DEFAULT_HOTSPOTS = [
  { id: '1', name: 'Hotspot 1', x: 100, y: 100 },
  { id: '2', name: 'Hotspot 2', x: 200, y: 200 },
];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const GOOGLE_DRIVE_LIST_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_MEDIA_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DEFAULT_AQUARIUM_LOCAL_CLIP_COUNT = 23;

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

function toBoundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function buildLocalShrimpClipUrls(clipCount) {
  const total = toBoundedInteger(clipCount, DEFAULT_AQUARIUM_LOCAL_CLIP_COUNT, { min: 1, max: 500 });
  return Array.from({ length: total }, (_, index) => `assets/video/shrimp/sh${index + 1}.mp4`);
}

function isValidDriveFileId(fileId) {
  return DRIVE_FILE_ID_PATTERN.test(fileId);
}

function isVideoMimeType(mimeType) {
  return typeof mimeType === 'string' && mimeType.startsWith('video/');
}

function buildApiError(status, error) {
  return Response.json({ error }, { status, headers: JSON_HEADERS });
}

function buildClipCatalogResponse(clips, source) {
  return Response.json(
    {
      clips,
      source,
      count: clips.length,
    },
    {
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, max-age=300',
      },
    }
  );
}

async function fetchDriveShrimpClipCatalog(env) {
  const apiKey = env.GOOGLE_DRIVE_API_KEY;
  const folderId = env.GOOGLE_DRIVE_SHRIMP_FOLDER_ID;
  if (!apiKey || !folderId || !isValidDriveFileId(folderId)) {
    return null;
  }
  const safeFolderId = String(folderId).replace(/'/g, "\\'");

  const pageSize = toBoundedInteger(env.GOOGLE_DRIVE_PAGE_SIZE, 100, { min: 1, max: 1000 });
  const clipPaths = [];
  let pageToken = '';

  while (true) {
    const params = new URLSearchParams({
      key: apiKey,
      q: `'${safeFolderId}' in parents and trashed=false and mimeType contains 'video/'`,
      fields: 'nextPageToken,files(id,name,mimeType)',
      pageSize: String(pageSize),
      orderBy: 'name_natural',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(`${GOOGLE_DRIVE_LIST_ENDPOINT}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Drive list request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    const files = Array.isArray(payload?.files) ? payload.files : [];
    files.forEach((file) => {
      if (isValidDriveFileId(file?.id) && isVideoMimeType(file?.mimeType)) {
        clipPaths.push(`/api/aquarium/shrimp-clip/${file.id}`);
      }
    });

    pageToken = payload?.nextPageToken || '';
    if (!pageToken) {
      break;
    }
  }

  return clipPaths;
}

async function handleShrimpClipCatalog(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== 'GET') {
    return buildApiError(405, 'Method not allowed.');
  }

  const fallbackClips = buildLocalShrimpClipUrls(env.AQUARIUM_LOCAL_CLIP_COUNT);
  try {
    const driveClips = await fetchDriveShrimpClipCatalog(env);
    if (Array.isArray(driveClips) && driveClips.length > 0) {
      return buildClipCatalogResponse(driveClips, 'google-drive');
    }
  } catch {
    // Fall back to local clips.
  }

  return buildClipCatalogResponse(fallbackClips, 'local-fallback');
}

async function handleShrimpClipProxy(request, env, clipId) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }
  if (request.method !== 'GET') {
    return buildApiError(405, 'Method not allowed.');
  }

  if (!isValidDriveFileId(clipId)) {
    return buildApiError(400, 'Invalid clip id.');
  }
  if (!env.GOOGLE_DRIVE_API_KEY) {
    return buildApiError(503, 'Google Drive API key is not configured.');
  }

  const params = new URLSearchParams({
    alt: 'media',
    key: env.GOOGLE_DRIVE_API_KEY,
  });
  const response = await fetch(`${GOOGLE_DRIVE_MEDIA_ENDPOINT}/${clipId}?${params.toString()}`);
  if (!response.ok || !response.body) {
    return buildApiError(
      response.status || 502,
      `Clip temporarily unavailable (status: ${response.status || 502}).`
    );
  }

  const headers = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=300');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
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

    if (url.pathname === '/api/aquarium/shrimp-clips') {
      return handleShrimpClipCatalog(request, env);
    }

    if (url.pathname.startsWith('/api/aquarium/shrimp-clip/')) {
      const clipId = url.pathname.split('/').pop() || '';
      return handleShrimpClipProxy(request, env, clipId);
    }

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
