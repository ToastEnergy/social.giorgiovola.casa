<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { actingAs, myProfiles } from '#lib/actingAs.svelte.js';
	import { user } from '#lib/store.js';
	import { getAvatar } from '#lib/utils.js';
	import Button from './Button.svelte';
	import ProfilePicker from './ProfilePicker.svelte';

	// room around it on mouse devices, where an open post has no padding of its own
	let { split = false }: { split?: boolean } = $props();

	const as = $derived(actingAs());
	let choosing = $state(false);

	// the page stays where it is: only its context changes (the profile in use is no `as`)
	function view(username: string) {
		choosing = false;
		const url = new URL(page.url.href);
		if (username === $user?.username) url.searchParams.delete('as');
		else url.searchParams.set('as', username);
		goto(url.pathname + url.search + url.hash, {
			replace: true,
			reset: false
		});
	}
</script>

{#if as && $user}
	<div
		class="flex items-center gap-2.5 rounded-[10px] border border-line p-2.5 {split
			? 'not-pointer-coarse:m-5 not-pointer-coarse:mb-2.5 pointer-coarse:mb-5'
			: 'mb-5'}"
	>
		<img
			class="size-6 max-w-none shrink-0 rounded-full object-cover"
			src={getAvatar(as, 24)}
			alt=""
			width="24"
			height="24"
		/>
		<p class="min-w-0 flex-1 truncate text-[0.9em]">
			Viewing as <b class="font-extrabold">@{as.username}</b>
		</p>
		<div class="relative flex">
			<Button
				size="sm"
				aria-haspopup="menu"
				aria-expanded={choosing}
				onclick={() => (choosing = !choosing)}>Change</Button
			>
			{#if choosing}
				<ProfilePicker
					title="View as"
					right
					profiles={myProfiles().map((p) => ({
						...p,
						current: p.username === as.username,
						note: p.active ? 'In use' : undefined
					}))}
					onpick={view}
					onclose={() => (choosing = false)}
				/>
			{/if}
		</div>
		<button
			type="button"
			class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[5px] outline-none hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent"
			title="Back to @{$user.username}"
			aria-label="Stop viewing as @{as.username}"
			onclick={() => view($user.username)}><X size={18} /></button
		>
	</div>
{/if}
