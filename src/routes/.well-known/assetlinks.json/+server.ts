import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { androidFingerprints, androidPackage } from '#lib/server/appLinks.js';

/**
 * Lets the Android app signed with ANDROID_APP_FINGERPRINTS use this instance's passkeys
 * (get_login_creds) and open its invite links (handle_all_urls; the app's intent filter limits it
 * to /register).
 */
export const GET: RequestHandler = () => {
	const fingerprints = androidFingerprints();
	return json(
		fingerprints.length
			? [
					{
						relation: [
							'delegate_permission/common.get_login_creds',
							'delegate_permission/common.handle_all_urls'
						],
						target: {
							namespace: 'android_app',
							package_name: androidPackage(),
							sha256_cert_fingerprints: fingerprints
						}
					}
			  ]
			: [],
		{ headers: { 'Cache-Control': 'max-age=3600' } }
	);
};
