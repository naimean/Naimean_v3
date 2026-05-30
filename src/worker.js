// ─── Session token utilities ──────────────────────────────────────────────────
async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function toBase64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const base64 = pad ? padded + '='.repeat(4 - pad) : padded;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function createSessionToken(secret, payload) {
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySessionToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 0) return null;
  const encoded = token.slice(0, lastDot);
  const sigStr = token.slice(lastDot + 1);
  let sigBytes;
  try {
    sigBytes = fromBase64Url(sigStr);
  } catch {
    return null;
  }
  const key = await importHmacKey(secret);
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(encoded));
  if (!valid) return null;
  let payload;
  try {
    const bytes = new Uint8Array(fromBase64Url(encoded));
    let decoded = '';
    for (let i = 0; i < bytes.length; i++) decoded += String.fromCharCode(bytes[i]);
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

// ─── Cookie utilities ─────────────────────────────────────────────────────────
function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  let cookie = `${name}=${value}`;
  if (options.httpOnly) cookie += '; HttpOnly';
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.secure) cookie += '; Secure';
  return cookie;
}

// ─── Response helpers ─────────────────────────────────────────────────────────
const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store'
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function errorRedirect(base, errorCode) {
  return Response.redirect(`${base}?discord_error=${errorCode}`, 302);
}

// ─── Asset serving ────────────────────────────────────────────────────────────
const INDEX_ALIAS_PATHS = new Set(['/den', '/den.html']);

function isHtmlPath(pathname) {
  if (pathname.startsWith('/api/')) return false;
  const lastSegment = pathname.split('/').pop() || '';
  return pathname === '/' || pathname.endsWith('.html') || !lastSegment.includes('.');
}

function applyAssetCacheHeaders(pathname, headers) {
  if (isHtmlPath(pathname)) {
    headers.set('cache-control', 'no-store');
  } else {
    headers.set('cache-control', 'public, max-age=0, must-revalidate');
  }
}

async function serveAsset(request, env, pathname) {
  if (!env.ASSETS?.fetch) {
    return jsonResponse({ error: 'Static assets unavailable.' }, 500);
  }
  const assetRequest = INDEX_ALIAS_PATHS.has(pathname)
    ? new Request(new URL('/index.html', request.url).toString(), request)
    : request;
  const upstream = await env.ASSETS.fetch(assetRequest);
  const headers = new Headers(upstream.headers);
  applyAssetCacheHeaders(pathname, headers);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

// ─── HotspotStore ─────────────────────────────────────────────────────────────
const DEFAULT_HOTSPOTS = [
  { id: 'noahs-arcade', x: 880, y: 320, w: 2050, h: 1280 },
  { id: 'aquarium', x: 2680, y: 445, w: 455, h: 729 },
  { id: 'rca-board', x: 738, y: 380, w: 470, h: 1060 },
  { id: 'chapel', x: 3840, y: 0, w: 3840, h: 2160 },
  { id: 'pencil-sharpener', x: 2562, y: 1220, w: 221, h: 245 },
  { id: 'overlay-big-tv-control', x: 1469, y: 330, w: 1000, h: 572 },
  { id: 'overlay-flip-clock-control', x: 990, y: 1740, w: 360, h: 156 },
  { id: 'overlay-left-monitor-control', x: 1322, y: 1028, w: 298, h: 206 },
  { id: 'overlay-right-monitor-control', x: 1758, y: 1014, w: 288, h: 228 }
];

const HOTSPOT_LIMITS = {
  minX: 0, maxX: 3840, minY: 0, maxY: 2160, minW: 20, maxW: 3840, minH: 20, maxH: 2160
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function sanitizeHotspots(input) {
  if (!Array.isArray(input)) return DEFAULT_HOTSPOTS.map((h) => ({ ...h }));
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

const HOTSPOT_JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
};

function hotspotJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HOTSPOT_JSON_HEADERS });
}

export class HotspotStore {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: HOTSPOT_JSON_HEADERS });
    }
    if (request.method === 'GET') {
      let saved;
      try {
        saved = await this.state.storage.get('hotspots');
      } catch (err) {
        return hotspotJson({ error: `Failed to load hotspots: ${err?.message || 'Unknown error'}` }, 500);
      }
      return hotspotJson({ hotspots: sanitizeHotspots(saved) });
    }
    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return hotspotJson({ error: 'Invalid JSON body.' }, 400);
      }
      const hotspots = sanitizeHotspots(body?.hotspots);
      try {
        await this.state.storage.put('hotspots', hotspots);
      } catch (err) {
        return hotspotJson({ error: `Failed to save hotspots: ${err?.message || 'Unknown error'}` }, 500);
      }
      return hotspotJson({ ok: true, hotspots });
    }
    return hotspotJson({ error: 'Method not allowed.' }, 405);
  }
}

