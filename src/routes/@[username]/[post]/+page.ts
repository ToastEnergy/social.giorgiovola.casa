import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { allPages, type Page } from '#lib/api.js';
import { apiGet } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import type { Post } from '#lib/types.js';

const MAX_REPLIES = 200;
const MAX_PARENTS = 20;

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ params, fetch, url }) => {
	if (!/^\d{1,10}$/.test(params.post)) error(404, 'Post not found');
	return cachedPage(url, () => loadPost(params.post, params.username, fetch));
}) satisfies PageLoad;

async function loadPost(id: string, username: string, fetch: typeof globalThis.fetch) {
	const post = await apiGet<Post>(fetch, `/posts/${id}`, { login: false });
	// the URL names the author: another username is another post
	if (post.user.username !== username.toLowerCase()) error(404, 'Post not found');

	return {
		post,
		streamed: {
			// the thread above a reply, shown over the post once it arrives. null when it couldn't
			// be loaded: the page falls back to the "Replying to" link
			parents: post.reply_to
				? apiGet<Page<Post>>(fetch, `/posts/${post.id}/ancestors?limit=${MAX_PARENTS}`, {
						login: false
				  }).then(
						(page) => page.items,
						() => null
				  )
				: Promise.resolve([] as Post[]),
			replies:
				post.replies_count > 0
					? allPages((cursor) =>
							apiGet<Page<Post>>(
								fetch,
								`/posts/${post.id}/replies?limit=${MAX_REPLIES}${
									cursor ? `&cursor=${cursor}` : ''
								}`,
								{ login: false }
							)
					  )
					: Promise.resolve([] as Post[])
		}
	};
}
