// Xcode's user-script sandbox blocks the "Bundle React Native code and images"
// phase in Release builds. Turn it off on the app target.
const { withXcodeProject } = require("expo/config-plugins");

module.exports = (config) =>
	withXcodeProject(config, (cfg) => {
		const configs = cfg.modResults.pbxXCBuildConfigurationSection();
		for (const key of Object.keys(configs)) {
			const settings = configs[key].buildSettings;
			if (settings) {
				settings.ENABLE_USER_SCRIPT_SANDBOXING = "NO";
			}
		}
		return cfg;
	});