// ─── Aquarium / shrimp clips ──────────────────────────────────────────────────
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const CLIP_ID_RE = /^[A-Za-z0-9_-]{10,}$/;
const SHRIMP_CLIP_CACHE_CONTROL = 'public, max-age=300';

function localShrimpClips(env) {
  const count = parseInt(env.AQUARIUM_LOCAL_CLIP_COUNT || '23', 10);
  const clips = [];
  for (let i = 1; i <= count; i++) clips.push(`assets/video/shrimp/sh${i}.mp4`);
  return jsonResponse({ source: 'local-fallback', clips });
}

async function googleDriveShrimpClips(env) {
  const { GOOGLE_DRIVE_API_KEY: apiKey, GOOGLE_DRIVE_SHRIMP_FOLDER_ID: folderId } = env;
  const pageSize = parseInt(env.GOOGLE_DRIVE_PAGE_SIZE || '100', 10);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType)');
  const url = `${DRIVE_API_BASE}/files?q=${query}&fields=${fields}&pageSize=${pageSize}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const clips = (data.files || [])
    .filter((f) => f.mimeType && f.mimeType.startsWith('video/'))
    .map((f) => `/api/aquarium/shrimp-clip/${f.id}`);
  return jsonResponse({ source: 'google-drive', clips });
}

async function proxyShrimpClip(env, fileId) {
  if (!env.GOOGLE_DRIVE_API_KEY) {
    return jsonResponse({ error: 'Google Drive API key is not configured.' }, 503);
  }
  if (!CLIP_ID_RE.test(fileId)) {
    return jsonResponse({ error: 'Invalid clip id.' }, 400);
  }
  const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media&key=${env.GOOGLE_DRIVE_API_KEY}`;
  const upstream = await fetch(url);
  const headers = new Headers();
  const ct = upstream.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  headers.set('cache-control', SHRIMP_CLIP_CACHE_CONTROL);
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ─── Discord OAuth ────────────────────────────────────────────────────────────
const DISCORD_API = 'https://discord.com/api/v10';
const OAUTH_STATE_COOKIE = 'naimean_oauth_state';
const SESSION_COOKIE = 'naimean_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function handleDiscordAuth(request, env) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  
  const { DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI } = env;
  const url = new URL(request.url);
  
  if (!DISCORD_CLIENT_ID) {
    return jsonResponse({ error: "Configuration Error: DISCORD_CLIENT_ID is missing from environmental bindings." }, 500);
  }

  const state = crypto.randomUUID().replace(/-/g, '');
  // Fallback to auto-calculating the origin match if explicit URI binding is missing
  const redirectUri = DISCORD_REDIRECT_URI || `${url.origin}/api/discord/callback`;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state
  });

  const headers = new Headers({
    'Location': `https://discord.com/oauth2/authorize?${params.toString()}`,
    'Set-Cookie': serializeCookie(OAUTH_STATE_COOKIE, state, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 300 }),
    'Access-Control-Allow-Origin': '*'
  });

  return new Response(null, { status: 302, headers });
}

