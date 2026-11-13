// Android shows expo.name under the launcher icon, where "Social Giorgiovola Casa" gets cut off:
// use the short name there, like iOS (CFBundleDisplayName) and the web app's manifest short_name.
const { withStringsXml, AndroidConfig } = require('expo/config-plugins');

module.exports = (config, label) =>
	withStringsXml(config, (cfg) => {
		cfg.modResults = AndroidConfig.Strings.setStringItem(
			[AndroidConfig.Resources.buildResourceItem({ name: 'app_name', value: label })],
			cfg.modResults
		);
		return cfg;
	});
