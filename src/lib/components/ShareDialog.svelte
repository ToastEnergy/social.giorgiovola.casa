<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import { errorOf } from '#lib/api.js';
	import { afterPageChange, overlayEntry } from '#lib/history.svelte.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import { modal } from '#lib/modal.js';
	import { share, closeShare, postUrl } from '#lib/share.svelte.js';
	import { isMobile, user } from '#lib/store.js';
	import type { ChatPeer, ShareRecipient } from '#lib/types.js';

	const target = $derived(share.target);
	const open = $derived(target !== null);

	let recent: ShareRecipient[] = $state([]);
	let groups: ShareRecipient[] = $state([]);
	let loadingRecent = $state(false);
	let query = $state('');
	let results: ShareRecipient[] = $state([]);
	let selected: ShareRecipient | null = $state(null);
	let note = $state('');
	let sending = $state(false);
	let error = $state('');

	let searchInput: HTMLInputElement | undefined = $state();
	// height of the on-screen keyboard, so the sheet stays above it
	let keyboard = $state(0);

	const searching = $derived(query.trim() !== '');
	// groups match by name, on the client: the dialog already has all of them
	const matchingGroups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		return groups.filter((g) => g.kind === 'group' && g.group.name.toLowerCase().includes(q));
	});
	const people = $derived(searching ? [...matchingGroups, ...results] : recent);

	const keyOf = (r: ShareRecipient) =>
		r.kind === 'user' ? `user:${r.peer.username}` : `group:${r.group.id}`;
	const labelOf = (r: ShareRecipient) => (r.kind === 'user' ? `@${r.peer.username}` : r.group.name);

	// every opening starts empty
	$effect(() => {
		if (!open) return;
		query = '';
		results = [];
		selected = null;
		note = '';
		error = '';
		loadRecent();
		// on touch screens the keyboard would cover the recent people, so it waits for a tap
		if (!$isMobile) queueMicrotask(() => searchInput?.focus());
	});

	$effect(() => {
		if (!open) return;
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => (keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
			keyboard = 0;
		};
	});

	afterPageChange(closeShare);
	overlayEntry('share', () => open, closeShare);

	async function loadRecent() {
		loadingRecent = true;
		try {
			const res = await fetch('/api/v1/share-targets');
			if (res.ok) ({ recent, groups } = await res.json());
		} catch {
			// the search still works without them
		} finally {
			loadingRecent = false;
		}
	}

	let timer: ReturnType<typeof setTimeout>;
	let request = 0;

	function onSearch() {
		clearTimeout(timer);
		const current = ++request;
		const q = query.trim().replace(/^@/, '').toLowerCase();
		if (!q) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/v1/search/users?q=${encodeURIComponent(q)}`);
				// a newer keystroke supersedes this response
				if (!res.ok || current !== request) return;
				const found: ChatPeer[] = (await res.json()).items;
				results = found
					.filter((u) => u.username !== $user?.username)
					.map((peer) => ({ kind: 'user', peer }));
			} catch {
				results = [];
			}
		}, 120);
	}

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!target || !selected || sending) return;
		sending = true;
		error = '';
		const url = postUrl(target);
		const text = note.trim();
		try {
			const content = text ? `${text}\n${url}` : url;
			const res = await fetch(
				selected.kind === 'user'
					? `/api/v1/conversations/${selected.peer.username}/messages`
					: `/api/v1/groups/${selected.group.id}/messages`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content })
				}
			);
			if (!res.ok) {
				error = (await errorOf(res)).message || 'Could not send the message';
				return;
			}
			target.notify?.(`Sent to ${labelOf(selected)}!`);
			closeShare();
		} catch {
			error = 'Could not send the message';
		} finally {
			sending = false;
		}
	}
</script>

<dialog
	class="fixed top-0 left-0 z-999 m-0 h-full w-screen border-none bg-background/20 p-0 text-foreground backdrop-blur-[2px]"
	{open}
	aria-modal="true"
	aria-labelledby="share-title"
	use:modal={{ open, onclose: closeShare }}
>
	{#if target}
		<div
			class="flex h-full items-end justify-center sm:items-center"
			style:padding-bottom="{keyboard}px"
		>
			<!-- a bottom sheet on phones, a centered dialog elsewhere -->
			<div
				data-modal-panel
				class="flex max-h-full w-full flex-col gap-2.5 overflow-hidden rounded-t-md border-t border-accent bg-background p-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:w-[calc(85%+2px)] sm:max-w-[392px] sm:rounded-md sm:border sm:bg-background/80 sm:pb-5"
			>
				<div class="flex items-center gap-2.5">
					<h3 id="share-title" class="flex-1 font-bold">Send via message</h3>
					<button
						class="flex size-8 cursor-pointer items-center justify-center outline-none"
						aria-label="Close"
						onclick={closeShare}
					>
						<X size={26} class="text-danger" />
					</button>
				</div>
				<input
					bind:this={searchInput}
					class="input"
					type="search"
					placeholder="Search people and groups"
					aria-label="Search people and groups"
					autocomplete="off"
					maxlength="33"
					bind:value={query}
					oninput={onSearch}
				/>
				<div
					class="-mx-[5px] flex min-h-0 flex-col overflow-y-auto px-[5px] sm:max-h-[min(40vh,320px)]"
					role="listbox"
					aria-label={searching ? 'Search results' : 'Recent conversations'}
				>
					{#if !searching}
						<p class="px-2.5 pb-[5px] text-[0.8em] text-muted">Recent</p>
					{/if}
					{#each people as person (keyOf(person))}
						{@const isSelected = selected !== null && keyOf(selected) === keyOf(person)}
						<button
							class="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-[5px] text-left outline-none hover:bg-white/5 focus-visible:bg-white/5 {isSelected
								? 'border-accent'
								: 'border-transparent'}"
							role="option"
							aria-selected={isSelected}
							onclick={() => {
								selected = isSelected ? null : person;
								error = '';
							}}
						>
							{#if person.kind === 'user'}
								<Avatar user={person.peer} size={40} clickable={false} />
								<span class="flex min-w-0 flex-1 flex-col">
									<span class="truncate font-bold">{person.peer.name}</span>
									<span class="truncate text-[0.85em] opacity-70">@{person.peer.username}</span>
								</span>
							{:else}
								{#if person.group.members.length === 1}
									<Avatar user={person.group.members[0]} size={40} clickable={false} />
								{:else if person.group.members.length === 0}
									<!-- everyone else left -->
									<div class="size-10 shrink-0 rounded-full border border-line" aria-hidden="true">
										&nbsp;
									</div>
								{:else}
									<!-- two faces of the group, stacked in the space of one avatar -->
									<div class="relative size-10 shrink-0">
										{#each person.group.members.slice(0, 2) as member, i (member.username)}
											<div class="absolute {i === 0 ? 'top-0 left-0' : 'right-0 bottom-0'}">
												<Avatar user={member} size={26} clickable={false} />
											</div>
										{/each}
									</div>
								{/if}
								<span class="flex min-w-0 flex-1 flex-col">
									<span class="truncate font-bold">{person.group.name}</span>
									<span class="truncate text-[0.85em] opacity-70">
										{person.group.size} members
									</span>
								</span>
							{/if}
							{#if isSelected}
								<Check size={18} strokeWidth={2.5} class="text-accent" />
							{/if}
						</button>
					{:else}
						<p class="px-2.5 py-[5px] text-[0.85em] text-muted">
							{#if searching}
								Nobody found.
							{:else if loadingRecent}
								Loading…
							{:else}
								No conversations yet, search for someone above.
							{/if}
						</p>
					{/each}
				</div>
				<form class="flex flex-col gap-2.5" onsubmit={send}>
					<input
						class="input"
						placeholder="Add a message (optional)"
						aria-label="Message"
						maxlength="1500"
						bind:value={note}
					/>
					{#if error}
						<p class="rounded-[5px] bg-danger p-[5px]" role="alert">{error}</p>
					{/if}
					<Button
						type="submit"
						variant="primary"
						size="lg"
						class="w-full"
						disabled={!selected || sending}
					>
						{sending ? 'Sending…' : selected ? `Send to ${labelOf(selected)}` : 'Choose someone'}
					</Button>
				</form>
			</div>
		</div>
	{/if}
</dialog>
