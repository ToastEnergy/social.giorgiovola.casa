<script lang="ts">
	import AccountSwitcher from './AccountSwitcher.svelte';
	import Search from './Search.svelte';
	import SocialLinks from './SocialLinks.svelte';
</script>

<!-- devices with a mouse, when there is room: right of the content panel (the layout's centred
	group), the profile badge with the search box under it. below that width the profile sits at the
	bottom of the sidebar and search is a sidebar link. the wrapper is what hides it on touch
	devices, so the display utilities on the aside don't fight -->
<div class="pointer-coarse:hidden">
	<aside
		class="fixed top-5 bottom-2.5 left-[calc(var(--left)+var(--side)+var(--panel)+10px)] z-998 hidden w-[calc(var(--rail)-10px)] flex-col gap-2.5 rail:flex"
	>
		<!-- positioned, so the profile menu opens under the search box rather than under the whole
			(window-high) rail, off screen -->
		<div class="relative flex flex-col gap-2.5">
			<AccountSwitcher badge size={45} />
			<Search rail />
		</div>
		<!-- 20px under the links, as in the sidebar -->
		<div class="mt-auto flex flex-col items-end gap-[5px] pb-5">
			<SocialLinks labelled />
		</div>
	</aside>
</div>
