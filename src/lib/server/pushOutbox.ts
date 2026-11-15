import { and, eq, inArray, sql } from 'drizzle-orm';
import { client, db, inbox } from './db/index.js';
import { sendPending, type PendingPush } from './push.js';
import type { NotificationType } from '#lib/types.js';

/**
 * The push worker. `inbox` is a transactional outbox: a row without pushed_at is a push still to
 * send. notify.ts (and invites.ts) create rows inside the event's transaction and NOTIFY on
 * PUSH_CHANNEL, which Postgres delivers on commit; every server process LISTENs, claims pending
 * rows and sends them. Polling catches what a notification missed (a reconnect) and retries.
 *
 * At least once: a claim is a lease (push_claimed_at). A row is marked pushed once its push went
 * out; if the process dies first, or no device could be reached, another claim takes it after
 * LEASE. A rare duplicate replaces the shown notification (same tag) rather than adding one.
 * Claims skip locked rows, so the two containers of a blue-green switch never take the same row.
 */

export const PUSH_CHANNEL = 'inbox_push';

const BATCH = 100;
// longer than a batch of sends takes, so a slow one isn't claimed twice
const LEASE = sql`interval '2 minutes'`;
// a row claimed this many times is given up on
const MAX_ATTEMPTS = 5;
// older than this, a push would be news nobody needs (web push and FCM keep them a day too)
const MAX_AGE = sql`interval '1 day'`;
const POLL_MS = 30_000;
// how long shutdown waits for the batch being sent
const STOP_WAIT_MS = 10_000;

type Claimed = PendingPush & { skip: boolean; attempts: number; claim: string };

/**
 * Claims up to BATCH pending rows: not pushed, and not claimed or with an expired lease. All
 * rows of a claim share its timestamp (NOW() is the statement's), kept as text for the finish.
 */
async function claim(): Promise<Claimed[]> {
	const rows = await db.execute<{
		id: number;
		user_id: number;
		sender_id: number | null;
		post_id: number | null;
		type: NotificationType;
		invites: number | null;
		skip: boolean;
		attempts: number;
		claim: string;
	}>(sql`
		UPDATE ${inbox} SET push_claimed_at = NOW(), push_attempts = push_attempts + 1
		WHERE id IN (
			SELECT id FROM ${inbox}
			WHERE pushed_at IS NULL
				AND (push_claimed_at IS NULL OR push_claimed_at < NOW() - ${LEASE})
			ORDER BY id
			LIMIT ${BATCH}
			FOR UPDATE SKIP LOCKED
		)
		RETURNING id, user_id, sender_id, post_id, type, invites,
			-- read already (seen in the app), too old, or nobody to tell: nothing to send
			(read_at IS NOT NULL OR created_at < NOW() - ${MAX_AGE}
				OR user_id IS NOT DISTINCT FROM sender_id) AS skip,
			push_attempts AS attempts, push_claimed_at::text AS claim
	`);
	return [...rows];
}

/**
 * Marks claimed rows pushed. Only while the claim is still theirs: a row made pending again
 * since (an invites grant adding to it) goes out again.
 */
async function finish(ids: number[], claimedAt: string) {
	if (ids.length === 0) return;
	await db
		.update(inbox)
		.set({ pushed_at: sql`NOW()` })
		.where(and(inArray(inbox.id, ids), eq(inbox.push_claimed_at, sql`${claimedAt}::timestamptz`)));
}

/** Claims and sends one batch. Returns how many rows it claimed. */
async function drainBatch() {
	const rows = await claim();
	if (rows.length === 0) return 0;
	const claimedAt = rows[0].claim;
	const skipped = rows.filter((r) => r.skip).map((r) => r.id);
	const exhausted = rows.filter((r) => !r.skip && r.attempts > MAX_ATTEMPTS);
	if (exhausted.length)
		console.error(
			`push: giving up on ${exhausted.length} notification(s) after ${MAX_ATTEMPTS} tries`,
			exhausted.map((r) => r.id)
		);
	const { done, retry } = await sendPending(
		rows.filter((r) => !r.skip && r.attempts <= MAX_ATTEMPTS)
	);
	await finish([...skipped, ...exhausted.map((r) => r.id), ...done], claimedAt);
	// the rest keep their lease and are claimed again once it expires
	if (retry.length) console.error(`push: ${retry.length} notification(s) will be retried`);
	return rows.length;
}

let started = false;
let stopping = false;
let running: Promise<void> | null = null;
let again = false;
let poll: ReturnType<typeof setInterval> | undefined;
let listening: Promise<{ unlisten(): Promise<void> } | null> = Promise.resolve(null);

/** Sends what is pending, now or right after the batches being sent. */
function wake() {
	if (!started || stopping) return;
	if (running) {
		again = true;
		return;
	}
	running = (async () => {
		try {
			do {
				again = false;
				while (!stopping && (await drainBatch()) === BATCH);
			} while (again && !stopping);
		} catch (e) {
			console.error('push: the push worker failed', e);
		} finally {
			running = null;
		}
	})();
}

/**
 * Starts the worker of this process (from the server's init hook): it sends what was left
 * pending (by a restart, say), then whatever is notified, and polls as a fallback.
 */
export function startPushWorker() {
	if (started) return;
	started = true;
	// the third callback runs on every (re)connect of the listening connection: notifications
	// sent while it was down are lost, the pending rows aren't
	listening = client.listen(PUSH_CHANNEL, wake, wake).catch((e) => {
		console.error('push: LISTEN failed, polling only', e);
		return null;
	});
	poll = setInterval(wake, POLL_MS);
	poll.unref?.();
	wake();
}

/**
 * Stops the worker on shutdown: no new claims, and a short wait for the batch being sent. What
 * it doesn't finish is retried by another process once its lease expires.
 */
export async function stopPushWorker() {
	if (!started || stopping) return;
	stopping = true;
	clearInterval(poll);
	await (await listening)?.unlisten().catch(() => {});
	if (running)
		await Promise.race([
			running,
			new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref?.())
		]);
}
