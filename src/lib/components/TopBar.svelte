<script lang="ts">
	import AccountSwitcher from './AccountSwitcher.svelte';
	import Search from './Search.svelte';

	// wide pages (messages) never get the rail, so the bar stays at any window width
	let { wide = false }: { wide?: boolean } = $props();
</script>

<!-- devices with a mouse, while the window has no room for the rail: its own block above the
	content panel (the layout's centred group), fixed so it stays while the page scrolls. search
	fills the row and the profile avatar is at the right. the rail takes both over once shown.
	45px high (the avatar of the rail's badge, and the search field's height) plus the 10px gap, the
	same as the one between search and avatar, is the --bar in app.css that the panel and full
	height pages use -->
<div
	class="fixed top-5 left-[calc(var(--left)+var(--side))] z-998 h-11.25 w-(--panel) items-center gap-2.5 pointer-coarse:hidden {wide
		? 'flex'
		: 'hidden max-rail:flex'}"
>
	<div class="min-w-0 flex-1">
		<Search bar />
	</div>
	<AccountSwitcher size={45} />
</div>
