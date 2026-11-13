// Signs Android release builds with the keystore named by the SGC_RELEASE_* gradle properties
// (in CI: ORG_GRADLE_PROJECT_SGC_RELEASE_STORE_FILE etc.), so no keystore or password is ever
// written to the generated android/ folder. Without them release builds keep the debug keystore.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// sgc-release-signing';

const RELEASE_CONFIG = `
        ${MARKER}
        if (findProperty('SGC_RELEASE_STORE_FILE')) {
            release {
                storeFile file(findProperty('SGC_RELEASE_STORE_FILE'))
                storePassword findProperty('SGC_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('SGC_RELEASE_KEY_ALIAS')
                keyPassword findProperty('SGC_RELEASE_KEY_PASSWORD')
            }
        }`;

module.exports = (config) =>
	withAppBuildGradle(config, (cfg) => {
		let gradle = cfg.modResults.contents;
		if (cfg.modResults.language !== 'groovy') {
			throw new Error('android-release-signing: expected a Groovy app/build.gradle');
		}
		if (gradle.includes(MARKER)) return cfg;

		const signingConfigs = /signingConfigs\s*\{/;
		// the release build type is the one after "release {" inside buildTypes
		const releaseSigning =
			/(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
		if (!signingConfigs.test(gradle) || !releaseSigning.test(gradle)) {
			throw new Error('android-release-signing: app/build.gradle has an unexpected layout');
		}
		gradle = gradle.replace(signingConfigs, (m) => m + RELEASE_CONFIG);
		gradle = gradle.replace(
			releaseSigning,
			"$1signingConfig findProperty('SGC_RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug"
		);
		cfg.modResults.contents = gradle;
		return cfg;
	});
