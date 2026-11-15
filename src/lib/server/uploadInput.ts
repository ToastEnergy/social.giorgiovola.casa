import { fail, rateLimit } from './api.js';

/**
 * An image sent as a request body: the raw bytes (what non-browser clients should do, since
 * SvelteKit refuses multipart forms without a matching Origin), or multipart with the file in one
 * of `fields` (browsers).
 */
export const readImageBody = (request: Request, maxBytes: number, fields: string[]) =>
	readUploadBody(request, maxBytes, fields, 'image');

/** A file sent as a request body, like readImageBody; `noun` names it in errors. */
export async function readUploadBody(
	request: Request,
	maxBytes: number,
	fields: string[],
	noun: string
) {
	const type = request.headers.get('content-type') ?? '';
	const Noun = noun[0].toUpperCase() + noun.slice(1);
	const tooBig = () =>
		fail(413, `${Noun} too big, max size is ${Math.round(maxBytes / 1024 / 1024)}mb`);
	if (Number(request.headers.get('content-length')) > maxBytes + 64 * 1024) tooBig();
	let buffer: Buffer;
	if (type.startsWith('multipart/form-data')) {
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			fail(400, 'Upload too big or invalid');
		}
		const file = fields.map((f) => form.get(f)).find((f): f is File => f instanceof File);
		if (!file || file.size === 0)
			fail(400, `Missing ${noun}: send it as the body or in a "${fields[0]}" field`);
		buffer = Buffer.from(await file.arrayBuffer());
	} else {
		buffer = Buffer.from(await request.arrayBuffer());
		if (buffer.length === 0) fail(400, `Missing ${noun}, send it as the request body`);
	}
	if (buffer.length > maxBytes) tooBig();
	return buffer;
}

// a post or message holds at most 5 images; this leaves room for swapping some out
const MAX_UPLOADS = 30;

/**
 * Counts an upload (an image, a voice note or a voice note session) against the uploader's
 * limit, before the body is read so a client over it doesn't get its bytes buffered. Per
 * account: its identities share the limit, so they can't multiply the work.
 */
export function countUpload(locals: App.Locals, userId: number) {
	rateLimit(
		`uploads:${locals.accountId ?? userId}`,
		MAX_UPLOADS,
		60_000,
		'You are uploading too fast'
	);
}
