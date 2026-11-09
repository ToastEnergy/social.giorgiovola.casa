<script lang="ts">
	import { user } from '#lib/store.js';
	import SocialLinks from './SocialLinks.svelte';
</script>

<!-- signed-out visitors (whose layout has no sidebar): the panel frame paints the page background
	behind the header, which spans the centred group. a signed-in user has no header: on mouse
	devices the logo is in the sidebar and the profile and search in the rail, on touch devices the
	sections, search and profile are in the bottom bar (BottomNav) -->
<header
	class="{$user
		? 'hidden '
		: ''}fixed top-0 left-0 z-999 flex w-full items-center justify-between bg-black/35 px-5 py-3.75 backdrop-blur-[3px] not-pointer-coarse:left-(--left) not-pointer-coarse:w-[calc(var(--side)+var(--panel))] not-pointer-coarse:bg-transparent not-pointer-coarse:pr-0 not-pointer-coarse:pl-2.5 not-pointer-coarse:backdrop-blur-none"
>
	<div class="flex gap-2.5">
		<a class="flex items-center text-inherit" href="/">
			<img class="h-12.5 max-w-none" src="/Logo.png" alt="Logo" height="50" />
		</a>
		<div class="flex flex-col justify-center gap-2.5">
			<SocialLinks />
		</div>
	</div>
	<p><a class="flex items-center text-inherit" href="/login">login</a></p>
</header>
