import type { RequestHandler } from './$types';
import { readJson, stringField, v1 } from '#lib/server/api.js';
import { deleteGroupForEveryone, lookupGroup } from '#lib/server/admin.js';
import { parseId } from '#lib/server/validation.js';

/** Admins only: any group chat by id (name, owner, members, message count), members or not. */
export const GET: RequestHandler = v1(({ locals, params }) =>
	lookupGroup(locals, parseId(params.id))
);

/** Admins only: deletes the group with all its messages for everyone in it. `{ reason? }` */
export const DELETE: RequestHandler = v1(async ({ locals, params, request }) =>
	deleteGroupForEveryone(locals, parseId(params.id), stringField(await readJson(request), 'reason'))
);
