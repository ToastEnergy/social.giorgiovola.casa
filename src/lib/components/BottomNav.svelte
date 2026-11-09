<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import { page } from '$app/state';
	import { countLabel, homeItem, isActive, navItems, navLabel, type NavItem } from '#lib/nav.js';
	import { messagesCount, notisCount } from '#lib/store.js';
	import AccountSwitcher from './AccountSwitcher.svelte';

	// in a chat the bar continues the message input above it: in the flow, full width, no border
	let { joined = false }: { joined?: boolean } = $props();

	const counts = $derived({ notifications: $notisCount, messages: $messagesCount });
	// home, search, chat, notifications, then the profile (settings is in the profile menu)
	const [notifications, messages] = navItems;
	const searchItem: NavItem = { href: '/search', label: 'Search', icon: Search };
	const items = [homeItem, searchItem, messages, notifications];

	const itemClass = (active: boolean) =>
		`flex h-14 flex-1 items-center justify-center hover:no-underline [-webkit-tap-highlight-color:transparent] ${
			active ? 'text-accent' : 'text-foreground'
		}`;
</script>

<!-- touch devices: home, search, chat, notifications and the profile in a bar along the bottom edge.
	the profile menu opens above it, positioned against the bar itself -->
<nav
	aria-label="Main"
	class="flex bg-background px-5 pb-[env(safe-area-inset-bottom)] not-pointer-coarse:hidden {joined
		? '-mx-5 -mb-5 shrink-0'
		: 'fixed right-0 bottom-0 left-0 z-998 border-t border-line pt-1'}"
>
	{#each items as item (item.href)}
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
	{/each}
	<div class="flex h-14 flex-1 items-center justify-center">
		<AccountSwitcher size={30} up />
	</div>
</nav>
