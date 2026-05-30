export async function onRequest(context) {
  const { env } = context;

  // 1. Handle CORS Preflight requests if the frontend fetches this endpoint
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const clientId = env.DISCORD_CLIENT_ID;
  const redirectUri = env.DISCORD_REDIRECT_URI; 
  
  if (!clientId || !redirectUri) {
    return new Response(
      JSON.stringify({ error: "Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI in env configuration." }),
      { 
        status: 500, 
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*" 
        } 
      }
    );
  }

  // Define the response type string cleanly
  const RESPONSE_TYPE_CODE = "code";

  // 2. Construct the official Discord OAuth2 URL
  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", clientId);
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("response_type", RESPONSE_TYPE_CODE);
  discordAuthUrl.searchParams.set("scope", "identify email");

  // 3. Perform a clean 302 Redirect with standard headers
  return new Response(null, {
    status: 302,
    headers: {
      "Location": discordAuthUrl.toString(),
      "Access-Control-Allow-Origin": "*",
    },
  });
}
