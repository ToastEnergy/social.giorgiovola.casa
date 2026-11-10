import { fetch as streamFetch } from 'expo/fetch';
import { auth } from './api';
import { emit } from './bus';

// GET /stream (server-sent events), read with expo/fetch because the token goes in a header.
// every event is re-emitted on the bus under its own name (see "Realtime" in /api.txt)

/** nothing for this long (the server pings every 8 s) means the connection is dead */
const SILENCE_MS = 20_000;

let generation = 0;
let controller: AbortController | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function dispatch(block: string) {
	let event = 'message';
	const data: string[] = [];
	for (const line of block.split('\n')) {
		if (line.startsWith('event:')) event = line.slice(6).trim();
		else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
	}
	if (event === 'ping' || !data.length) return;
	try {
		emit(event, JSON.parse(data.join('\n')));
	} catch {
		// not JSON: nothing we know
	}
}

async function run(gen: number) {
	let backoff = 1000;
	let opened = false;
	while (gen === generation) {
		const ctrl = new AbortController();
		controller = ctrl;
		let watchdog: ReturnType<typeof setTimeout> | undefined;
		const alive = () => {
			clearTimeout(watchdog);
			watchdog = setTimeout(() => ctrl.abort(), SILENCE_MS);
		};
		let wait = 3000;
		try {
			alive();
			const res = await streamFetch(`${auth.server}/api/v1/stream`, {
				headers: {
					Accept: 'text/event-stream',
					...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {})
				},
				signal: ctrl.signal
			});
			// revoked: the next API request signs the account out
			if (res.status === 401) return;
			if (res.status === 429) wait = 60_000;
			if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
			backoff = 1000;
			// events sent while disconnected aren't replayed: screens reload what they show
			if (opened) emit('stream_open');
			opened = true;
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				alive();
				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
				let end: number;
				while ((end = buffer.indexOf('\n\n')) !== -1) {
					dispatch(buffer.slice(0, end));
					buffer = buffer.slice(end + 2);
				}
			}
		} catch {
			if (gen !== generation) return;
			if (wait === 3000) {
				wait = backoff;
				backoff = Math.min(backoff * 2, 30_000);
			}
		} finally {
			clearTimeout(watchdog);
		}
		if (gen !== generation) return;
		await sleep(wait);
	}
}

/** Opens the stream for the current token, closing the one before. */
export function startStream() {
	stopStream();
	if (!auth.server || !auth.token) return;
	run(generation);
}

export function stopStream() {
	generation++;
	controller?.abort();
	controller = null;
}
