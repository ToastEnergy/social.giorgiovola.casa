import { ANDROID_APP_FINGERPRINTS, ANDROID_APP_PACKAGE, APPLE_APP_IDS } from '$app/env/private';

/**
 * The mobile apps allowed to use this instance's passkeys and open its invite links. iOS and
 * Android only let an app use a site's passkeys, or open its links, when the site lists the app in
 * /.well-known (apple-app-site-association, assetlinks.json).
 */

const list = (value: string) =>
	value
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

export const appleAppIds = () => list(APPLE_APP_IDS);

/** SHA-256 certificate fingerprints, uppercase hex with colons as Android tools print them. */
export const androidFingerprints = () =>
	list(ANDROID_APP_FINGERPRINTS)
		.map((f) => f.toUpperCase().replace(/[^0-9A-F]/g, ''))
		.filter((hex) => hex.length === 64)
		.map((hex) => hex.match(/../g)!.join(':'));

export const androidPackage = () => ANDROID_APP_PACKAGE;

/**
 * The origins Android apps sign passkey ceremonies with: `android:apk-key-hash:` and the
 * base64url of the certificate's SHA-256 (iOS apps use the site's own origin).
 */
export const androidOrigins = () =>
	androidFingerprints().map(
		(f) => `android:apk-key-hash:${Buffer.from(f.replace(/:/g, ''), 'hex').toString('base64url')}`
	);
