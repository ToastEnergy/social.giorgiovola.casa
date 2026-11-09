import type { RequestHandler } from './$types';
import { servePreview } from '#lib/server/previewImages.js';

// link preview images, stored at runtime like uploads (so adapter-node's static handler can't
// serve them). Public and immutable: named by a hash of the image's source URL
export const GET: RequestHandler = ({ params }) => servePreview(params.file);
