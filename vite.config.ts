import adapter from '@sveltejs/adapter-node';
import * as child_process from 'node:child_process';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// there is no .git directory inside the docker build
function gitVersion() {
	try {
		return child_process
			.execSync('git rev-parse --short HEAD', { stdio: 'pipe' })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
}

// The public origin used for the CSRF check on form submissions. SvelteKit 3 removed
// adapter-node's runtime ORIGIN variable, so this is fixed at build time from PUBLIC_URL
// (a Docker build arg, or .env for local builds). Changing PUBLIC_URL requires a rebuild.
function publicOrigin(mode: string) {
	const url = process.env.PUBLIC_URL || loadEnv(mode, process.cwd(), '').PUBLIC_URL;
	return url ? new URL(url).origin : undefined;
}

export default defineConfig(({ mode }) => ({
	plugins: [
		tailwindcss(),
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter(),
			version: { name: process.env.VERSION || gitVersion() },
			paths: { origin: publicOrigin(mode) },
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['none'],
					'script-src': ['self', 'static.cloudflareinsights.com'],
					'style-src': ['self', 'unsafe-inline'],
					// api.klipy.com: the GIF pickers search KLIPY from the browser (src/lib/klipy.ts)
					'connect-src': ['self', 'cloudflareinsights.com', 'api.klipy.com'],
					// GIFs play as KLIPY's own MP4s, loaded from its media hosts
					'media-src': ['static.klipy.com', 'static1.klipy.com', 'static2.klipy.com'],
					// every image is served by us (uploads, avatars, link preview images), except KLIPY's
					// GIF stills (video posters and the picker's previews). blob: is for the previews of
					// files attached in the composer and the photo editor
					'img-src': [
						'self',
						'blob:',
						'static.klipy.com',
						'static1.klipy.com',
						'static2.klipy.com'
					],
					'base-uri': ['self'],
					'frame-ancestors': ['none'],
					'object-src': ['none'],
					'form-action': ['self'],
					'manifest-src': ['self'],
					'font-src': ['self', 'data:']
				}
			}
		})
	],
	server: {
		// the app writes user uploads and avatars into static/ at runtime (served by their own
		// routes): without this every upload makes the dev server reload the page
		watch: { ignored: ['**/static/uploads/**', '**/static/avatars/**'] }
	}
}));
