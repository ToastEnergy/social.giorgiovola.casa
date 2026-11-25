// writes the AltStore source (https://faq.altstore.io/developers/make-a-source) that lists a release
// .ipa, which mobile-ios.yml publishes on the `altstore` branch. Needs a Mac (plutil).
// SGC_APP_VERSION=mobile-v1.2.3 bun altstore-source.js <ipa> <source.json>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { expo } = require('./app.json');

const [ipa, out] = process.argv.slice(2);
const tag = process.env.SGC_APP_VERSION;
if (!ipa || !out || !tag)
	throw new Error('usage: SGC_APP_VERSION=<tag> bun altstore-source.js <ipa> <source.json>');

// AltStore refuses to install an app that differs from what the source says about it, so
// everything that can be is read from the .ipa itself
const entries = execFileSync('unzip', ['-Z1', ipa], { encoding: 'utf8', maxBuffer: 1 << 26 });
// the app's Info.plist first, then those of its extensions
const plists = entries
	.split('\n')
	.filter((name) => /^Payload\/[^/]+\.app\/(PlugIns\/[^/]+\.appex\/)?Info\.plist$/.test(name))
	.sort((a, b) => a.length - b.length)
	.map((name) => {
		const plist = execFileSync('unzip', ['-p', ipa, name]);
		const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist });
		return JSON.parse(json);
	});
const [info] = plists;
if (!info) throw new Error(`no app in ${ipa}`);

// a version that doesn't follow the tag would never be offered as an update
const version = info.CFBundleShortVersionString;
if (!tag.endsWith(`v${version}`)) throw new Error(`the .ipa is version ${version}, the tag ${tag}`);

// every usage description has to be declared. no entitlements: the .ipa is unsigned
const privacy = Object.fromEntries(
	plists.flatMap(Object.entries).filter(([key]) => key.includes('UsageDescription'))
);

const description = 'shitposting at its finest';
const repo = expo.extra.updateRepo;
const icon = `https://raw.githubusercontent.com/${repo}/main/mobile/assets/icon.png`;
const source = {
	name: expo.name,
	subtitle: description,
	description,
	iconURL: icon,
	website: 'https://social.giorgiovola.casa',
	tintColor: '#799a74',
	apps: [
		{
			name: info.CFBundleDisplayName,
			bundleIdentifier: info.CFBundleIdentifier,
			developerName: repo.split('/')[0],
			localizedDescription: description,
			iconURL: icon,
			tintColor: '#799a74',
			category: 'social',
			versions: [
				{
					version,
					buildVersion: info.CFBundleVersion,
					// AltStore doesn't parse fractions of a second
					date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
					downloadURL: `https://github.com/${repo}/releases/download/${tag}/${path.basename(ipa)}`,
					size: fs.statSync(ipa).size,
					minOSVersion: info.MinimumOSVersion
				}
			],
			appPermissions: { entitlements: [], privacy }
		}
	]
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(source, null, '\t') + '\n');
console.log(`Wrote ${out} for ${source.apps[0].bundleIdentifier} ${version}`);
