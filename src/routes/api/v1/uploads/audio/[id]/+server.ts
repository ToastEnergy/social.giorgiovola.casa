import type { RequestHandler } from './$types';
import { requireUser, v1 } from '#lib/server/api.js';
import { audioUploadStatus } from '#lib/server/stagedAudio.js';

/** The status of one of your voice note uploads: receiving, processing, ready, failed or sent. */
export const GET: RequestHandler = v1(({ locals, params }) =>
	audioUploadStatus(requireUser(locals).id, params.id)
);
