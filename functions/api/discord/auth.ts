export async function onRequest(context) {
  const { env } = context;

  // Grab your environment variables setup in Cloudflare
  const clientId = env.DISCORD_CLIENT_ID;
  const redirectUri = env.DISCORD_REDIRECT_URI; 
  
  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({ error: "Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI in env configuration." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Construct the official Discord OAuth2 URL
  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", clientId);
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("response_type", "code"); // Fixed: added quotes around "code"
  discordAuthUrl.searchParams.set("scope", "identify email");

  // Perform a 302 Redirect to send the user to Discord's login screen
  return Response.redirect(discordAuthUrl.toString(), 302);
}
