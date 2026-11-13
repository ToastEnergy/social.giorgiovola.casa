import type { RequestHandler } from './$types';
import { v1 } from '#lib/server/api.js';
import { checkInvite } from '#lib/server/login.js';

/** Public: whether an invite code can be used, and who it is from. 404 when it can't. */
export const GET: RequestHandler = v1(async ({ params, getClientAddress }) =>
	checkInvite(params.code, getClientAddress)
);
