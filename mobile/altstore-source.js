// writes what the AltStore source (altstore.json) says about a release .ipa: its version entry and
// permissions, which mobile-ios.yml puts into that file on main. Needs a Mac (plutil).
// SGC_APP_VERSION=mobile-v1.2.3 bun altstore-source.js <ipa> <release.json>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { expo } = require('./app.json');

const [ipa, out] = process.argv.slice(2);
const tag = process.env.SGC_APP_VERSION;
if (!ipa || !out || !tag)
	throw new Error('usage: SGC_APP_VERSION=<tag> bun altstore-source.js <ipa> <release.json>');

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

// every usage description has to be declared
const privacy = Object.fromEntries(
	plists.flatMap(Object.entries).filter(([key]) => key.includes('UsageDescription'))
);

const repo = expo.extra.updateRepo;
const release = {
	version: {
		version,
		buildVersion: info.CFBundleVersion,
		// AltStore doesn't parse fractions of a second
		date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
		downloadURL: `https://github.com/${repo}/releases/download/${tag}/${path.basename(ipa)}`,
		size: fs.statSync(ipa).size,
		minOSVersion: info.MinimumOSVersion
	},
	// no entitlements: the .ipa is unsigned
	appPermissions: { entitlements: [], privacy }
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(release, null, '\t') + '\n');
console.log(`Wrote ${out} for ${info.CFBundleIdentifier} ${version}`);
