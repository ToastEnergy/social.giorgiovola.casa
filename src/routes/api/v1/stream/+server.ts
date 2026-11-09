import type { RequestHandler } from './$types';
import { clientIp } from '#lib/server/ratelimit.js';
import { openStream, streamOwner, tooManyStreams } from '#lib/server/realtime.js';

const SSE_HEADERS = {
	'Content-Type': 'text/event-stream; charset=utf-8',
	'Cache-Control': 'no-cache, no-transform',
	'X-Accel-Buffering': 'no'
};

/**
 * Server-sent events: new posts, deletions, edits, counts and polls for everyone, plus your
 * unread counts, direct and group messages, reactions and typing when signed in (token or
 * cookie). Anonymous streams get the public events only. 429 when the account (or bot, or IP
 * address) already has too many streams open.
 */
export const GET: RequestHandler = ({ locals, request, getClientAddress }) => {
	const userId = locals.user?.id ?? null;
	const botId = locals.auth === 'bot' ? userId : null;
	const owner = streamOwner(locals, clientIp(getClientAddress));
	const body = openStream(userId, locals.sessionKey, botId, owner, request.signal);
	return body ? new Response(body, { headers: SSE_HEADERS }) : tooManyStreams();
};
