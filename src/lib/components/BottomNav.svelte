<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import { flushSync } from 'svelte';
	import { openCompose } from '#lib/compose.svelte.js';
	import { page } from '$app/state';
	import { countLabel, homeItem, isActive, navItems, navLabel, type NavItem } from '#lib/nav.js';
	import { messagesCount, notisCount, user } from '#lib/store.js';

	// in a chat the bar continues the message input above it: in the flow, full width, no border
	let { joined = false }: { joined?: boolean } = $props();

	const counts = $derived({ notifications: $notisCount, messages: $messagesCount });
	// home, search, chat and notifications (the profile and settings are at the top of home)
	const [notifications, messages] = navItems;
	const searchItem: NavItem = { href: '/search', label: 'Search', icon: Search };
	const items = $derived(
		$user ? [homeItem, searchItem, messages, notifications] : [homeItem, searchItem]
	);
	// the new post button sits in the middle, after search
	const before = $derived(items.slice(0, 2));
	const after = $derived(items.slice(2));

	const itemClass = (active: boolean) =>
		`flex h-14 flex-1 items-center justify-center hover:no-underline [-webkit-tap-highlight-color:transparent] ${
			active ? 'text-accent' : 'text-foreground'
		}`;
</script>

<!-- touch devices: home, search, new post, chat and notifications in a bar along the bottom edge -->
<nav
	aria-label="Main"
	class="flex bg-background px-5 pb-[env(safe-area-inset-bottom)] not-pointer-coarse:hidden {joined
		? '-mx-5 -mb-5 shrink-0'
		: 'fixed right-0 bottom-0 left-0 z-998 border-t border-line pt-1'}"
>
	{#snippet link(item: NavItem)}
		{@const active = isActive(page.url.pathname, item.href)}
		{@const count = item.count ? counts[item.count] : 0}
		<a
			href={item.href}
			class={itemClass(active)}
			title={navLabel(item, count)}
			aria-label={navLabel(item, count)}
			aria-current={active ? 'page' : undefined}
		>
			<span class="relative flex">
				<item.icon size={24} strokeWidth={active ? 2.5 : 2} />
				{#if count > 0}
					<span
						class="absolute -top-2 left-3.5 rounded-full bg-accent px-[5px] text-[0.75em] leading-[18px] font-bold text-background"
						>{countLabel(count)}</span
					>
				{/if}
			</span>
		</a>
	{/snippet}
	{#each before as item (item.href)}
		{@render link(item)}
	{/each}
	{#if $user}
		<div class="flex h-14 flex-1 items-center justify-center">
			<button
				type="button"
				title="New post"
				aria-label="New post"
				class="flex size-11 cursor-pointer items-center justify-center rounded-full bg-accent text-background outline-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				onclick={() => {
					// mounted right away, so the composer can focus within the tap (iOS keyboard)
					flushSync(openCompose);
				}}><Plus size={26} strokeWidth={2.5} /></button
			>
		</div>
	{/if}
	{#each after as item (item.href)}
		{@render link(item)}
	{/each}
</nav>
