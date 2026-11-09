<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Button from '#lib/components/Button.svelte';
	import type { PageData } from './$types';
	import { notisCount, user } from '#lib/store.js';
	import type { NotificationGroup } from '#lib/types.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getPushState, type PushState } from '#lib/push.js';
	import { api, withCursor, type Page } from '#lib/api.js';
	let { data }: { data: PageData } = $props();

	// reassignable so read state can be updated locally until the next load
	let groups = $derived(data.groups);
	// writable derived: the cursor of the next page, reset by every load
	let next = $derived(data.next);
	let loadingMore = $state(false);

	async function loadMore() {
		if (!next || loadingMore) return;
		loadingMore = true;
		try {
			const page = await api<Page<NotificationGroup>>(withCursor(data.source, next));
			// a group that grew since the first page moved up: keep the copy already shown
			const seen = new Set(groups.map((g) => g.key));
			groups = [...groups, ...page.items.filter((g) => !seen.has(g.key))];
			next = page.next_cursor;
		} catch {
			// the button stays, so it can be tried again
		} finally {
			loadingMore = false;
		}
	}
	let push: PushState | null = $state(null);
	// the unread count is pushed by the layout; reload the list when it grows
	onMount(() => {
		getPushState().then((state) => (push = state));
		let last = $notisCount;
		return notisCount.subscribe((count) => {
			if (count > last) invalidateAll();
			last = count;
		});
	});

	const ownPost = (group: NotificationGroup) => `/@${$user?.username}/${group.post?.id}`;
	const senderPost = (group: NotificationGroup) =>
		`/@${group.senders[0]?.username}/${group.post?.id}`;

	/** Where clicking the group goes. */
	function target(group: NotificationGroup) {
		const sender = group.senders[0];
		if (group.type === 'follow')
			return group.count > 1 ? `/@${$user?.username}/followers` : `/@${sender?.username}`;
		if (!group.post) return `/@${sender?.username}`;
		if (group.type === 'like' || group.type === 'ratioed_by_you' || group.type === 'regiorg')
			return ownPost(group);
		return senderPost(group);
	}

	const readGroup = (group: NotificationGroup, redirect = true) => {
		if (group.unread > 0) {
			api(`notifications/groups/${group.key}/read`, { method: 'POST' }).catch(() => {});
			$notisCount = Math.max(0, $notisCount - group.unread);
			const now = new Date();
			groups = groups.map((g) => (g.key === group.key ? { ...g, unread: 0, read_at: now } : g));
		}
		if (redirect) goto(target(group));
	};

	const readAll = async () => {
		try {
			await api('notifications/read', { method: 'POST' });
		} catch {
			return;
		}
		$notisCount = 0;
		const now = new Date();
		groups = groups.map((g) => (g.read_at ? g : { ...g, unread: 0, read_at: now }));
	};

	const clip = (text: string, max = 100) => (text.length > max ? `${text.slice(0, max)}...` : text);

	/**
	 * The people a group names, each with what follows it ("@a, @b and 3 others"): all of them up
	 * to three, else the latest two and a count.
	 */
	function people(group: NotificationGroup) {
		const shown = group.senders.slice(0, group.count <= 3 ? 3 : 2);
		const others = group.count - shown.length;
		const parts = shown.map((u, i) => {
			const last = i === shown.length - 1;
			const sep = last ? '' : i === shown.length - 2 && others === 0 ? ' and' : ',';
			return { user: u, sep };
		});
		return { parts, others };
	}
</script>

