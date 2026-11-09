<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Button from '#lib/components/Button.svelte';
	import type { PageData } from './$types';
	import { notisCount, user } from '#lib/store.js';
	import type { Notification } from '#lib/types.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getPushState, type PushState } from '#lib/push.js';
	import { api, withCursor, type Page } from '#lib/api.js';
	let { data }: { data: PageData } = $props();

	// reassignable so read state can be updated locally until the next load
	let notifications = $derived(data.notifications);
	// writable derived: the cursor of the next page, reset by every load
	let next = $derived(data.next);
	let loadingMore = $state(false);

	async function loadMore() {
		if (!next || loadingMore) return;
		loadingMore = true;
		try {
			const page = await api<Page<Notification>>(withCursor(data.source, next));
			const seen = new Set(notifications.map((n) => n.id));
			notifications = [...notifications, ...page.items.filter((n) => !seen.has(n.id))];
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

	const readNotification = async (notification: Notification, redirect = true) => {
		if (notification.read_at === null) {
			api(`notifications/${notification.id}/read`, { method: 'POST' }).catch(() => {});
			$notisCount -= 1;

			if (!redirect) {
				notifications = notifications.map((not) =>
					not.id === notification.id ? { ...not, read_at: new Date() } : not
				);
			}
		}
		if (redirect) {
			if (notification.type === 'follow' || !notification.post) {
				goto(`/@${notification.sender.username}`);
			} else if (
				notification.type === 'like' ||
				notification.type === 'ratioed_by_you' ||
				notification.type === 'regiorg'
			) {
				goto(`/@${$user?.username}/${notification.post.id}`);
			} else {
				goto(`/@${notification.sender.username}/${notification.post.id}`);
			}
		}
	};

	const readAll = async () => {
		try {
			await api('notifications/read', { method: 'POST' });
		} catch {
			return;
		}
		$notisCount = 0;
		const now = new Date();
		notifications = notifications.map((not) => (not.read_at ? not : { ...not, read_at: now }));
	};
</script>

<div class="flex items-center justify-between gap-2.5">
	<h1>Notifications</h1>
	{#if notifications.some((n) => !n.read_at)}
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
	{#each notifications as notification (notification.id)}
		<div
			class="flex cursor-pointer items-center justify-between rounded-[10px] bg-black/70 p-2.5 {notification.read_at
				? ''
				: 'border border-accent'}"
			role="button"
			tabindex="0"
			onkeypress={async () => {
				await readNotification(notification);
			}}
			onclick={async () => {
				await readNotification(notification);
			}}
		>
			<div class="flex min-w-0 gap-2.5">
				<div class="shrink-0"><Avatar user={notification.sender} size={50} /></div>
				<div class="flex min-w-0 flex-col justify-center wrap-anywhere">
					{#if notification.type === 'follow'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							followed you
						</p>
					{:else if !notification.post}
						<!-- the post was deleted along with the notification, so this can't happen -->
					{:else if notification.type === 'like'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							liked
							<a href={`/@${$user?.username}/${notification.post.id}`}>your post</a>
						</p>
					{:else if notification.type === 'regiorg'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							regiorged
							<a href={`/@${$user?.username}/${notification.post.id}`}>your post</a>
						</p>
					{:else if notification.type === 'quote'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							<a href={`/@${notification.sender.username}/${notification.post.id}`}>quoted</a>
							your post
						</p>
						{#if notification.post.content}
							<p class="text-muted">
								{notification.post.content.slice(
									0,
									100
								)}{#if notification.post.content.length > 100}...{/if}
							</p>
						{/if}
					{:else if notification.type === 'mention'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							mentioned you in
							<a href={`/@${notification.sender.username}/${notification.post.id}`}>a post</a>
						</p>
					{:else if notification.type === 'ratio'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							ratioed
							<a href={`/@${notification.sender.username}/${notification.post.id}`}>your post</a>
						</p>
					{:else if notification.type === 'ratioed_by_you'}
						<p>
							You ratioed
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							with <a href={`/@${$user?.username}/${notification.post.id}`}>your reply</a>
						</p>
					{:else if notification.type === 'reply'}
						<p>
							<a href={`/@${notification.sender.username}`}>@{notification.sender.username}</a>
							replied to
							<a href={`/@${notification.sender.username}/${notification.post.id}`}>your post</a>
						</p>
						<p class="text-muted">
							{notification.post.content.slice(
								0,
								100
							)}{#if notification.post.content.length > 100}...{/if}
						</p>
					{/if}
				</div>
			</div>
			{#if !notification.read_at}
				<Button
					class="size-8 shrink-0"
					aria-label="Mark as read"
					onkeypress={async (e) => {
						e.stopPropagation();
						e.preventDefault();
						await readNotification(notification, false);
					}}
					onclick={async (e) => {
						e.stopPropagation();
						e.preventDefault();
						await readNotification(notification, false);
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
