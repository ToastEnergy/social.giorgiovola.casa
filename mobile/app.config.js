// app.json holds the config. This only adds what depends on files that may not be there.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
	// push notifications on Android need the Firebase project's google-services.json (README:
	// push in the mobile app). Without it the app builds the same, with no push
	if (fs.existsSync(path.join(__dirname, 'google-services.json')))
		config.android = { ...config.android, googleServicesFile: './google-services.json' };
	return config;
};
