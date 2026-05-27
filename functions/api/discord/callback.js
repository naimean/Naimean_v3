export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // 1. Handle cases where the user canceled the login or Discord errored out
  if (error) {
    return RedirectToFrontend(url.origin, `error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return new Response(
      JSON.stringify({ error: "Missing authorization code from Discord." }), 
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // 2. Exchange the authorization code for an access token
    // Note: Make sure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set in your Cloudflare dashboard env variables
    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `${url.origin}/api/discord/callback`,
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      return new Response(
        JSON.stringify({ error: "Failed to exchange OAuth code", details: errorData }), 
        { status: tokenResponse.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const tokens = await tokenResponse.json();

    // 3. (Optional) Fetch the user's profile info to verify identity or save to D1
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });
    
    const userData = await userResponse.json();

    // --- YOUR LOGIC HERE ---
    // You can generate a JWT session cookie, save the user to your D1 database, etc.
    // -----------------------

    // 4. Redirect the user back to your beautiful UI instead of showing raw JSON
    // Modifying this to redirect back to '/' or wherever your front-end state handles login
    return RedirectToFrontend(url.origin, `login=success&username=${encodeURIComponent(userData.username)}`);

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal Server Error during authentication", message: err.message }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Helper function to build a clean redirect back to your main site layout
function RedirectToFrontend(origin, queryString) {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': `${origin}/?${queryString}`,
      'Cache-Control': 'no-cache',
    },
  });
}
