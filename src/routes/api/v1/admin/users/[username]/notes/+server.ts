import type { RequestHandler } from './$types';
import {
	created,
	readJson,
	requireStaff,
	stringField,
	usernameParam,
	v1
} from '#lib/server/api.js';
import { addNote } from '#lib/server/admin.js';

/** Staff: leaves a note (`{ note }`) on the account for the other staff, in the moderation log. */
export const POST: RequestHandler = v1(async ({ locals, params, request }) => {
	requireStaff(locals);
	return created(
		await addNote(
			locals,
			usernameParam(params.username),
			stringField(await readJson(request), 'note')
		)
	);
});
