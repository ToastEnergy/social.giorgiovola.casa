<script lang="ts">
	import type { LayoutProps } from './$types';
	import { page } from '$app/state';
	import { settingsSections } from '#lib/settings.js';

	let { children }: LayoutProps = $props();

	const current = $derived(
		settingsSections.find((s) => page.url.pathname === `/settings/${s.slug}`)
	);

	// underline tabs; on narrow screens the row scrolls sideways instead of wrapping
	const tabClass = (active: boolean) =>
		`shrink-0 grow border-b-2 px-2.5 py-2.5 text-center text-foreground hover:no-underline ${
			active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'
		}`;
</script>

<svelte:head>
	<title>{current ? `${current.title} · Settings` : 'Settings'}</title>
</svelte:head>

<h1>Settings</h1>
<nav class="mt-2.5 mb-5 flex overflow-x-auto" aria-label="Settings sections">
	{#each settingsSections as section (section.slug)}
		{@const active = current === section}
		<a
			class={tabClass(active)}
			href="/settings/{section.slug}"
			data-sveltekit-noscroll
			aria-current={active ? 'page' : undefined}>{section.label}</a
		>
	{/each}
</nav>

{@render children()}
