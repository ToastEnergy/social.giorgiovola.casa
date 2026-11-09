<script lang="ts">
	// wide pages (messages) keep the icons only, at any window width
	let { wide = false }: { wide?: boolean } = $props();

	import { page } from '$app/state';
	import { countLabel, homeItem, isActive, navItems, navLabel } from '#lib/nav.js';
	import { messagesCount, notisCount } from '#lib/store.js';
	import SocialLinks from './SocialLinks.svelte';

	const counts = $derived({ notifications: $notisCount, messages: $messagesCount });
	// the rows are as wide as the longest one; the layout reads that width (plus the 10px gap
	// before the panel) as --side, so the panel sits right next to the labels
	let rowsWidth = $state(0);
	$effect(() => {
		const root = document.documentElement.style;
		if (rowsWidth) root.setProperty('--sidebar-width', `${rowsWidth + 10}px`);
		return () => root.removeProperty('--sidebar-width');
	});

	const badge =
		'rounded-full bg-accent px-[5px] text-[0.75em] leading-[18px] font-bold text-background';
</script>

<!-- devices with a mouse, at any width: the logo and the sections, left of the content panel (the
	layout's centred group). icons only until there is room for the labels, then the column is
	centred between the window's edge and the panel (gap included). the project links are at the bottom (labelled
	sidebar only). search and the profile are in the rail, or on top of the content (TopBar) while
	the rail has no room -->
<nav
	aria-label="Main"
	class="fixed top-0 bottom-0 left-0 z-998 flex w-[calc(var(--left)+var(--side))] flex-col pt-5 pb-2.5 pointer-coarse:hidden {wide
		? ''
		: 'nav:pr-2.5 nav:pl-(--left)'}"
>
	<div
		class="flex w-max flex-col gap-[5px] {wide ? 'ml-auto mr-2.5' : 'max-nav:mx-auto'}"
		bind:clientWidth={rowsWidth}
	>
		<!-- same 10px inset as the rows below, so the logo's left edge lines up with their icons (icons
			only: no inset, the logo and the icons are centred in the column). it is the avatar's size
			and sits at its height, 10px below the top like the badge's padding -->
		<a
			class="mt-2.5 mb-[5px] flex size-[45px] text-inherit {wide ? '' : 'nav:ml-2.5'}"
			href="/"
			title="Home"
			aria-label="Home"
		>
			<img class="size-[45px] max-w-none" src="/Logo.png" alt="" width="45" height="45" />
		</a>
		{#each [homeItem, ...navItems] as item (item.href)}
			{@const active = isActive(page.url.pathname, item.href)}
			{@const count = item.count ? counts[item.count] : 0}
			<a
				href={item.href}
				title={navLabel(item, count)}
				aria-label={navLabel(item, count)}
				aria-current={active ? 'page' : undefined}
				class="flex items-center gap-4 rounded-md p-2.5 hover:bg-white/5 hover:no-underline {wide
					? 'justify-center'
					: 'max-nav:justify-center'} {active ? 'font-bold text-accent' : 'text-foreground'}"
			>
				<span class="relative flex shrink-0">
					<item.icon size={24} strokeWidth={active ? 2.5 : 2} />
					{#if count > 0}
						<span class="{badge} absolute -top-2 left-3.5 {wide ? '' : 'nav:hidden'}"
							>{countLabel(count)}</span
						>
					{/if}
				</span>
				{#if !wide}
					<!-- an invisible bold copy keeps the row as wide when it becomes active -->
					<span
						data-label={item.label}
						class="grid after:invisible after:h-0 after:overflow-hidden after:font-bold after:content-[attr(data-label)] max-nav:hidden"
						>{item.label}</span
					>
					{#if count > 0}
						<span class="{badge} ml-auto px-[7px] max-nav:hidden">{countLabel(count)}</span>
					{/if}
				{/if}
			</a>
		{/each}
	</div>
	<!-- the same text links the rail has, left aligned with the rows' icons. the 20px under them
		(plus the nav's 10px) is the panel's bottom margin and padding: as far from the window's edge
		as the last line of the content -->
	{#if !wide}
		<div class="mt-auto flex flex-col gap-[5px] pb-5 pl-2.5 max-nav:hidden rail:hidden">
			<SocialLinks labelled />
		</div>
	{/if}
</nav>
