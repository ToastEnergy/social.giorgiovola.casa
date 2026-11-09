import { defineEnvVars } from '@sveltejs/kit/env';
import { building } from '$app/env';

// All runtime (dynamic) variables. Optional ones become '' when unset, which every caller
// already treats as "not configured" (registration closed, no webhook, no proxy header).
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
	SIGNUP_PASSWORD: { schema: optional },
	DISCORD_WEBHOOK_URL: { schema: optional },
	ADDRESS_HEADER: { schema: optional },
	DATABASE_URL: {
		// server modules are imported during `vite build`, when no database is configured
		schema: (input: string | undefined) => {
			if (!input && !building) throw new Error('DATABASE_URL is not set');
			return input ?? '';
		}
	}
});
