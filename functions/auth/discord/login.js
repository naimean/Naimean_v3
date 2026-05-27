import { handleDiscordAuthRequest } from '../../_utils/discord-oauth.js';

export function onRequest(context) {
  return handleDiscordAuthRequest(context.request, context.env);
}
