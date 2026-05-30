const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store'
};
const DEFAULT_OAUTH_SCOPE = 'identify email';

type DiscordAuthContext = {
  request: Request;
  env: {
    DISCORD_CLIENT_ID?: string;
    DISCORD_REDIRECT_URI?: string;
    DISCORD_OAUTH_SCOPE?: string;
  };
};

export async function onRequest(context: DiscordAuthContext) {
  const { request, env } = context;

  if (request.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed.' }),
      {
        status: 405,
        headers: {
          ...JSON_HEADERS,
          allow: 'GET'
        }
      }
    );
  }

  const clientId = env.DISCORD_CLIENT_ID;
  const redirectUri = env.DISCORD_REDIRECT_URI;
  const scope = env.DISCORD_OAUTH_SCOPE?.trim() || DEFAULT_OAUTH_SCOPE;

  const missing = [
    !clientId ? 'DISCORD_CLIENT_ID' : null,
    !redirectUri ? 'DISCORD_REDIRECT_URI' : null
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    return new Response(
      JSON.stringify({
        error: `Missing required environment variable(s): ${missing.join(', ')}`
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize');
  discordAuthUrl.searchParams.set('client_id', clientId);
  discordAuthUrl.searchParams.set('redirect_uri', redirectUri);
  discordAuthUrl.searchParams.set('response_type', 'code');
  discordAuthUrl.searchParams.set('scope', scope);

  return Response.redirect(discordAuthUrl.toString(), 302);
}