<div class="flex items-center justify-between gap-2.5">
	<h1>Notifications</h1>
	{#if groups.some((g) => !g.read_at)}
		<Button onclick={readAll}>Mark all as read</Button>
	{/if}
</div>
{#if push === 'off'}
	<!-- turning push on lives in the settings; this only points there while it is off -->
	<p class="mt-2.5 text-[0.85em] text-muted">
		Get notified on this device too: turn on
		<a href="/settings/notifications">push notifications</a>.
	</p>
{/if}
<div class="mt-2.5 flex flex-col gap-3.75">
	{#each groups as group (group.key)}
		{@const sender = group.senders[0]}
		<div
			class="flex cursor-pointer items-center justify-between rounded-[10px] bg-black/70 p-2.5 {group.read_at
				? ''
				: 'border border-accent'}"
			role="button"
			tabindex="0"
			onkeypress={() => readGroup(group)}
			onclick={() => readGroup(group)}
		>
			<div class="flex min-w-0 gap-2.5">
				{#if group.senders.length > 1}
					<!-- the latest senders stacked: the group reads as one entry -->
					<div class="flex w-[50px] shrink-0 -space-x-4 self-start pt-1">
						{#each group.senders as s (s.id)}
							<div class="rounded-full border-2 border-black">
								<Avatar user={s} size={24} />
							</div>
						{/each}
					</div>
				{:else if sender}
					<div class="shrink-0"><Avatar user={sender} size={50} /></div>
				{/if}
				<div class="flex min-w-0 flex-col justify-center wrap-anywhere">
					{#if !sender}
						<!-- the sender was deleted along with the notification, so this can't happen -->
					{:else if group.type === 'follow' || group.type === 'like' || group.type === 'regiorg'}
						{@const { parts, others } = people(group)}
						<p>
							{#each parts as part (part.user.id)}
								<a href={`/@${part.user.username}`}>@{part.user.username}</a>{part.sep}{' '}
							{/each}
							{#if others > 0}
								and {others}
								{others === 1 ? 'other' : 'others'}
							{/if}
							{#if group.type === 'follow'}
								followed you
							{:else}
								{group.type === 'like' ? 'liked' : 'regiorged'}
								<a href={ownPost(group)}>your post</a>
							{/if}
						</p>
						{#if group.type !== 'follow' && group.post?.content}
							<!-- which post, in one line: several groups can be about different posts -->
							<p class="truncate text-[0.9em] text-muted">{group.post.content}</p>
						{/if}
					{:else if !group.post}
						<!-- the post was deleted along with the notification, so this can't happen -->
					{:else if group.type === 'quote'}
						<p>
							<a href={`/@${sender.username}`}>@{sender.username}</a>
							<a href={senderPost(group)}>quoted</a>
							your post
						</p>
						{#if group.post.content}
							<p class="text-muted">{clip(group.post.content)}</p>
						{/if}
					{:else if group.type === 'mention'}
						<p>
							<a href={`/@${sender.username}`}>@{sender.username}</a>
							mentioned you in
							<a href={senderPost(group)}>a post</a>
						</p>
					{:else if group.type === 'ratio'}
						<p>
							<a href={`/@${sender.username}`}>@{sender.username}</a>
							ratioed
							<a href={senderPost(group)}>your post</a>
						</p>
					{:else if group.type === 'ratioed_by_you'}
						<p>
							You ratioed
							<a href={`/@${sender.username}`}>@{sender.username}</a>
							with <a href={ownPost(group)}>your reply</a>
						</p>
					{:else if group.type === 'reply'}
						<p>
							<a href={`/@${sender.username}`}>@{sender.username}</a>
							replied to
							<a href={senderPost(group)}>your post</a>
						</p>
						<p class="text-muted">{clip(group.post.content)}</p>
					{/if}
				</div>
			</div>
			{#if !group.read_at}
				<Button
					class="size-8 shrink-0"
					aria-label="Mark as read"
					onkeypress={(e) => {
						e.stopPropagation();
						e.preventDefault();
						readGroup(group, false);
					}}
					onclick={(e) => {
						e.stopPropagation();
						e.preventDefault();
						readGroup(group, false);
					}}><Check size="1em" /></Button
				>
			{/if}
		</div>
	{/each}
</div>

{#if next}
	<div class="mt-5 flex justify-center">
		<Button onclick={loadMore} disabled={loadingMore}
			>{loadingMore ? 'Loading...' : 'Load more'}</Button
		>
	</div>
{/if}
