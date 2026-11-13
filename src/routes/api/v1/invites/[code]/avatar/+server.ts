import type { RequestHandler } from './$types';
import { fail, v1 } from '#lib/server/api.js';
import { checkInvite } from '#lib/server/login.js';
import { avatarFileOf, readAvatarFile } from '#lib/server/avatarFile.js';
import { generateAvatar } from '#lib/server/avatar.js';
import { avatarSize } from '#lib/server/avatarSize.js';

// tied to the code, which stops working once used, revoked or expired: never a shared cache
const headers = { 'Cache-Control': 'private, max-age=600' };

/**
 * Public: the picture of whoever made an invite code, for the sign up page. On a members-only
 * instance avatars need a session, which someone signing up doesn't have yet. 404 like
 * GET /invites/:code when the code can't be used.
 */
export const GET: RequestHandler = v1(async ({ params, url, getClientAddress }) => {
	const { inviter } = await checkInvite(params.code, getClientAddress);
	if (!inviter) fail(404, 'This invite has no inviter.');
	const file = avatarFileOf(inviter.avatar);
	if (file) {
		const avatar = await readAvatarFile(file);
		if (avatar)
			return new Response(avatar.body, { headers: { ...headers, 'Content-Type': avatar.type } });
	}
	const size = avatarSize(url.searchParams.get('size'), 128);
	return new Response(generateAvatar(inviter.username, size), {
		headers: { ...headers, 'Content-Type': 'image/svg+xml' }
	});
});
