import type { RequestHandler } from './$types';
import { v1 } from '#lib/server/api.js';
import { MAX_BOTS, MAX_PROFILE_UPDATES } from '#lib/server/bots.js';
import { registrationOpen } from '#lib/server/login.js';
import { getMotd } from '#lib/server/motd.js';
import { membersOnly } from '#lib/server/membersOnly.js';
import { gifConfig } from '#lib/server/gifs.js';
import { LIMITS } from '#lib/server/validation.js';
import { version } from '$app/env';

/** Public facts about this instance: the message of the day, whether signing up is open, limits. */
export const GET: RequestHandler = v1(async ({ locals }) => ({
	api_version: 1,
	version,
	// a members-only instance keeps even its message of the day to the people signed in
	motd: membersOnly() && !locals.user ? '' : await getMotd(),
	registration_open: registrationOpen(),
	// true: everything but signing in and up needs a token or the session cookie
	members_only: membersOnly(),
	limits: { ...LIMITS, maxBots: MAX_BOTS, maxProfileUpdates: MAX_PROFILE_UPDATES },
	// what clients need to search KLIPY for GIFs themselves, null when GIFs are off
	gifs: gifConfig()
}));
