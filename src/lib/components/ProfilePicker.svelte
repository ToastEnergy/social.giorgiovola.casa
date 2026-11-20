<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { MediaQuery } from 'svelte/reactivity';
	import { afterPageChange, overlayEntry } from '#lib/history.svelte.js';
	import { visibleBottom } from '#lib/keyboard.svelte.js';
	import type { User } from '#lib/types.js';
	import { getAvatar } from '#lib/utils.js';

	type Entry = Pick<User, 'username' | 'name' | 'avatar'> & {
		/** what this profile already did, shown at the end of its row ("Liked") */
		note?: string;
		/** the profile that is currently chosen or the one the page shows */
		current?: boolean;
	};

	type Props = {
		/** the question the list answers: "Posting as", "Like as…" */
		title: string;
		profiles: Entry[];
		/** the list is on its way (a request for what each profile did) */
		loading?: boolean;
		/** keep the mouse popover against the right edge of what it opens from */
		right?: boolean;
		onpick: (username: string) => void;
		onclose: () => void;
	};

	let { title, profiles, loading = false, right = false, onpick, onclose }: Props = $props();

	// touch devices get a sheet at the bottom of the screen, mouse devices a popover under the
	// button it opens from (the parent is `relative`)
	const touch = new MediaQuery('(pointer: coarse)');
	let root: HTMLDivElement | undefined = $state();
	let up = $state(false);
	let atRight = $derived(right);

	// back (or the gesture) closes the sheet
	overlayEntry(
		'profile-picker',
		() => touch.current,
		() => onclose()
	);
	afterPageChange(() => onclose());

	// the popover opens upwards, or against the other edge, when it wouldn't fit
	$effect(() => {
		if (!root || touch.current) return;
		const rect = root.getBoundingClientRect();
		if (!up && rect.bottom > visibleBottom() && rect.top - rect.height - 40 > 0) up = true;
		if (rect.right > window.innerWidth - 10) atRight = true;
		else if (rect.left < 10) atRight = false;
	});

	// Escape closes it, and so does a press anywhere else. the button it opens from is in its
	// parent: that press toggles it instead (otherwise it would close and open again)
	$effect(() => {
		const onPointer = (e: PointerEvent) => {
			if (!root || touch.current) return;
			if (!(root.parentElement ?? root).contains(e.target as Node)) onclose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				onclose();
			}
		};
		document.addEventListener('pointerdown', onPointer, true);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('pointerdown', onPointer, true);
			document.removeEventListener('keydown', onKey, true);
		};
	});

	// focus moves into the list so it works from the keyboard
	$effect(() => {
		if (profiles.length) queueMicrotask(() => root?.querySelector<HTMLElement>('button')?.focus());
	});

	const stop = (e: Event) => e.stopPropagation();
</script>

<!-- a touch sheet's dimmed backdrop: a tap on it closes the list -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<!-- prettier-ignore -->
<div
	class="fixed inset-0 z-998 bg-black/50 not-pointer-coarse:hidden"
	onclick={(e) => {
		e.stopPropagation();
		onclose();
	}}
></div>
<!-- the click only keeps a tap inside from reaching the post or the page under it -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={root}
	role="menu"
	aria-label={title}
	tabindex="-1"
	class="z-999 flex flex-col border border-accent bg-background pointer-coarse:fixed pointer-coarse:right-0 pointer-coarse:bottom-0 pointer-coarse:left-0 pointer-coarse:max-h-[70dvh] pointer-coarse:rounded-t-md pointer-coarse:p-2.5 pointer-coarse:pb-[calc(10px+env(safe-area-inset-bottom))] not-pointer-coarse:absolute not-pointer-coarse:w-max not-pointer-coarse:min-w-56 not-pointer-coarse:max-w-[min(22rem,calc(100vw-20px))] not-pointer-coarse:rounded-[5px] not-pointer-coarse:p-[5px] {up
		? 'not-pointer-coarse:bottom-full not-pointer-coarse:mb-[5px]'
		: 'not-pointer-coarse:top-full not-pointer-coarse:mt-[5px]'} {atRight
		? 'not-pointer-coarse:right-0'
		: 'not-pointer-coarse:left-0'}"
	onclick={stop}
	oncontextmenu={stop}
>
	<p class="px-2.5 py-[5px] text-[0.8em] text-muted">{title}</p>
	<div class="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
		{#each profiles as profile (profile.username)}
			<button
				type="button"
				role="menuitem"
				class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-[5px] text-left outline-none hover:bg-white/5 focus-visible:bg-white/5 sm:min-h-9"
				disabled={loading}
				title="{profile.name} (@{profile.username})"
				onclick={(e) => {
					e.stopPropagation();
					onpick(profile.username);
				}}
			>
				<img
					class="size-6 max-w-none shrink-0 rounded-full object-cover"
					src={getAvatar(profile, 24)}
					alt=""
					width="24"
					height="24"
				/>
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="truncate font-bold">{profile.name}</span>
					<span class="truncate text-[0.8em] opacity-80">@{profile.username}</span>
				</span>
				{#if profile.note}
					<span class="shrink-0 text-[0.8em] text-accent">{profile.note}</span>
				{/if}
				{#if profile.current}
					<Check size={16} class="shrink-0 text-accent" aria-label="Current" />
				{/if}
			</button>
		{/each}
		{#if loading}
			<p class="px-2.5 py-[5px] text-[0.85em] text-muted">Loading…</p>
		{/if}
	</div>
</div>
