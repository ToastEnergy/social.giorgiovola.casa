import type { RequestHandler } from './$types';
import { fail, rateLimit, readJson, requireAccount, v1 } from '#lib/server/api.js';
import { accountProfileIds } from '#lib/server/accountProfiles.js';
import { staleTags } from '#lib/server/notificationTags.js';

const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 100;

/** Which of the push tags (a phone's or browser's tray) have nothing unread left. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const { accountId } = requireAccount(locals);
	rateLimit(`stale:${accountId}`, 60);
	const { tags } = await readJson(request);
	if (
		!Array.isArray(tags) ||
		tags.length > MAX_TAGS ||
		tags.some((t) => typeof t !== 'string' || t.length > MAX_TAG_LENGTH)
	)
		fail(
			400,
			`tags must be a list of at most ${MAX_TAGS} strings of up to ${MAX_TAG_LENGTH} characters`
		);
	return {
		stale: await staleTags(await accountProfileIds(accountId), [...new Set(tags as string[])])
	};
});
