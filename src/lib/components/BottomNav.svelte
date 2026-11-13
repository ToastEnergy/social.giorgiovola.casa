<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import LogIn from '@lucide/svelte/icons/log-in';
	import { flushSync } from 'svelte';
	import { goto, refreshAll } from '$app/navigation';
	import { motion, returnToSection } from '#lib/history.svelte.js';
	import { openCompose } from '#lib/compose.svelte.js';
	import { page } from '$app/state';
	import { countLabel, homeItem, isActive, navItems, navLabel, type NavItem } from '#lib/nav.js';
	import { messagesCount, notisCount, user } from '#lib/store.js';
	import { bottomBar, keyboard } from '#lib/keyboard.svelte.js';
	import AccountSwitcher from './AccountSwitcher.svelte';

	// in a chat the bar continues the message input above it: in the flow, full width, no border
	let { joined = false }: { joined?: boolean } = $props();

	// an open post has the reply bar right above (ReplyDock), which takes over the top border
	const docked = $derived(!!$user && page.route.id === '/@[username]/[post]' && !page.error);
	// moderation (and its reports count) is in the profile menu here, not the bar
	const counts = $derived({ notifications: $notisCount, messages: $messagesCount, reports: 0 });
	// home, chat, new post, notifications and the profile menu (switching, settings). search is
	// in the top row (MobileHeader)
	const [notifications, messages] = navItems;
	const before = $derived($user ? [homeItem, messages] : [homeItem]);
	const after = $derived($user ? [notifications] : []);

	// steps aside while a reply is written (ReplyDock): the reply field takes its place
	const hidden = $derived(!joined && keyboard.hideBar);
	// what the fixed bar covers (safe area and border included), reserved by the layout and the
	// reply bar sits on: 0 while it's hidden
	let height = $state(0);
	$effect(() => {
		if (joined) return;
		const root = document.documentElement.style;
		root.setProperty('--bottom-bar', `${height}px`);
		bottomBar.height = height;
		return () => {
			root.removeProperty('--bottom-bar');
			bottomBar.height = 0;
		};
	});

	// like a native tab bar: a section comes back as it was left (through the history, so with its
	// scroll and loaded posts), and the current one goes to its start, then to the top, then refreshes
	function tap(e: MouseEvent, item: NavItem, count: number) {
		if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const path = page.url.pathname;
		motion.tab = true;
		if (isActive(path, item.href)) {
			e.preventDefault();
			if (path !== item.href) goto(item.href);
			else if (scrollY > 0) scrollTo({ top: 0, behavior: 'smooth' });
			else {
				motion.tab = false;
				refreshAll();
			}
			return;
		}
		// unread items are at the section's start: the link goes there
		if (count === 0 && returnToSection(item.href)) e.preventDefault();
	}

	const itemClass = (active: boolean) =>
		`flex h-14 flex-1 items-center justify-center hover:no-underline [-webkit-tap-highlight-color:transparent] ${
			active ? 'text-accent' : 'text-foreground'
		}`;
</script>

<!-- touch devices: home, chat, new post, notifications and the profile in a bar along the bottom
	edge. positioned in a chat too, so the profile menu opens above the bar. one level over the
	reply bar (ReplyDock, z-998, later in the page), which the profile menu opens across -->
<nav
	bind:offsetHeight={height}
	data-bottom-cover={joined ? undefined : ''}
	aria-label="Main"
	class="{hidden ? 'hidden' : 'flex'} [view-transition-name:bottom-bar] bg-background px-5 pb-[env(safe-area-inset-bottom)] not-pointer-coarse:hidden {joined
		? 'relative z-10 -mx-5 -mb-5 shrink-0'
		: `fixed right-0 bottom-0 left-0 z-999 pt-1 ${docked ? '' : 'border-t border-line'}`}"
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
			onclick={(e) => tap(e, item, count)}
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
				class="flex h-9 w-14 cursor-pointer items-center justify-center rounded-[5px] bg-accent text-background outline-none [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
	{#if $user}
		<!-- the profile menu (switching, settings), opening up against the bar -->
		<div class="flex h-14 flex-1 items-center justify-center">
			<AccountSwitcher size={28} up />
		</div>
	{:else}
		{@const active = isActive(page.url.pathname, '/login')}
		<a
			href="/login"
			class={itemClass(active)}
			title="Log in"
			aria-label="Log in"
			aria-current={active ? 'page' : undefined}
			><LogIn size={24} strokeWidth={active ? 2.5 : 2} /></a
		>
	{/if}
</nav>
