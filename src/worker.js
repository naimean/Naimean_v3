const DEFAULT_HOTSPOTS = [
  { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 },
  { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 },
  { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 },
  { id: 'chapel', x: 3840, y: 0, w: 3840, h: 2160 },
  { id: 'pencil-sharpener', x: 2562, y: 1220, w: 221, h: 245 },
  { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 },
  { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 },
  { id: 'overlay-left-monitor-control', x: 1322, y: 1028, w: 298, h: 206 },
  { id: 'overlay-right-monitor-control', x: 1758, y: 1014, w: 288, h: 228 },
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
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/;
const GOOGLE_DRIVE_LIST_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_MEDIA_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const DEFAULT_AQUARIUM_LOCAL_CLIP_COUNT = 23;

function jsonResponse(data, status = 200) {
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
  return jsonResponse({ error }, status);
}

function buildClipCatalogResponse(clips, source) {
  return new Response(JSON.stringify({ clips, source, count: clips.length }), {
    headers: {
      ...JSON_HEADERS,
      'cache-control': 'public, max-age=300',
    },
  });
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

const DISCORD_GUEST_INVITE_URL = 'https://discord.gg/kTkD7N3JN';
const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_AUTH_COMPLETE_PARAM = 'discord_auth_complete';
const DISCORD_AUTH_ROUTE_ALIASES = new Set([
  '/api/discord/auth',
  '/api/discord/auth/',
  '/api/discord/oauth',
  '/api/discord/oauth/',
  '/api/discord/0auth',
  '/api/discord/0auth/',
  '/auth/discord/login',
  '/auth/discord/login/',
]);
const DISCORD_CALLBACK_ROUTE_ALIASES = new Set([
  '/api/discord/callback',
  '/api/discord/callback/',
  '/auth/discord/callback',
  '/auth/discord/callback/',
]);

function handleDiscordAuth(request, env) {
  const clientId = env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(DISCORD_GUEST_INVITE_URL, 302);
  }
  const url = new URL(request.url);
  const callbackPath = url.pathname.startsWith('/auth/') ? '/auth/discord/callback' : '/api/discord/callback';
  const redirectUri = `${url.origin}${callbackPath}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
  });
  return Response.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`, 302);
}

function handleDiscordCallback(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error || !url.searchParams.get('code')) {
    return Response.redirect(`${url.origin}/`, 302);
  }
  return Response.redirect(`${url.origin}/?${DISCORD_AUTH_COMPLETE_PARAM}=1`, 302);
}

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
        return jsonResponse({ hotspots: sanitizeHotspots(saved) });
      } catch (error) {
        return jsonResponse({ error: `Failed to load hotspots: ${error?.message || 'Unknown error'}` }, 500);
      }
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body.' }, 400);
      }

      try {
        const hotspots = sanitizeHotspots(body?.hotspots);
        await this.state.storage.put('hotspots', hotspots);
        return jsonResponse({ ok: true, hotspots });
      } catch (error) {
        return jsonResponse({ error: `Failed to save hotspots: ${error?.message || 'Unknown error'}` }, 500);
      }
    }

    return jsonResponse({ error: 'Method not allowed.' }, 405);
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

    if (DISCORD_AUTH_ROUTE_ALIASES.has(url.pathname)) {
      return handleDiscordAuth(request, env);
    }

    if (DISCORD_CALLBACK_ROUTE_ALIASES.has(url.pathname)) {
      return handleDiscordCallback(request);
    }

    if (url.pathname === '/api/hotspots') {
      if (!env.HOTSPOT_STORE) {
        return jsonResponse({ error: 'HOTSPOT_STORE binding is missing.' }, 500);
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
