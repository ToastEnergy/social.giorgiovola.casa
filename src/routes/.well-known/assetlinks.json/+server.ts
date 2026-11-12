import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { androidFingerprints, androidPackage } from '#lib/server/appLinks.js';

/** Lets the Android app signed with ANDROID_APP_FINGERPRINTS use this instance's passkeys. */
export const GET: RequestHandler = () => {
	const fingerprints = androidFingerprints();
	return json(
		fingerprints.length
			? [
					{
						relation: ['delegate_permission/common.get_login_creds'],
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
