import { handleDiscordAuthRequest } from '../../_utils/discord-oauth.js';

export function onRequest(context) {
  return handleDiscordAuthRequest(context.request, context.env);
}
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(`Error: ${error}`, { status: 400 });
  }

  if (!code) {
    return new Response('No code provided', { status: 400 });
  }

  // Retrieve code_verifier from cookie (set during initial redirect)
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
  const codeVerifier = cookies['discord_code_verifier'];

  if (!codeVerifier) {
    return new Response('Missing code_verifier. Ensure cookies are enabled.', { status: 400 });
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: env.DISCORD_REDIRECT_URI || (url.origin + url.pathname),
      code_verifier: codeVerifier,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    return new Response(JSON.stringify(tokens), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Fetch user info to verify token
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  });
  const userData = await userResponse.json();

  // Return tokens and user data (In production, set a session cookie)
  return new Response(JSON.stringify({ tokens, user: userData }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
