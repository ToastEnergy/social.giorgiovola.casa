import { and, desc, eq, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, posts, reports, users } from './db/index.js';
import { fail, rateLimit } from './api.js';
import {
	actionsLimited,
	canModerate,
	findTarget,
	findTargetById,
	isStaff,
	logAction
} from './moderation.js';
import { parseId } from './validation.js';

export const REPORT_CATEGORIES = [
	'spam',
	'harassment',
	'hate',
	'violence',
	'sexual',
	'self_harm',
	'impersonation',
	'other'
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const MAX_DETAILS = 1000;
const MAX_NOTE = 500;
// the copy of a reported post's text
const MAX_COPY = 2000;

/**
 * Reports a post (`post_id`) or a profile (`username`) to the staff. Reporting the same thing
 * twice while the first report is open answers the open one.
 */
export async function createReport(locals: App.Locals, body: Record<string, unknown>) {
	const user = locals.user!;
	if (locals.auth === 'bot') fail(403, "Bots can't report");
	const category = body.category;
	if (typeof category !== 'string' || !REPORT_CATEGORIES.includes(category as ReportCategory))
		fail(400, `category must be one of ${REPORT_CATEGORIES.join(', ')}`);
	if (body.details !== undefined && body.details !== null && typeof body.details !== 'string')
		fail(400, 'details must be a string');
	const details = ((body.details as string | null) ?? '').trim();
	if (details.length > MAX_DETAILS) fail(400, `details can be at most ${MAX_DETAILS} characters`);
	const hasPost = body.post_id !== undefined && body.post_id !== null;
	const hasUser = typeof body.username === 'string' && body.username !== '';
	if (hasPost === hasUser) fail(400, 'Send either post_id or username');

	let subject: {
		kind: 'post' | 'profile';
		target_id: number;
		post_id: number | null;
		copy: string | null;
	};
	if (hasPost) {
		const id = parseId(body.post_id);
		if (id === null) fail(400, 'post_id must be a post id');
		const [post] = await db
			.select({ user_id: posts.user_id, content: posts.content })
			.from(posts)
			.where(eq(posts.id, id));
		if (!post || post.user_id === null) fail(404, 'Post not found');
		subject = {
			kind: 'post',
			target_id: post.user_id,
			post_id: id,
			copy: post.content.slice(0, MAX_COPY)
		};
	} else {
		const [profile] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.username, String(body.username).replace(/^@/, '').toLowerCase()));
		if (!profile) fail(404, 'User not found');
		subject = { kind: 'profile', target_id: profile.id, post_id: null, copy: null };
	}

	// reporting yourself (any of your profiles) makes no sense
	const targetAccount = await accountIdOf(subject.target_id);
	if (targetAccount === (locals.accountId ?? user.id) || subject.target_id === user.id)
		fail(
			400,
			subject.kind === 'post' ? "You can't report your own post" : "You can't report yourself"
		);

	const [open] = await db
		.select({ id: reports.id })
		.from(reports)
		.where(
			and(
				eq(reports.reporter_id, user.id),
				eq(reports.status, 'open'),
				eq(reports.kind, subject.kind),
				subject.post_id !== null
					? eq(reports.post_id, subject.post_id)
					: eq(reports.target_id, subject.target_id)
			)
		)
		.limit(1);
	if (open)
		return { id: open.id, message: 'You already reported this, the staff will look at it.' };

	rateLimit(`reports:${locals.accountId ?? user.id}`, 10, 60 * 60_000, 'Too many reports');
	const [row] = await db
		.insert(reports)
		.values({
			reporter_id: user.id,
			target_id: subject.target_id,
			kind: subject.kind,
			post_id: subject.post_id,
			post_content: subject.copy,
			category,
			details
		})
		.returning({ id: reports.id });
	return { id: row.id, message: 'Thanks, the staff will look at it.' };
}

/** The account a profile belongs to: its owner for an identity. */
async function accountIdOf(profileId: number) {
	const [row] = await db
		.select({ id: users.id, owner_id: users.owner_id })
		.from(users)
		.where(eq(users.id, profileId));
	return row ? row.owner_id ?? row.id : null;
}

/** Reports of the same thing: the same post, or the same profile reported as a profile. */
const sameSubject = (r: {
	kind: string;
	post_id: number | null;
	target_id: number;
	id: number;
}): SQL =>
	r.kind === 'post'
		? r.post_id !== null
			? and(eq(reports.kind, 'post'), eq(reports.post_id, r.post_id))!
			: eq(reports.id, r.id)
		: and(eq(reports.kind, 'profile'), eq(reports.target_id, r.target_id))!;

/**
 * Reports for staff, newest first (`limit + 1` rows before the id `cursor`), by status ('all' for
 * every one) and, with `username`, only those against that account and its identities.
 */
