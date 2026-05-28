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

// ---- Discord OAuth ----

const DISCORD_API_ENDPOINT = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_OAUTH_TOKEN_URL = `${DISCORD_API_ENDPOINT}/oauth2/token`;
const DISCORD_REDIRECT_URI = 'https://naimean.com/api/discord/callback';
const DISCORD_OAUTH_SCOPES = 'identify guilds.members.read';
const SESSION_COOKIE_NAME = 'naimean_session';
const OAUTH_STATE_COOKIE_NAME = 'naimean_oauth_state';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const OAUTH_STATE_MAX_AGE_SECONDS = 600; // 10 minutes

function base64urlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const b64 = padded + '='.repeat((4 - padded.length % 4) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function createSessionToken(secret, payload) {
  const encoded = base64urlEncode(JSON.stringify(payload));
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex < 1) return null;
  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  try {
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlDecode(sig),
      new TextEncoder().encode(encoded)
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex < 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

async function getSession(request, secret) {
  if (!secret) return null;
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(secret, token);
}

function hasRequiredRole(session, allowedRoleIds) {
  if (!session || !session.isMember) return false;
  if (!allowedRoleIds) return true;
  const allowed = String(allowedRoleIds).split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return Array.isArray(session.roles) && session.roles.some((r) => allowed.includes(r));
}

async function handleDiscordAuth(request, env) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  const clientId = env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return jsonResponse({ error: 'Discord OAuth is not configured.' }, 503);
  }
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = base64urlEncode(stateBytes);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: DISCORD_OAUTH_SCOPES,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`,
      'Set-Cookie': `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleDiscordCallback(request, env) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': `/?discord_error=${encodeURIComponent(oauthError)}` },
    });
  }

  if (!code || !state) {
    return jsonResponse({ error: 'Missing code or state.' }, 400);
  }

  const cookies = parseCookies(request);
  if (!cookies[OAUTH_STATE_COOKIE_NAME] || cookies[OAUTH_STATE_COOKIE_NAME] !== state) {
    return jsonResponse({ error: 'Invalid state parameter.' }, 400);
  }

  const clientId = env.DISCORD_CLIENT_ID;
  const clientSecret = env.DISCORD_CLIENT_SECRET;
  const sessionSecret = env.SESSION_SECRET;

  if (!clientId || !clientSecret || !sessionSecret) {
    return jsonResponse({ error: 'Discord OAuth is not configured.' }, 503);
  }

  // Exchange authorization code for access token
  const tokenRes = await fetch(DISCORD_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: DISCORD_REDIRECT_URI,
    }).toString(),
  });

  if (!tokenRes.ok) {
    return jsonResponse({ error: 'Failed to exchange authorization code.' }, 502);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return jsonResponse({ error: 'No access token received.' }, 502);
  }

  // Get Discord user identity
  const userRes = await fetch(`${DISCORD_API_ENDPOINT}/users/@me`, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });

  if (!userRes.ok) {
    return jsonResponse({ error: 'Failed to retrieve user identity.' }, 502);
  }

  const user = await userRes.json();

  // Get guild membership and roles
  let memberRoles = [];
  let isMember = false;
  const guildId = env.DISCORD_GUILD_ID;

  if (guildId) {
    const memberRes = await fetch(`${DISCORD_API_ENDPOINT}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (memberRes.ok) {
      const memberData = await memberRes.json();
      memberRoles = Array.isArray(memberData.roles) ? memberData.roles : [];
      isMember = true;
    }
  }

  // Build and sign session cookie
  const sessionPayload = {
    userId: user.id,
    username: user.username,
    avatar: user.avatar || null,
    isMember,
    roles: memberRoles,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const sessionToken = await createSessionToken(sessionSecret, sessionPayload);

  const headers = new Headers({ 'Location': '/', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', `${SESSION_COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  headers.append('Set-Cookie', `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

  return new Response(null, { status: 302, headers });
}

async function handleDiscordMe(request, env) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  const session = await getSession(request, env.SESSION_SECRET);
  if (!session) {
    return jsonResponse({ authenticated: false });
  }
  const hasRole = hasRequiredRole(session, env.DISCORD_ALLOWED_ROLE_IDS);
  return jsonResponse({
    authenticated: true,
    userId: session.userId,
    username: session.username,
    avatar: session.avatar,
    isMember: session.isMember,
    roles: session.roles,
    hasRole,
  });
}

async function handleDiscordLogout(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'no-store',
      'Set-Cookie': `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
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

    if (url.pathname === '/api/hotspots') {
      if (!env.HOTSPOT_STORE) {
        return jsonResponse({ error: 'HOTSPOT_STORE binding is missing.' }, 500);
      }
      const id = env.HOTSPOT_STORE.idFromName('den-hotspots');
      return env.HOTSPOT_STORE.get(id).fetch(request);
    }

    if (url.pathname === '/api/discord/auth') {
      return handleDiscordAuth(request, env);
    }

    if (url.pathname === '/api/discord/callback') {
      return handleDiscordCallback(request, env);
    }

    if (url.pathname === '/api/discord/me') {
      return handleDiscordMe(request, env);
    }

    if (url.pathname === '/api/discord/logout') {
      return handleDiscordLogout(request, env);
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
