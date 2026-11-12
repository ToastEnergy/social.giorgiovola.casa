// generates the iOS PWA startup images (static/splash/*.png) and prints the matching <link> tags
// for src/app.html. iOS ignores the manifest for its launch screen and wants one image per
// device size. run with `bun scripts/splash.ts` after changing the logo or the background
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const BACKGROUND = '#0c0b0b';
const LOGO = 'static/icons/icon-512.png';

// portrait css sizes (width, height, pixel ratio) of the iPhones and iPads that can run a PWA
const DEVICES: [number, number, number][] = [
	[440, 956, 3], // 16 Pro Max
	[402, 874, 3], // 16 Pro
	[430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
	[393, 852, 3], // 14 Pro, 15, 15 Pro, 16
	[428, 926, 3], // 12 / 13 Pro Max, 14 Plus
	[390, 844, 3], // 12 / 13 / 14, 12 / 13 Pro
	[375, 812, 3], // X, XS, 11 Pro, 12 / 13 mini
	[414, 896, 3], // XS Max, 11 Pro Max
	[414, 896, 2], // XR, 11
	[414, 736, 3], // 6 / 7 / 8 Plus
	[375, 667, 2], // 6 / 7 / 8, SE
	[1024, 1366, 2], // iPad Pro 12.9"
	[834, 1194, 2], // iPad Pro 11", Air 11"
	[820, 1180, 2], // iPad Air, iPad 10th gen
	[834, 1112, 2], // iPad Pro 10.5", Air 3rd gen
	[768, 1024, 2] // iPad, iPad mini
];

await mkdir('static/splash', { recursive: true });

const tags: string[] = [];
for (const [w, h, ratio] of DEVICES) {
	const width = w * ratio;
	const height = h * ratio;
	// a fifth of the shorter side, rounded like the app icon
	const size = Math.round(Math.min(width, height) * 0.2);
	const mask = Buffer.from(
		`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${
			size * 0.22
		}"/></svg>`
	);
	const logo = await sharp(LOGO)
		.resize(size, size)
		.composite([{ input: mask, blend: 'dest-in' }])
		.png()
		.toBuffer();
	const file = `splash/${width}x${height}.png`;
	await sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
		.composite([{ input: logo, gravity: 'center' }])
		.png({ compressionLevel: 9, palette: false })
		.toFile(`static/${file}`);
	tags.push(
		`<link rel="apple-touch-startup-image" href="/${file}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)" />`
	);
}
console.log(tags.join('\n'));