export async function listReports(
	locals: App.Locals,
	{
		status,
		username,
		cursor,
		limit
	}: { status: ReportStatus | 'all'; username: string; cursor: number | null; limit: number }
) {
	const filters: (SQL | undefined)[] = [];
	if (status !== 'all') filters.push(eq(reports.status, status));
	if (cursor !== null) filters.push(lt(reports.id, cursor));
	if (username) {
		const owner = await findTarget(username);
		if (!owner) return [];
		filters.push(
			sql`${reports.target_id} IN (SELECT id FROM users WHERE id = ${owner.id} OR owner_id = ${owner.id})`
		);
	}

	const reporter = alias(users, 'reporter');
	const target = alias(users, 'target');
	const account = alias(users, 'account');
	const resolver = alias(users, 'resolver');
	const rows = await db
		.select({
			id: reports.id,
			kind: reports.kind,
			category: reports.category,
			details: reports.details,
			status: reports.status,
			created_at: reports.created_at,
			resolved_at: reports.resolved_at,
			resolution_note: reports.resolution_note,
			resolved_by: resolver.username,
			post_id: reports.post_id,
			post_content: reports.post_content,
			post_current: posts.content,
			post_images: posts.images,
			reporter: { username: reporter.username, name: reporter.name, avatar: reporter.avatar },
			target: { username: target.username, name: target.name, avatar: target.avatar },
			account: {
				id: account.id,
				username: account.username,
				role: account.role,
				banned_at: account.banned_at,
				muted_at: account.muted_at
			},
			// other open reports of the same thing
			related_open: sql<number>`(SELECT count(*)::int FROM reports o WHERE o.status = 'open'
				AND o.id != ${reports.id} AND o.kind = ${reports.kind}
				AND (CASE WHEN ${reports.kind} = 'post' THEN o.post_id = ${reports.post_id}
					ELSE o.target_id = ${reports.target_id} END))`
		})
		.from(reports)
		.innerJoin(reporter, eq(reporter.id, reports.reporter_id))
		.innerJoin(target, eq(target.id, reports.target_id))
		.innerJoin(account, eq(account.id, sql`COALESCE(${target.owner_id}, ${target.id})`))
		.leftJoin(resolver, eq(resolver.id, reports.resolved_by))
		.leftJoin(posts, eq(posts.id, reports.post_id))
		.where(and(...filters))
		.orderBy(desc(reports.id))
		.limit(limit + 1);

	return rows.map(({ post_id, post_content, post_current, post_images, account: a, ...r }) => ({
		...r,
		post:
			r.kind === 'post'
				? {
						id: post_id,
						// what it says now, or the copy taken when it was reported once it is gone
						content: post_current ?? post_content ?? '',
						images: post_images ?? [],
						deleted: post_current === null,
						edited: post_current !== null && post_content !== null && post_current !== post_content
				  }
				: null,
		account: {
			username: a.username,
			role: a.role,
			banned: a.banned_at !== null,
			muted: a.muted_at !== null
		},
		can_moderate: canModerate(locals, { id: a.id, role: a.role })
	}));
}

/**
 * Sets a report's status, with an optional note for the other staff. `related` also closes (or
 * reopens) the other open reports of the same post or profile.
 */
export async function setReportStatus(
	locals: App.Locals,
	id: number,
	body: Record<string, unknown>
) {
	if (locals.accountId === null || !isStaff(locals.role))
		fail(403, 'Only moderators and admins can do this');
	if (typeof body.status !== 'string' || !REPORT_STATUSES.includes(body.status as ReportStatus))
		fail(400, `status must be one of ${REPORT_STATUSES.join(', ')}`);
	const status = body.status as ReportStatus;
	if (body.note !== undefined && body.note !== null && typeof body.note !== 'string')
		fail(400, 'note must be a string');
	const note = ((body.note as string | null) ?? '').trim().slice(0, MAX_NOTE) || null;
	const related = body.related === true;
	if (actionsLimited(locals.accountId)) fail(429, 'Too many actions, slow down.');

	const [report] = await db
		.select({
			id: reports.id,
			kind: reports.kind,
			post_id: reports.post_id,
			target_id: reports.target_id,
			status: reports.status
		})
		.from(reports)
		.where(eq(reports.id, id));
	if (!report) fail(404, 'Report not found');

	const scope = related
		? or(eq(reports.id, id), and(sameSubject(report), eq(reports.status, 'open')))
		: eq(reports.id, id);
	const changed = await db
		.update(reports)
		.set(
			status === 'open'
				? { status, resolved_at: null, resolved_by: null, resolution_note: null }
				: { status, resolved_at: sql`NOW()`, resolved_by: locals.accountId, resolution_note: note }
		)
		.where(and(scope, ne(reports.status, status)))
		.returning({ id: reports.id });

	if (changed.length > 0) {
		const account = await findTargetById((await accountIdOf(report.target_id)) ?? report.target_id);
		const [actor] = await db
			.select({ id: users.id, username: users.username })
			.from(users)
			.where(eq(users.id, locals.accountId));
		await logAction({
			actor: actor ?? null,
			target: account,
			action:
				status === 'open'
					? 'report_reopened'
					: status === 'resolved'
					? 'report_resolved'
					: 'report_dismissed',
			reason: note,
			details: { reports: changed.map((c) => c.id), kind: report.kind, post_id: report.post_id }
		});
	}
	const n = changed.length;
	return {
		updated: n,
		message:
			n === 0
				? 'Nothing to change.'
				: `${n === 1 ? 'Report' : `${n} reports`} ${status === 'open' ? 'reopened' : status}.`
	};
}

/** Closes the open reports of a post staff deleted, before the post (and the link) is gone. */
export async function resolveReportsOfPost(postId: number, accountId: number) {
	return db
		.update(reports)
		.set({
			status: 'resolved',
			resolved_at: sql`NOW()`,
			resolved_by: accountId,
			resolution_note: 'Post deleted'
		})
		.where(and(eq(reports.post_id, postId), eq(reports.status, 'open')))
		.returning({ id: reports.id });
}

/** Open reports, for the staff badge. */
export const openReportCount = () => db.$count(reports, eq(reports.status, 'open'));
