/** Shared bits of the settings sections (src/routes/settings/*). */

export type SettingsSection = { slug: string; label: string; title: string };

// the order of the tabs; each one is its own route, /settings/<slug>
export const settingsSections: SettingsSection[] = [
	{ slug: 'profile', label: 'Profile', title: 'Profile' },
	{ slug: 'accounts', label: 'Accounts', title: 'Accounts & identities' },
	{ slug: 'notifications', label: 'Notifications', title: 'Notifications' },
	{ slug: 'security', label: 'Security', title: 'Security' },
	{ slug: 'developers', label: 'Developers', title: 'Developers' }
];

export const sectionClass = 'mb-10 flex flex-col gap-3';
export const hintClass = 'text-[0.85em] text-muted';
export const fieldClass = 'flex flex-col';
export const labelClass = 'text-[0.8em] opacity-80';
export const inputClass = 'border-b border-line bg-transparent outline-none';
export const fileInputClass = `${inputClass} file:mr-1 file:cursor-pointer file:rounded-sm file:border file:border-line file:px-1.5`;

// dates in the reader's zone, through LocalTime (see time.svelte.ts)
export const DAY: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

/** GET /api/v1/me/bots */
export type Bot = {
	id: number;
	name: string;
	username: string;
	avatar: string | null;
	bio: string;
	website: string;
	created_at: string;
	last_used_at: string | null;
};

/** GET /api/v1/me/passkeys */
export type Passkey = {
	id: string;
	name: string;
	backed_up: boolean;
	created_at: string;
	last_used_at: string | null;
};

/** GET /api/v1/auth/sessions */
export type Session = {
	id: number;
	kind: 'cookie' | 'token' | 'personal';
	name: string | null;
	user_agent: string | null;
	created_at: string;
	expires_at: string | null;
	last_used_at: string | null;
	current: boolean;
};

/** A token only the response that created it carries: it is never shown again. */
export type NewToken = { label: string; token: string; bot: boolean };
