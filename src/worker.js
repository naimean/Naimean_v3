// ============================================================================
// FILE: src/worker.js (Main API Entry-Point Router)
// Description: Main router handling apex /api/ routing and forwarding
// ============================================================================

// Import your OAuth handlers from where Copilot structured them
import { handleDiscordAuth } from './discord/auth.js'; 

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // 2. Route Matching Layer
    switch (url.pathname) {
      case '/api/health':
        return new Response(JSON.stringify({ status: "healthy", timestamp: Date.now() }), {
          headers: { "Content-Type": "application/json" }
        });

      case '/api/data':
        return new Response(JSON.stringify({ message: "Data payload" }), {
          headers: { "Content-Type": "application/json" }
        });

      case '/api/barrelroll':
        return new Response(JSON.stringify({ action: "do_a_barrel_roll" }), {
          headers: { "Content-Type": "application/json" }
        });

      case '/api/musickit-token':
        return new Response(JSON.stringify({ token: "DEVELOPER_TOKEN_HERE" }), {
          headers: { "Content-Type": "application/json" }
        });

      // WIRE IN THE DISCORD ENDPOINT HERE
      case '/api/discord/auth':
        try {
          return await handleDiscordAuth(request, env);
        } catch (err) {
          // If your helper from PR #292 is global, use it here, otherwise fallback safely
          return new Response(JSON.stringify({ error: "Internal Auth Error", details: err.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }

      // 3. Fallback Catch-All
      default:
        return new Response(
          JSON.stringify({
            error: "endpoint not found - use /api/health, /api/data, /api/barrelroll, /api/musickit-token, or /api/discord/auth"
          }),
          { 
            status: 404, 
            headers: { "Content-Type": "application/json" } 
          }
        );
    }
  }
};
