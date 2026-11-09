import { browser } from '$app/env';
import { page } from '$app/state';

// dates are shown in the reader's time zone and locale. the server doesn't know them, so the
// browser keeps them in cookies (a UI preference, like the feed cookie) and the root layout load
// hands them to the page: server rendering then prints what hydration will, with no jump from UTC

/** the reader's zone and locale as the server knows them, from the cookies (see `readTimeCookies`) */
export type TimeSettings = { zone: string; locale: string };

const YEAR = 60 * 60 * 24 * 365;

/** set once the root layout is mounted: from then on the browser's own zone is used */
export const clock = $state({ mounted: false });

const validZone = (zone: string | undefined) => {
	if (!zone || zone.length > 64) return null;
	try {
		// the name as given, not resolvedOptions(): node canonicalizes some (Europe/Kyiv → Europe/Kiev),
		// which would never match the browser's and make it rewrite the cookie on every load
		new Intl.DateTimeFormat('en', { timeZone: zone });
		return zone;
	} catch {
		return null;
	}
};

const validLocale = (locale: string | undefined) => {
	if (!locale || locale.length > 35) return null;
	try {
		return Intl.DateTimeFormat.supportedLocalesOf(locale)[0] ?? null;
	} catch {
		return null;
	}
};

/** first supported language of an Accept-Language header, for a missing locale cookie */
const acceptedLocale = (header: string | null) => {
	for (const part of (header ?? '').split(',').slice(0, 10)) {
		const locale = validLocale(part.split(';')[0].trim());
		if (locale) return locale;
	}
	return null;
};

/** For the root layout load: the reader's settings, or null on a first visit (no zone cookie). */
export function readTimeCookies(
	cookies: { get(name: string): string | undefined },
	acceptLanguage: string | null
): TimeSettings | null {
	const zone = validZone(cookies.get('tz'));
	if (!zone) return null;
	return {
		zone,
		locale: validLocale(cookies.get('locale')) ?? acceptedLocale(acceptLanguage) ?? 'en-US'
	};
}

/** The browser's zone and locale: what `formatDate` uses on the client. */
const own = () => Intl.DateTimeFormat().resolvedOptions();

/** Stores the browser's zone and locale in cookies when they differ from what the server used. */
export function syncTimeCookies(server: TimeSettings | null) {
	const { timeZone, locale } = own();
	const secure = location.protocol === 'https:' ? '; secure' : '';
	const set = (name: string, value: string) =>
		(document.cookie = `${name}=${encodeURIComponent(
			value
		)}; path=/; max-age=${YEAR}; samesite=lax${secure}`);
	if (server?.zone !== timeZone) set('tz', timeZone);
	if (server?.locale !== locale) set('locale', locale);
	clock.mounted = true;
}

const settings = (): TimeSettings | null =>
	browser ? null : (page.data as { time?: TimeSettings | null }).time ?? null;

/**
 * Whether dates can be shown yet: on the server and during hydration only when the zone is known
 * (otherwise they'd come out in UTC), always once mounted.
 */
export const dateReady = () =>
	clock.mounted || !!(page.data as { time?: TimeSettings | null }).time;

// the parts toLocaleString() and toLocaleDateString() show by default
export const DATE_TIME: Intl.DateTimeFormatOptions = {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: 'numeric',
	second: 'numeric'
};
export const DATE: Intl.DateTimeFormatOptions = {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric'
};
/** for titles: the full date and time */
export const FULL: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'long' };

/** The zone and locale dates are shown in: the cookies' on the server, the browser's own after. */
function reader(): TimeSettings {
	const known = settings();
	if (known) return known;
	// no zone yet (first visit, server side): UTC, rendered invisibly until the browser takes over
	return browser
		? { zone: own().timeZone, locale: own().locale }
		: { zone: 'UTC', locale: 'en-US' };
}

/** Formats a date in the reader's zone and locale, on the server as in the browser. */
export function formatDate(date: string | Date, options: Intl.DateTimeFormatOptions = DATE_TIME) {
	const { zone, locale } = reader();
	return new Date(date).toLocaleString(locale, { ...options, timeZone: zone });
}

// one formatter per zone: day buckets are computed for every message of a chat
const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar day of a date in the reader's zone, as a day number (days since 1970-01-01) and
 * its year: comparing these tells "today" and "yesterday" apart where the reader lives, not
 * where the server does.
 */
export function calendarDay(date: string | Date) {
	const { zone } = reader();
	let format = dayFormats.get(zone);
	if (!format) {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric'
		});
		dayFormats.set(zone, format);
	}
	const parts = format.formatToParts(new Date(date));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value);
	const year = part('year');
	return { day: Date.UTC(year, part('month') - 1, part('day')) / 86_400_000, year };
}
