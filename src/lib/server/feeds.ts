import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { Post, User } from '#lib/types.js';
import { db, likes, posts, regiorgs, users } from './db/index.js';
import { followedAuthors, getPinnedId, getPosts, getTimeline } from './posts.js';

/** Lists of posts: every function returns `limit + 1` rows, the extra one tells there is more. */

type Viewer = Pick<User, 'id'> | null;

export type Feed = 'all' | 'following';

/**
 * The home timeline. "all" already has every post, so only the following feed brings in
 * regiorgs; "all" still says who regiorged each post (`regiorged_by`: the latest regiorger and
 * how many others). The posts staff pinned to the timeline sit above both feeds, so they are left
 * out.
 */
export async function homeTimeline(feed: Feed, viewer: Viewer, limit: number, offset: number) {
	if (feed === 'following' && viewer)
		return getTimeline({
			loggedUser: viewer,
			authors: followedAuthors(viewer.id),
			excludeReplies: true,
			excludeTimelinePinned: true,
			limit: limit + 1,
			offset
		});
	return withLatestRegiorger(
		await getPosts({
			loggedUser: viewer,
			excludeReplies: true,
			excludeTimelinePinned: true,
			order: 'DESC',
			limit: limit + 1,
			offset
		})
	);
}

/** Sets `regiorged_by` to the latest regiorger of each post, with how many others regiorged it. */
async function withLatestRegiorger(found: Post[]): Promise<Post[]> {
	const ids = found.filter((p) => p.regiorgs > 0).map((p) => p.id);
	if (!ids.length) return found;
	const latest = await db
		.selectDistinctOn([regiorgs.post_id], {
			post_id: regiorgs.post_id,
			username: users.username,
			name: users.name
		})
		.from(regiorgs)
		.innerJoin(users, eq(users.id, regiorgs.user_id))
		.where(inArray(regiorgs.post_id, ids))
		.orderBy(regiorgs.post_id, desc(regiorgs.created_at), desc(regiorgs.user_id));
	const byPost = new Map(latest.map((r) => [r.post_id, r]));
	return found.map((post) => {
		const r = byPost.get(post.id);
		if (!r) return post;
		const regiorged_by = {
			username: r.username,
			name: r.name ?? r.username,
			others: post.regiorgs - 1
		};
		return { ...post, regiorged_by };
	});
}

export type ProfileTab = 'posts' | 'replies' | 'regiorgs';

/**
 * A profile's own posts (the pinned post left out: it sits above them), its replies or the posts
 * it regiorged, latest regiorg first. Null when the profile doesn't exist.
 */
export async function profilePosts(
	username: string,
	tab: ProfileTab,
	viewer: Viewer,
	limit: number,
	offset: number
): Promise<Post[] | null> {
	const [profile] = await db
		.select({
			id: users.id,
			username: users.username,
			name: users.name,
			pinned: users.pinned_post_id
		})
		.from(users)
		.where(eq(users.username, username));
	if (!profile) return null;
	if (tab === 'regiorgs') {
		const by = { username: profile.username, name: profile.name ?? profile.username };
		return regiorgedBy(profile.id, by, viewer, limit, offset);
	}
	if (tab === 'replies')
		return getPosts({
			loggedUser: viewer,
			fromUser: { id: profile.id },
			where: isNotNull(posts.reply_to),
			order: 'DESC',
			limit: limit + 1,
			offset
		});
	return getPosts({
		loggedUser: viewer,
		fromUser: { id: profile.id },
		where: and(
			isNull(posts.reply_to),
			profile.pinned != null ? ne(posts.id, profile.pinned) : undefined
		),
		order: 'DESC',
		limit: limit + 1,
		offset
	});
}

/** The posts a profile regiorged, latest regiorg first, each with `regiorged_by` set to it. */
async function regiorgedBy(
	userId: number,
	by: { username: string; name: string },
	viewer: Viewer,
	limit: number,
	offset: number
): Promise<Post[]> {
	const entries = await db
		.select({ post_id: regiorgs.post_id })
		.from(regiorgs)
		.where(eq(regiorgs.user_id, userId))
		.orderBy(desc(regiorgs.created_at), desc(regiorgs.post_id))
		.limit(limit + 1)
		.offset(offset);
	if (!entries.length) return [];
	const found = await getPosts({
		loggedUser: viewer,
		where: inArray(
			posts.id,
			entries.map((e) => e.post_id)
		)
	});
	const byId = new Map(found.map((p) => [p.id, p]));
	return entries.flatMap((e): Post[] => {
		const post = byId.get(e.post_id);
		if (!post) return [];
		return [{ ...post, regiorged_by: by }];
	});
}

/** The post pinned to a profile; undefined when the profile doesn't exist. */
export async function pinnedPost(username: string, viewer: Viewer) {
	const [profile] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.username, username));
	if (!profile) return undefined;
	const id = await getPinnedId(profile.id);
	if (id === null) return null;
	const [post] = await getPosts({ loggedUser: viewer, postId: id });
	return post ?? null;
}

export const hashtagPosts = (tag: string, viewer: Viewer, limit: number, offset: number) =>
	getPosts({ loggedUser: viewer, hashtag: tag, order: 'DESC', limit: limit + 1, offset });

/** Replies to a post: the ones that ratio it first, then oldest first. */
export const postReplies = (postId: number, viewer: Viewer, limit: number, offset: number) =>
	getPosts({
		loggedUser: viewer,
		reply_to: postId,
		order: 'ASC',
		ratioFirst: true,
		limit: limit + 1,
		offset
	});

export async function getPost(postId: number, viewer: Viewer) {
	const [post] = await getPosts({ loggedUser: viewer, postId });
	return post ?? null;
}

const postExists = async (postId: number) => (await db.$count(posts, eq(posts.id, postId))) > 0;

const profileColumns = { username: users.username, name: users.name, avatar: users.avatar };

/** Who liked a post, latest first. Null when the post doesn't exist. */
export async function postLikes(postId: number, limit: number, offset: number) {
	if (!(await postExists(postId))) return null;
	return db
		.select(profileColumns)
		.from(likes)
		.innerJoin(users, eq(users.id, likes.user_id))
		.where(eq(likes.post_id, postId))
		.orderBy(desc(likes.created_at), desc(likes.user_id))
		.limit(limit + 1)
		.offset(offset);
}

/** Who regiorged a post, latest first. */
export async function postRegiorgs(postId: number, limit: number, offset: number) {
	if (!(await postExists(postId))) return null;
	return db
		.select(profileColumns)
		.from(regiorgs)
		.innerJoin(users, eq(users.id, regiorgs.user_id))
		.where(eq(regiorgs.post_id, postId))
		.orderBy(desc(regiorgs.created_at), desc(regiorgs.user_id))
		.limit(limit + 1)
		.offset(offset);
}

/** The quote regiorgs of a post, latest first: who quoted it and what they wrote. */
export async function postQuotes(postId: number, limit: number, offset: number) {
	if (!(await postExists(postId))) return null;
	return db
		.select({ id: posts.id, content: posts.content, ...profileColumns })
		.from(posts)
		.innerJoin(users, eq(users.id, posts.user_id))
		.where(eq(posts.quote_of, postId))
		.orderBy(desc(posts.created_at), desc(posts.id))
		.limit(limit + 1)
		.offset(offset);
}
