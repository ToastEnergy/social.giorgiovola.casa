import { createSign } from 'node:crypto';
import { FCM_SERVICE_ACCOUNT } from '$app/env/private';

/**
 * Firebase Cloud Messaging (HTTP v1): push notifications for the Android app. Talks to Google
 * directly with the service account in FCM_SERVICE_ACCOUNT, so no other service sees them.
 */

type ServiceAccount = {
	project_id: string;
	client_email: string;
	private_key: string;
	token_uri?: string;
};

// validated in src/env.ts
const account: ServiceAccount | null = FCM_SERVICE_ACCOUNT ? JSON.parse(FCM_SERVICE_ACCOUNT) : null;

export const fcmConfigured = () => account !== null;

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

let cached: { token: string; expires: number } | null = null;
let pending: Promise<string> | null = null;

/** An OAuth access token for FCM, from a JWT signed with the service account key. */
async function accessToken(sa: ServiceAccount): Promise<string> {
	if (cached && cached.expires > Date.now() + 60_000) return cached.token;
	// concurrent sends share one request
	pending ??= (async () => {
		const now = Math.floor(Date.now() / 1000);
		const aud = sa.token_uri || TOKEN_URI;
		const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
		const claims = base64url(
			JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud, iat: now, exp: now + 3600 })
		);
		const signature = createSign('RSA-SHA256')
			.update(`${header}.${claims}`)
			.sign(sa.private_key, 'base64url');
		const res = await fetch(aud, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion: `${header}.${claims}.${signature}`
			})
		});
		if (!res.ok) throw new Error(`fcm: access token refused (${res.status}): ${await res.text()}`);
		const data = (await res.json()) as { access_token: string; expires_in: number };
		cached = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
		return data.access_token;
	})().finally(() => (pending = null));
	return pending;
}

export type FcmMessage = {
	title: string;
	body: string;
	/** the web path the notification opens */
	url: string;
	/** a notification with the same tag replaces the one before */
	tag?: string;
	/** the Android notification channel, created by the app */
	channel: 'messages' | 'activity';
	/** the username of the profile it is for */
	profile?: string;
};

/**
 * Sends one notification to a device. Answers false when the token is gone for good (the app
 * was uninstalled or its token replaced), so the caller can forget it.
 */
export async function sendFcm(token: string, message: FcmMessage): Promise<boolean> {
	if (!account) return true;
	// data only, in the shape expo-notifications shows by itself (title, message, body as JSON,
	// tag, channelId): a `notification` message would be shown by Android without the app's channel
	const data: Record<string, string> = {
		title: message.title,
		message: message.body,
		body: JSON.stringify({ url: message.url, profile: message.profile }),
		channelId: message.channel
	};
	if (message.tag) data.tag = message.tag;
	const res = await fetch(
		`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${await accessToken(account)}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				message: { token, data, android: { priority: 'high', ttl: '86400s' } }
			})
		}
	);
	if (res.ok) return true;
	const text = await res.text();
	// UNREGISTERED (404): the app is gone from that phone. A malformed token is a 400 INVALID_ARGUMENT
	if (res.status === 404 || text.includes('UNREGISTERED')) return false;
	if (res.status === 401) cached = null;
	console.error('push: fcm send failed', res.status, text);
	return true;
}
