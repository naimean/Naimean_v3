let discordAuthHandlerPromise;

async function getDiscordAuthHandler() {
  if (!discordAuthHandlerPromise) {
    discordAuthHandlerPromise = import('./discord/auth.js')
      .then((module) => module.handleDiscordAuth)
      .catch((error) => {
        console.warn('Failed to load Discord auth handler.', error);
        return null;
      });
  }
  return discordAuthHandlerPromise;
}

function isHtmlPath(pathname) {
  if (pathname.startsWith('/api/')) return false;
  const lastSegment = pathname.split('/').pop() || '';
  const hasFileExtension = lastSegment.includes('.');
  return pathname === '/' || pathname.endsWith('.html') || !hasFileExtension;
}

function applyAssetCacheHeaders(pathname, headers) {
  if (isHtmlPath(pathname)) {
    headers.set('cache-control', 'no-store');
    return;
  }
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {})
    }
  });
}

async function serveAsset(request, env, pathname) {
  if (!env.ASSETS?.fetch) {
    return jsonResponse({ error: 'Static assets unavailable.' }, { status: 500 });
  }

  const upstream = await env.ASSETS.fetch(request);
  const headers = new Headers(upstream.headers);
  applyAssetCacheHeaders(pathname, headers);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization'
        }
      });
    }

    switch (url.pathname) {
      case '/api/health':
        return jsonResponse({ status: 'healthy', timestamp: Date.now() });
      case '/api/data':
        return jsonResponse({ message: 'Data payload' });
      case '/api/barrelroll':
        return jsonResponse({ action: 'do_a_barrel_roll' });
      case '/api/musickit-token':
        return jsonResponse({ token: 'DEVELOPER_TOKEN_HERE' });
      case '/api/discord/auth': {
        const handleDiscordAuth = await getDiscordAuthHandler();
        if (!handleDiscordAuth) {
          return jsonResponse({ error: 'Discord auth handler is not configured.' }, { status: 503 });
        }
        try {
          return await handleDiscordAuth(request, env);
        } catch (err) {
          return jsonResponse({ error: 'Internal Auth Error' }, { status: 500 });
        }
      }
      default:
        if (url.pathname.startsWith('/api/')) {
          return jsonResponse(
            {
              error:
                'endpoint not found - use /api/health, /api/data, /api/barrelroll, /api/musickit-token, or /api/discord/auth'
            },
            { status: 404 }
          );
        }
        return serveAsset(request, env, url.pathname);
    }
  }
};
