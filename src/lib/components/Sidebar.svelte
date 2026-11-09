<script lang="ts">
	// wide pages (messages) fold the labels away and keep the icons only, at any window width
	let { wide = false }: { wide?: boolean } = $props();

	import { page } from '$app/state';
	import { fade } from 'svelte/transition';
	import { countLabel, homeItem, isActive, moderationItem, navItems, navLabel } from '#lib/nav.js';
	import { messagesCount, notisCount } from '#lib/store.js';
	import SocialLinks from './SocialLinks.svelte';

	// moderation sits before settings for staff (the profile menu has it on touch devices only)
	const items = $derived(
		page.data.role && page.data.role !== 'user'
			? [homeItem, ...navItems.slice(0, -1), moderationItem, ...navItems.slice(-1)]
			: [homeItem, ...navItems]
	);
	const counts = $derived({ notifications: $notisCount, messages: $messagesCount });
	// the rows are as wide as the longest one; the layout reads that width (plus the 10px gap
	// before the panel) as --side, so the panel sits right next to the labels. the labelled width is
	// measured on an invisible copy (sizer), so it is known on the wide pages too: they keep the
	// plain pages' position (app.css) so the icons don't move when the labels fold away
	let rowsWidth = $state(0);
	let labelledWidth = $state(0);
	const sidebarWidth = $derived(Math.max(rowsWidth, labelledWidth));
	$effect(() => {
		const root = document.documentElement.style;
		if (sidebarWidth) root.setProperty('--sidebar-width', `${sidebarWidth + 10}px`);
		return () => root.removeProperty('--sidebar-width');
	});

	const badge =
		'rounded-full bg-accent px-[5px] text-[0.75em] leading-[18px] font-bold text-background';
</script>

<!-- devices with a mouse, at any width: the logo and the sections, left of the content panel (the
	layout's centred group). icons only until there is room for the labels, then the column starts
	at the group's left edge. the project links are at the bottom (labelled sidebar only). search
	and the profile are in the rail, or on top of the content (TopBar) while the rail has no room.
	on the wide pages the labels fold away (the rows narrow to their icon) while the logo and the
	icons stay put -->
<nav
	aria-label="Main"
	class="fixed top-0 bottom-0 left-0 z-998 flex w-[calc(var(--left)+var(--side))] flex-col pt-5 pb-2.5 pointer-coarse:hidden nav:pr-2.5 nav:pl-(--left)"
>
	<!-- the labelled rows' width, for --sidebar-width: icon, gap, bold label and badge per row -->
	<div
		aria-hidden="true"
		class="invisible absolute flex w-max flex-col max-nav:hidden"
		bind:clientWidth={labelledWidth}
	>
		{#each items as item (item.href)}
			{@const count = item.count ? counts[item.count] : 0}
			<div class="flex gap-4 px-2.5 font-bold">
				<span class="w-6 shrink-0">&nbsp;</span>
				<span>{item.label}</span>
				{#if count > 0}
					<span class="{badge} px-[7px]">{countLabel(count)}</span>
				{/if}
			</div>
		{/each}
	</div>
	<div class="flex w-max flex-col gap-[5px] max-nav:mx-auto" bind:clientWidth={rowsWidth}>
		<!-- same 10px inset as the rows below, so the logo's left edge lines up with their icons (icons
			only: no inset, the logo and the icons are centred in the column). it is the avatar's size
			and sits at its height, 10px below the top like the badge's padding -->
		<a
			class="mt-2.5 mb-[5px] flex size-[45px] text-inherit nav:ml-2.5"
			href="/"
			title="Home"
			aria-label="Home"
		>
			<img class="size-[45px] max-w-none" src="/Logo.png" alt="" width="45" height="45" />
		</a>
		{#each items as item (item.href)}
			{@const active = isActive(page.url.pathname, item.href)}
			{@const count = item.count ? counts[item.count] : 0}
			<!-- width 100% to 44px (the icon and its padding) is what animates the fold -->
			<a
				href={item.href}
				title={navLabel(item, count)}
				aria-label={navLabel(item, count)}
				aria-current={active ? 'page' : undefined}
				class="flex items-center gap-4 rounded-md p-2.5 whitespace-nowrap transition-[width] duration-300 ease-in-out hover:bg-white/5 hover:no-underline max-nav:justify-center {wide
					? 'w-11'
					: 'w-full'} {active ? 'font-bold text-accent' : 'text-foreground'}"
			>
				<span class="relative flex shrink-0">
					<item.icon size={24} strokeWidth={active ? 2.5 : 2} />
					{#if count > 0}
						<span
							class="{badge} absolute -top-2 left-3.5 transition-opacity duration-300 {wide
								? ''
								: 'nav:opacity-0'}">{countLabel(count)}</span
						>
					{/if}
				</span>
				<!-- hidden (not clipped) once folded, so the badge on the icon isn't cut off and the
					invisible label doesn't take clicks -->
				<span
					class="flex grow items-center gap-4 transition-[opacity,visibility] duration-200 max-nav:hidden {wide
						? 'invisible opacity-0'
						: ''}"
				>
					<!-- an invisible bold copy keeps the row as wide when it becomes active -->
					<span
						data-label={item.label}
						class="grid after:invisible after:h-0 after:overflow-hidden after:font-bold after:content-[attr(data-label)]"
						>{item.label}</span
					>
					{#if count > 0}
						<span class="{badge} ml-auto px-[7px]">{countLabel(count)}</span>
					{/if}
				</span>
			</a>
		{/each}
	</div>
	<!-- the same text links the rail has, left aligned with the rows' icons. the 20px under them
		(plus the nav's 10px) is the panel's bottom margin and padding: as far from the window's edge
		as the last line of the content -->
	{#if !wide}
		<div
			class="mt-auto flex flex-col gap-[5px] pb-5 pl-2.5 max-nav:hidden rail:hidden"
			transition:fade={{ duration: 150 }}
		>
			<SocialLinks labelled />
		</div>
	{/if}
</nav>
