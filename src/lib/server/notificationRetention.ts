import { sql } from 'drizzle-orm';
import { db } from './db/index.js';

/**
 * Read notifications are kept for 6 months (from when they were created), then deleted by a
 * sweep. Unread ones are kept until they are read: nobody loses a notification they never saw.
 * hooks.server.ts starts the sweep with the server (startNotificationRetention).
 */

export const NOTIFICATION_RETENTION = '6 months';
// small enough that one statement never holds its locks for long, even on the first run
const BATCH = 5000;
const SWEEP_MS = 60 * 60_000;

let running = false;

/** Deletes read notifications older than the retention period. Returns how many were deleted. */
export async function sweepOldNotifications(): Promise<number> {
	// a slow run on a big backlog shouldn't overlap the next one in this process
	if (running) return 0;
	running = true;
	let total = 0;
	try {
		for (;;) {
			// SKIP LOCKED: during a blue-green switch both containers sweep, and each takes rows
			// the other isn't deleting instead of waiting on them
			const deleted = await db.execute(sql`
				DELETE FROM inbox WHERE id IN (
					SELECT id FROM inbox
					WHERE read_at IS NOT NULL
						AND created_at < NOW() - ${NOTIFICATION_RETENTION}::interval
					LIMIT ${BATCH}
					FOR UPDATE SKIP LOCKED
				)
			`);
			total += deleted.count;
			if (deleted.count < BATCH) break;
		}
	} finally {
		running = false;
	}
	return total;
}

function sweep() {
	sweepOldNotifications().catch((e) =>
		console.error('notifications: deleting old notifications failed', e)
	);
}

let started = false;

/**
 * Starts the sweep, from `init` in hooks.server.ts: not on import, since the build imports that
 * file too, without a database.
 */
export function startNotificationRetention() {
	if (started) return;
	started = true;
	// shortly after start (not during it, while the first requests run), then hourly
	setTimeout(sweep, 60_000).unref?.();
	setInterval(sweep, SWEEP_MS).unref?.();
}
