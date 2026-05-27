import { exchangeCodeForToken } from '../../_utils/discord-oauth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  // 1. Handle errors sent back from Discord
  if (error) {
    return new Response(`Discord OAuth Error: ${error} - ${errorDescription}`, { status: 400 });
  }

  if (!code) {
    return new Response('Missing authorization code from Discord', { status: 400 });
  }

  try {
    // 2. Exchange the temporary code for a secure access token
    const tokenData = await exchangeCodeForToken(env, request, code);

    if (tokenData.error) {
      return new Response(`Token Exchange Failed: ${tokenData.error_description || tokenData.error}`, { status: 400 });
    }

    // 3. Fetch user profile data using the access token
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    // For debugging/initial setup: Return the user's data to confirm success
    return new Response(JSON.stringify({
      message: "Login Successful!",
      user: {
        id: userData.id,
        username: userData.username,
        global_name: userData.global_name,
        email: userData.email
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
  }
}
