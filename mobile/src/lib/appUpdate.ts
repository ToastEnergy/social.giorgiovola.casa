import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Updates for the sideloaded Android app: it isn't in a store, so it looks for a newer
 * mobile-v* release on GitHub (where mobile-android.yml attaches the .apk), downloads the .apk
 * and hands it to Android's installer. Android only installs it over this one when it is signed
 * with the same key, so a tampered file can't replace the app.
 */

/** owner/repo of the GitHub releases, from app.json (extra.updateRepo) */
const repo = Constants.expoConfig?.extra?.updateRepo as string | undefined;
const APK_NAME = 'SocialGiorgiovolaCasa.apk';
/** at most one look at GitHub this often: unauthenticated calls are limited to 60 an hour */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** only release builds on Android: Expo Go and dev builds aren't installed from the .apk */
export const updatesSupported =
	Platform.OS === 'android' && !isRunningInExpoGo() && !__DEV__ && !!repo;

/** the version this build was made with: app.config.js sets it from the mobile-v* tag */
export const currentVersion = Constants.expoConfig?.version ?? '0.0.0';

export type UpdateState =
	| { status: 'idle' }
	| { status: 'available'; version: string; url: string; size: number; notes: string }
	| { status: 'downloading'; version: string; progress: number }
	| { status: 'ready'; version: string; uri: string }
	| { status: 'error'; version: string; url: string; size: number; message: string };

let state: UpdateState = { status: 'idle' };
let lastCheck = 0;
/** the version "Later" was chosen for, hidden until the app starts again */
let dismissed: string | null = null;
const listeners = new Set<() => void>();

function setState(next: UpdateState) {
	state = next;
	for (const listener of listeners) listener();
}

export function useAppUpdate() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => state
	);
}

/** [major, minor, patch] from a tag such as mobile-v1.2.3 (or the mistyped mobile-v.1.0.2) */
export function parseVersion(text: string): [number, number, number] | null {
	const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
	return m ? [+m[1], +m[2], +m[3]] : null;
}

function newer(a: [number, number, number], b: [number, number, number]) {
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return false;
}

type Release = {
	tag_name: string;
	draft: boolean;
	prerelease: boolean;
	body: string | null;
	assets: { name: string; browser_download_url: string; size: number }[];
};

/** looks for a newer release, unless one was looked for recently (`force` skips that) */
export async function checkForUpdate(force = false) {
	if (!updatesSupported) return;
	if (state.status === 'downloading' || state.status === 'ready') return;
	if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return;
	lastCheck = Date.now();
	const installed = parseVersion(currentVersion);
	if (!installed) return;
	try {
		const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
			headers: { Accept: 'application/vnd.github+json' }
		});
		if (!res.ok) return;
		const releases = (await res.json()) as Release[];
		let best: { version: [number, number, number]; release: Release } | null = null;
		for (const release of releases) {
			if (release.draft || release.prerelease || !release.tag_name.startsWith('mobile-v')) continue;
			const version = parseVersion(release.tag_name);
			if (!version || !release.assets.some((a) => a.name === APK_NAME)) continue;
			if (!best || newer(version, best.version)) best = { version, release };
		}
		if (!best || !newer(best.version, installed)) return;
		const version = best.version.join('.');
		if (version === dismissed) return;
		const asset = best.release.assets.find((a) => a.name === APK_NAME)!;
		setState({
			status: 'available',
			version,
			url: asset.browser_download_url,
			size: asset.size,
			notes: best.release.body?.trim() ?? ''
		});
	} catch {
		// offline or GitHub is down: try again next time
	}
}

export function dismissUpdate() {
	if ('version' in state) dismissed = state.version;
	setState({ status: 'idle' });
}

/** downloads the .apk (again, after an error), then opens the installer */
export async function downloadUpdate() {
	if (state.status !== 'available' && state.status !== 'error') return;
	const { version, url, size } = state;
	setState({ status: 'downloading', version, progress: 0 });
	try {
		// only the one being downloaded is kept: each is ~50 MB
		const dir = new Directory(Paths.cache, 'updates');
		if (dir.exists) dir.delete();
		dir.create({ intermediates: true });
		const file = await File.downloadFileAsync(url, new File(dir, `sgc-${version}.apk`), {
			idempotent: true,
			onProgress: ({ bytesWritten, totalBytes }) => {
				const total = totalBytes > 0 ? totalBytes : size;
				if (total > 0) setState({ status: 'downloading', version, progress: bytesWritten / total });
			}
		});
		setState({ status: 'ready', version, uri: file.uri });
		await installUpdate();
	} catch (e) {
		const message = e instanceof Error ? e.message : 'The download failed.';
		setState({ status: 'error', version, url, size, message });
	}
}

/** opens Android's installer on the downloaded .apk; it asks to allow installs from this app
 * the first time (REQUEST_INSTALL_PACKAGES in app.json) */
export async function installUpdate() {
	if (state.status !== 'ready') return;
	const contentUri = await getContentUriAsync(state.uri);
	await startActivityAsync('android.intent.action.VIEW', {
		data: contentUri,
		type: 'application/vnd.android.package-archive',
		// FLAG_GRANT_READ_URI_PERMISSION: the installer reads the file through our FileProvider
		flags: 1
	});
}
