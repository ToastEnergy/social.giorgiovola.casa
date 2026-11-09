import type { RequestHandler } from './$types';
import { botHandler } from '#lib/server/bots.js';
import { openBotStream, tooManyStreams } from '#lib/server/realtime.js';

/**
 * Server-sent events for bots: `mention` for posts mentioning the bot or replying to it, `post`
 * for posts by profiles it follows. A post can be both. Missed events can be caught up with
 * /api/bot/mentions and /api/bot/feed.
 */
export const GET: RequestHandler = botHandler(({ user }, { request }) => {
	const body = openBotStream(user, request.signal);
	if (!body) return tooManyStreams();
	return new Response(body, {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no'
		}
	});
});
