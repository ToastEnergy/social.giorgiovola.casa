import type { PageLoad } from './$types';
import type { Page } from '#lib/api.js';
import { apiGet, loadAs } from '#lib/apiLoad.js';
import { cachedPage } from '#lib/pageCache.js';
import type { FollowedBy, Post } from '#lib/types.js';

const PAGE_SIZE = 10;

type Profile = {
	username: string;
	name: string;
	avatar: string | null;
	bot: boolean;
	bio: string;
	website: string;
	followers: number;
	following: number;
	followed: boolean;
	self: boolean;
	followedBy: FollowedBy;
	created_at: string;
	moderation: {
		banned: boolean;
		muted: boolean;
		ban_reason: string | null;
		mute_reason: string | null;
		banned_until: string | null;
		muted_until: string | null;
		identity: boolean;
	} | null;
};

// universal, so back and forward can show it from the cache (#lib/pageCache.ts)
export const load = (async ({ params, fetch, depends, url, parent }) => {
	depends('app:posts');
	// ?as=: followed and liked as another of your profiles. the cache is keyed by url
	return cachedPage(url, async () =>
		loadProfile(params.username, url, fetch, await loadAs(url, parent))
	);
}) satisfies PageLoad;

async function loadProfile(
	username: string,
	url: URL,
	fetch: typeof globalThis.fetch,
	as: string | null
) {
	const name = encodeURIComponent(username.toLowerCase());
	const asked = url.searchParams.get('tab');
	const tab = asked === 'replies' || asked === 'regiorgs' ? asked : 'posts';
	const source = `/api/v1/users/${name}/posts?tab=${tab}&limit=${PAGE_SIZE}`;
	const [profile, page, pinned] = await Promise.all([
		apiGet<Profile>(fetch, `/users/${name}`, { login: false, as }),
		apiGet<Page<Post>>(fetch, source.slice('/api/v1'.length), { login: false, as }),
		tab === 'posts'
			? apiGet<{ post: Post | null }>(fetch, `/users/${name}/pinned`, { login: false, as })
			: { post: null }
	]);
	return {
		user: {
			name: profile.name,
			username: profile.username,
			avatar: profile.avatar,
			created_at: profile.created_at
		},
		bio: profile.bio,
		bot: profile.bot,
		website: profile.website,
		tab,
		posts: page.items,
		next: page.next_cursor,
		source,
		pinned: pinned.post,
		follow: {
			followers: profile.followers,
			following: profile.following,
			followed: profile.followed
		},
		followedBy: profile.followedBy,
		moderation: profile.moderation,
		self: profile.self
	};
}
