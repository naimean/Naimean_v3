import { fetchDiscordUserFromCode } from './discord-user.js';

const DISCORD_GUEST_INVITE_URL = 'https://discord.gg/kTkD7N3JN';
const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_AUTH_COMPLETE_PARAM = 'discord_auth_complete';
const DEFAULT_DISCORD_CALLBACK_PATH = '/api/discord/callback';

function getCallbackPath(env) {
  const configuredPath = typeof env.DISCORD_CALLBACK_PATH === 'string'
    ? env.DISCORD_CALLBACK_PATH.trim()
    : '';
  return configuredPath.startsWith('/') ? configuredPath : DEFAULT_DISCORD_CALLBACK_PATH;
}

function getRedirectUri(url, env) {
  const configuredRedirectUri = typeof env.DISCORD_REDIRECT_URI === 'string'
    ? env.DISCORD_REDIRECT_URI.trim()
    : '';
  return configuredRedirectUri || `${url.origin}${getCallbackPath(env)}`;
}

export function handleDiscordAuthRequest(request, env) {
  const clientId = env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(DISCORD_GUEST_INVITE_URL, 302);
  }

  const url = new URL(request.url);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(url, env),
    response_type: 'code',
    scope: 'identify',
  });

  return Response.redirect(`${DISCORD_OAUTH_AUTHORIZE_URL}?${params.toString()}`, 302);
}

export async function handleDiscordCallbackRequest(request, env) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error || !url.searchParams.get('code')) {
    return Response.redirect(`${url.origin}/`, 302);
  }

  const params = new URLSearchParams({
    [DISCORD_AUTH_COMPLETE_PARAM]: '1',
  });

  try {
    const discordUser = await fetchDiscordUserFromCode(url, env, getRedirectUri);
    if (discordUser) {
      params.set('login', 'success');
      params.set('discord_username', discordUser.username);
      params.set('discord_display_name', discordUser.displayName);
      params.set('discord_user_id', discordUser.userId);
      params.set('discord_discriminator', discordUser.discriminator);
      params.set('discord_avatar_url', discordUser.avatarUrl);
      params.set('username', discordUser.username);
    }
  } catch {
    // Fall back to auth-complete redirect only.
  }

  return Response.redirect(`${url.origin}/?${params.toString()}`, 302);
}
