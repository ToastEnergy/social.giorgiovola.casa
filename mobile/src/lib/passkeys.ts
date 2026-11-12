import * as Passkeys from 'react-native-passkeys';
import { api, ApiError } from './api';
import type { LoginResult } from './types';

// passkeys through the platform (iOS AuthenticationServices, Android Credential Manager). They
// only work for a domain that lists this app in its /.well-known files (README: passkeys in the
// mobile app), and on iOS for the domains in app.json's associatedDomains

type Options<T> = T & { challenge_id: string };
type RequestOptions = Parameters<typeof Passkeys.get>[0];
type CreationOptions = Parameters<typeof Passkeys.create>[0];

export function passkeysSupported() {
	try {
		return Passkeys.isSupported();
	} catch {
		// a build without the native module
		return false;
	}
}

/** Thrown when the person closed the passkey sheet: nothing to report. */
export class PasskeyCancelled extends Error {}

/** The platform's error, in words a person can act on. */
function platformError(e: unknown): never {
	const err = e as { code?: string; message?: string };
	const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
	if (/cancel/i.test(text)) throw new PasskeyCancelled();
	if (/NotConfigured|4004|not associated|domain/i.test(text))
		throw new Error('Passkeys aren’t set up for this server in the app.', { cause: e });
	if (/InvalidStateError|excluded|already/i.test(text))
		throw new Error('This device already has a passkey for your account.', { cause: e });
	throw new Error(err?.message || 'The passkey could not be used.', { cause: e });
}

/** Signs in with a passkey saved on the device. Answers like POST /auth/login. */
export async function passkeyLogin(server: string, clientName: string) {
	const { challenge_id, ...options } = await api<Options<RequestOptions>>('auth/passkeys/options', {
		method: 'POST',
		server,
		token: null
	});
	let response;
	try {
		response = await Passkeys.get(options);
	} catch (e) {
		platformError(e);
	}
	if (!response) throw new PasskeyCancelled();
	try {
		return await api<LoginResult>('auth/passkeys/login', {
			method: 'POST',
			server,
			token: null,
			body: { challenge_id, response, client_name: clientName }
		});
	} catch (e) {
		if (e instanceof ApiError && e.body.unknown)
			throw new Error('This passkey was deleted from your account. Remove it from the device.', {
				cause: e
			});
		throw e;
	}
}

/** Creates a passkey for the account in use. The password is asked again, like on the website. */
export async function addPasskey(currentPassword: string, name: string) {
	const { challenge_id, ...options } = await api<Options<CreationOptions>>('me/passkeys/options', {
		method: 'POST',
		body: { current_password: currentPassword }
	});
	let response;
	try {
		response = await Passkeys.create(options);
	} catch (e) {
		platformError(e);
	}
	if (!response) throw new PasskeyCancelled();
	return api<{ id: string; name: string }>('me/passkeys', {
		method: 'POST',
		body: { challenge_id, name, response }
	});
}
