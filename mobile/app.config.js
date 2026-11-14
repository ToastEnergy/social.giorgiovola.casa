// app.json holds the config. This only adds what depends on files or the environment of the build.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
	// push notifications on Android need the Firebase project's google-services.json (README:
	// push in the mobile app). Without it the app builds the same, with no push
	if (fs.existsSync(path.join(__dirname, 'google-services.json')))
		config.android = { ...config.android, googleServicesFile: './google-services.json' };
	// release builds take their version from the mobile-v* tag (SGC_APP_VERSION, set by
	// mobile-android.yml): the in-app updater compares it with the latest release, and Android
	// refuses an update whose versionCode is lower than the installed one
	const version = /(\d+)\.(\d+)\.(\d+)/.exec(process.env.SGC_APP_VERSION ?? '');
	if (version) {
		const [, major, minor, patch] = version.map(Number);
		config.version = `${major}.${minor}.${patch}`;
		config.android = { ...config.android, versionCode: major * 10000 + minor * 100 + patch };
	}
	return config;
};
