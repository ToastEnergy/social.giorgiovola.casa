import type { RequestHandler } from './$types';
import { fail, rateLimit, readJson, requireUser, usernameParam, v1 } from '#lib/server/api.js';
import { profileIdsNamed, requestProfileIds } from '#lib/server/accountProfiles.js';
import { markSeen } from '#lib/server/notifications.js';
import { parseId } from '#lib/server/validation.js';

const MAX_IDS = 100;

/** A list of post ids, deduplicated; a 400 for anything else. */
function ids(body: Record<string, unknown>, field: string) {
	const value = body[field];
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_IDS)
		fail(400, `${field} must be a list of at most ${MAX_IDS} post ids`);
	return [
		...new Set(value.map((v) => parseId(v) ?? fail(400, `${field} must only hold post ids`)))
	];
}

const MAX_FOLLOWERS = 20;

/** Usernames of profiles whose followers list was opened; a 400 for anything else. */
function usernames(body: Record<string, unknown>, field: string) {
	const value = body[field];
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		value.length > MAX_FOLLOWERS ||
		value.some((v) => typeof v !== 'string' || v.length > 40)
	)
		fail(400, `${field} must be a list of at most ${MAX_FOLLOWERS} usernames`);
	return [...new Set((value as string[]).map(usernameParam))];
}

function flag(body: Record<string, unknown>, field: string) {
	const value = body[field];
	if (value === undefined) return false;
	if (typeof value !== 'boolean') fail(400, `${field} must be true or false`);
	return value;
}

/** What you have seen: the notifications about it are read, for all your profiles. */
export const POST: RequestHandler = v1(async ({ locals, request }) => {
	const user = requireUser(locals);
	// called every few seconds while scrolling: per account, generous
	rateLimit(`seen:${locals.accountId ?? `bot${user.id}`}`, 120);
	const body = await readJson(request);
	const profiles = await requestProfileIds(locals);
	const followers = usernames(body, 'followers');
	// only the account's own profiles: others' followers aren't its business
	const followerIds = await profileIdsNamed(followers, profiles);
	const read = await markSeen(profiles, {
		posts: ids(body, 'posts'),
		engagement: ids(body, 'engagement'),
		followers: followerIds,
		invites: flag(body, 'invites')
	});
	return { read };
});
