import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

// All runtime (dynamic) variables. Optional ones become '' when unset, which every caller
// already treats as "not configured" (no webhook, no proxy header).
const optional = (input: string | undefined) => input ?? '';

export const variables = defineEnvVars({
	PUBLIC_URL: { public: true, schema: optional },
	// the search box's placeholder, shown in the browser too
	PUBLIC_SEARCH_PLACEHOLDER: {
		public: true,
		schema: (input: string | undefined) => input || 'Giorgiocerca qualcosa'
	},
	// the placeholder of the reply bar on an open post (touch devices)
	PUBLIC_REPLY_PLACEHOLDER: {
		public: true,
		schema: (input: string | undefined) => input || 'Giorgia un commento'
	},
	// shown under an open post that has no replies yet
	PUBLIC_NO_REPLIES_MESSAGE: {
		public: true,
		schema: (input: string | undefined) => input || 'Nessuno ha ancora giorgiato qui'
	},
	// true: nothing can be read without signing in (src/lib/server/membersOnly.ts)
	MEMBERS_ONLY: {
		schema: (input: string | undefined) => {
			const value = (input ?? '').trim().toLowerCase();
			if (value === '' || value === 'false' || value === '0') return false;
			if (value === 'true' || value === '1') return true;
			throw new Error('MEMBERS_ONLY must be true or false');
		}
	},
	// who downloads the pages of links in posts (src/lib/server/linkPreviews.ts). remote needs the
	// URL and the secret, which checkLinkPreviewConfig refuses at startup when missing
	LINK_PREVIEWS: {
		schema: (input: string | undefined) => {
			const mode = input || 'local';
			if (mode !== 'local' && mode !== 'remote' && mode !== 'off')
				throw new Error('LINK_PREVIEWS must be local, remote or off');
			return mode;
		}
	},
	LINK_PREVIEWS_URL: { schema: optional },
	LINK_PREVIEWS_SECRET: { schema: optional },
	DISCORD_WEBHOOK_URL: { schema: optional },
	// the KLIPY app key that turns on GIFs (src/lib/server/gifs.ts). Browsers use it to search
	// KLIPY themselves (KLIPY's terms), so it is public: /api/v1/instance hands it out
	KLIPY_APP_KEY: { schema: (input: string | undefined) => input?.trim() ?? '' },
	// KLIPY's content safety level for searches
	KLIPY_CONTENT_FILTER: {
		schema: (input: string | undefined) => {
			const level = input || 'medium';
			if (!['off', 'low', 'medium', 'high'].includes(level))
				throw new Error('KLIPY_CONTENT_FILTER must be off, low, medium or high');
			return level;
		}
	},
	ADDRESS_HEADER: { schema: optional },
	// the mobile apps allowed to use this instance's passkeys and open its invite links
	// (src/lib/server/appLinks.ts), served in /.well-known. Apple: TEAMID.bundle ids. Android: the package and its signing certificates'
	// SHA-256 fingerprints (AA:BB:…), all comma separated
	APPLE_APP_IDS: {
		schema: (input: string | undefined) => input ?? 'A7DPA4RJ43.casa.giorgiovola.social'
	},
	ANDROID_APP_PACKAGE: {
		schema: (input: string | undefined) => input || 'casa.giorgiovola.social'
	},
	ANDROID_APP_FINGERPRINTS: { schema: optional },
	// the Firebase service account key (its JSON, on one line) that sends push notifications to the
	// Android app through FCM (src/lib/server/fcm.ts). Empty: the app gets no push
	FCM_SERVICE_ACCOUNT: {
		schema: (input: string | undefined) => {
			const value = input?.trim() ?? '';
			if (!value) return '';
			let key: Record<string, unknown>;
			try {
				key = JSON.parse(value);
			} catch {
				throw new Error('FCM_SERVICE_ACCOUNT must be the JSON of a Firebase service account key');
			}
			for (const field of ['project_id', 'client_email', 'private_key'])
				if (typeof key[field] !== 'string')
					throw new Error(`FCM_SERVICE_ACCOUNT is missing "${field}"`);
			return value;
		}
	},
	// the bucket for avatars and images, the local disk when empty. The schemas can't see each
	// other, so checkStorageConfig (src/lib/server/storage.ts) refuses an incomplete set at startup
	S3_BUCKET: { schema: optional },
	S3_ENDPOINT: { schema: optional },
	S3_REGION: { schema: (input: string | undefined) => input || 'auto' },
	S3_ACCESS_KEY_ID: { schema: optional },
	S3_SECRET_ACCESS_KEY: { schema: optional },
	DATABASE_URL: {
		// server modules are imported during `vite build`, when no database is configured
		schema: (input: string | undefined) => {
			if (!input && !building) throw new Error('DATABASE_URL is not set');
			return input ?? '';
		}
	}
});
