import type { RequestHandler } from './$types';
import { fail, requireUser, v1 } from '#lib/server/api.js';
import { discardStagedAudio } from '#lib/server/stagedAudio.js';
import { discardStaged } from '#lib/server/stagedUploads.js';

/** Deletes an upload that was removed before sending: an image, a voice note or its session. */
export const DELETE: RequestHandler = v1(async ({ locals, params }) => {
	const { id } = requireUser(locals);
	if (!discardStagedAudio(id, params.id) && !(await discardStaged(id, params.id)))
		fail(404, 'Upload not found');
});
