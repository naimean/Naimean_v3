const DISCORD_GUEST_INVITE_URL = 'https://discord.gg/kTkD7N3JN';
const DISCORD_OAUTH_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
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

function buildDiscordAvatarUrl(userData) {
  const userId = typeof userData?.id === 'string' ? userData.id : '';
  const avatarHash = typeof userData?.avatar === 'string' ? userData.avatar : '';
  if (userId && avatarHash) {
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=128`;
  }

  const discriminator = typeof userData?.discriminator === 'string' ? userData.discriminator : '';
  let fallbackAvatarIndex = 0;
  if (/^\d+$/.test(discriminator) && discriminator !== '0') {
    fallbackAvatarIndex = Number.parseInt(discriminator, 10) % 5;
  } else if (/^\d+$/.test(userId)) {
    fallbackAvatarIndex = Number(BigInt(userId) % 6n);
  }
  return `https://cdn.discordapp.com/embed/avatars/${fallbackAvatarIndex}.png`;
}

async function fetchDiscordUserFromCode(url, env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    return null;
  }

  const tokenResponse = await fetch(`${DISCORD_API_BASE_URL}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      redirect_uri: getRedirectUri(url, env),
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  if (!tokenResponse.ok) {
    return null;
  }

  const tokenData = await tokenResponse.json();
  const accessToken = typeof tokenData?.access_token === 'string' ? tokenData.access_token : '';
  if (!accessToken) {
    return null;
  }

  const userResponse = await fetch(`${DISCORD_API_BASE_URL}/users/@me`, {
    headers: {
      Authorization: 'Bearer ' + accessToken,
    },
  });
  if (!userResponse.ok) {
    return null;
  }

  const userData = await userResponse.json();
  const username = typeof userData?.username === 'string' ? userData.username.trim() : '';
  if (!username) {
    return null;
  }

  const displayName = typeof userData?.global_name === 'string'
    ? userData.global_name.trim()
    : '';
  const userId = typeof userData?.id === 'string' ? userData.id.trim() : '';
  const discriminator = typeof userData?.discriminator === 'string'
    ? userData.discriminator.trim()
    : '';

  return {
    username,
    displayName,
    userId,
    discriminator,
    avatarUrl: buildDiscordAvatarUrl(userData),
  };
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
    const discordUser = await fetchDiscordUserFromCode(url, env);
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
