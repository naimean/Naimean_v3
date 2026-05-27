const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function buildDiscordAvatarUrl(userData) {
  const userId = typeof userData?.id === 'string' ? userData.id : '';
  const avatarHash = typeof userData?.avatar === 'string' ? userData.avatar : '';
  if (userId && avatarHash) {
    return `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=128`;
  }

  const discriminator = typeof userData?.discriminator === 'string' ? userData.discriminator : '';
  let fallbackAvatarIndex = 0;
  if (/^\d+$/.test(discriminator) && discriminator !== '0') {
    fallbackAvatarIndex = Number.parseInt(discriminator, 10) % 6;
  } else if (/^\d+$/.test(userId)) {
    fallbackAvatarIndex = Number(BigInt(userId) % 6n);
  }
  return `https://cdn.discordapp.com/embed/avatars/${fallbackAvatarIndex}.png`;
}

export async function fetchDiscordUserFromCode(url, env, getRedirectUri) {
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
