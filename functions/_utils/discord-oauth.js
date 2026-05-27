export function getDiscordAuthUrl(env, request) {
  const url = new URL(request.url);
  
  // Force the redirect to use the /auth/ path instead of /api/
  const redirectUri = `${url.protocol}//${url.host}/auth/discord/callback`;
  
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(env, request, code) {
  const url = new URL(request.url);
  const redirectUri = `${url.protocol}//${url.host}/auth/discord/callback`;

  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
  });

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    body: params,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return response.json();
}
