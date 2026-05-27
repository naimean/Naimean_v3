import { handleDiscordCallbackRequest } from '../../_utils/discord-oauth.js';

export function onRequest(context) {
  return handleDiscordCallbackRequest(context.request);
}