async function handleDiscordCallback(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  const errorParam = url.searchParams.get('error');
  if (errorParam) return errorRedirect(`${origin}/`, errorParam);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return errorRedirect(`${origin}/`, 'invalid_request');

  const cookies = parseCookies(request);
  if (!cookies[OAUTH_STATE_COOKIE] || cookies[OAUTH_STATE_COOKIE] !== state) {
    return errorRedirect(`${origin}/`, 'state_mismatch');
  }

  const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET, DISCORD_GUILD_ID, DISCORD_REDIRECT_URI } = env;
  if (!DISCORD_CLIENT_SECRET || !SESSION_SECRET) return errorRedirect(`${origin}/`, 'configuration_error');

  const targetRedirectUri = DISCORD_REDIRECT_URI || `${origin}/api/discord/callback`;

  // Exchange code for access token
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: targetRedirectUri
    })
  });

  if (!tokenRes.ok) return errorRedirect(`${origin}/`, 'token_exchange_failed');
  const { access_token: accessToken } = await tokenRes.json();
  const authHeader = { Authorization: 'Bearer ' + accessToken };

  // Get user info
  const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: authHeader });
  const user = await userRes.json();

  // Get guild membership
  let isMember = false;
  let roles = [];
  if (DISCORD_GUILD_ID) {
    const memberRes = await fetch(`${DISCORD_API}/users/@me/guilds/${DISCORD_GUILD_ID}/member`, { headers: authHeader });
    if (memberRes.ok) {
      const member = await memberRes.json();
      isMember = true;
      roles = Array.isArray(member.roles) ? member.roles : [];
    }
  }

  const exp = Date.now() + SESSION_TTL_MS;
  const sessionToken = await createSessionToken(SESSION_SECRET, {
    userId: user.id,
    username: user.username,
    avatar: user.avatar || null,
    isMember,
    roles,
    exp
  });

  const clearStateCookie = serializeCookie(OAUTH_STATE_COOKIE, '', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  const sessionCookieStr = serializeCookie(SESSION_COOKIE, sessionToken, { httpOnly: true, sameSite: 'Lax', path: '/' });

  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', sessionCookieStr);
  headers.append('Set-Cookie', clearStateCookie);
  return new Response(null, { status: 302, headers });
}

async function handleDiscordMe(request, env) {
  const { SESSION_SECRET, DISCORD_ALLOWED_ROLE_IDS } = env;
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token || !SESSION_SECRET) {
    return jsonResponse({ authenticated: false });
  }
  const session = await verifySessionToken(SESSION_SECRET, token);
  if (!session) return jsonResponse({ authenticated: false });

  const allowedRoles = (DISCORD_ALLOWED_ROLE_IDS || '').split(',').map((r) => r.trim()).filter(Boolean);
  const hasRole = allowedRoles.length === 0 || (session.roles || []).some((r) => allowedRoles.includes(r));

  return jsonResponse({
    authenticated: true,
    userId: session.userId,
    username: session.username,
    avatar: session.avatar || null,
    isMember: session.isMember,
    hasRole,
    roles: session.roles || []
  });
}

async function handleDiscordLogout(request) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const clearCookie = serializeCookie(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...JSON_HEADERS, 'Set-Cookie': clearCookie }
  });
}

// ─── Main worker entry router ──────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Handle CORS preflight check safely
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie'
        }
      });
    }

    // /api/hotspots → Durable Object
    if (pathname === '/api/hotspots') {
      if (!env.HOTSPOT_STORE) {
        return jsonResponse({ error: 'HOTSPOT_STORE binding is missing.' }, 500);
      }
      try {
        const id = env.HOTSPOT_STORE.idFromName('den-hotspots');
        const stub = env.HOTSPOT_STORE.get(id);
        return await stub.fetch(request);
      } catch (err) {
        return jsonResponse({ error: `Hotspot store unavailable: ${err?.message || 'Unknown error'}` }, 500);
      }
    }

    // /api/aquarium/shrimp-clips
    if (pathname === '/api/aquarium/shrimp-clips') {
      if (env.GOOGLE_DRIVE_API_KEY && env.GOOGLE_DRIVE_SHRIMP_FOLDER_ID) {
        return googleDriveShrimpClips(env);
      }
      return localShrimpClips(env);
    }

    // /api/aquarium/shrimp-clip/:id
    if (pathname.startsWith('/api/aquarium/shrimp-clip/')) {
      const fileId = pathname.slice('/api/aquarium/shrimp-clip/'.length);
      return proxyShrimpClip(env, fileId);
    }

    // Discord OAuth Endpoints
    if (pathname === '/api/discord/auth') return handleDiscordAuth(request, env);
    if (pathname === '/api/discord/callback') return handleDiscordCallback(request, env);
    if (pathname === '/api/discord/me') return handleDiscordMe(request, env);
    if (pathname === '/api/discord/logout') return handleDiscordLogout(request, env);

    // Legacy / misc API routes
    if (pathname === '/api/health') return jsonResponse({ status: 'healthy', timestamp: Date.now() });
    if (pathname === '/api/data') return jsonResponse({ message: 'Data payload' });
    if (pathname === '/api/barrelroll') return jsonResponse({ action: 'do_a_barrel_roll' });
    if (pathname === '/api/musickit-token') return jsonResponse({ token: 'DEVELOPER_TOKEN_HERE' });

    // All other paths (including unknown /api/* routes) → ASSETS
    return serveAsset(request, env, pathname);
  }
};
