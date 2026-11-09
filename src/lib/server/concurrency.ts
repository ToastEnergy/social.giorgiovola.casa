/**
 * Runs at most `max` calls of the returned function at once; the rest wait their turn, in order.
 * For work that takes a lot of memory per call (password hashing, image decoding), so a burst of
 * requests queues up instead of exhausting the server.
 */
export function limitConcurrency(max: number) {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async <T>(fn: () => Promise<T>): Promise<T> => {
		if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
		else running++;
		try {
			return await fn();
		} finally {
			// the slot passes straight to the next caller, so `running` stays the same
			const next = waiting.shift();
			if (next) next();
			else running--;
		}
	};
}
