// unread notifications per profile (username), as the realtime `inbox` frames say: they override
// what the layout loaded (the switcher's counts) until the next load brings fresh ones
const counts = $state<Record<string, number>>({});

/** The live count of a profile, or `fallback` (what the page data says) before any frame. */
export const inboxUnread = (username: string, fallback: number) => counts[username] ?? fallback;

export const setInboxUnread = (username: string, count: number) => {
	counts[username] = count;
};

export function resetInboxUnread() {
	for (const key of Object.keys(counts)) delete counts[key];
}
