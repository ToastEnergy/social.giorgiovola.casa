import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'package/',
			'workers/**/.wrangler/',
			'.wrangler/',
			// gitignored in mobile/.gitignore
			'mobile/build/',
			'mobile/ios/',
			'mobile/android/',
			'mobile/.expo/',
			'mobile/dist/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// `.catch(() => {})` is the intended way to ignore best-effort failures
			'@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
			'@typescript-eslint/ban-ts-comment': [
				'error',
				{ 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' }
			],
			// new in eslint-plugin-svelte 3 and not worth the churn: the app has no base path, so
			// plain hrefs are fine; keyed each blocks and SvelteMap/SvelteURLSearchParams only matter
			// where the list or the object is actually reactive
			'svelte/no-navigation-without-resolve': 'off',
			'svelte/require-each-key': 'off',
			'svelte/prefer-svelte-reactivity': 'off',
			// prettier 2 writes {' '} to keep significant whitespace
			'svelte/no-useless-mustaches': 'off'
		}
	},
	{
		// metro loads static assets with require(), and expo config plugins are CommonJS
		files: ['mobile/**/*.{ts,tsx,js}'],
		rules: { '@typescript-eslint/no-require-imports': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				extraFileExtensions: ['.svelte']
			}
		}
	}
);
