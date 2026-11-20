<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Button from '#lib/components/Button.svelte';
	import type { PageData } from './$types';
	import { notisCount, user } from '#lib/store.js';
	import type { NotificationGroup } from '#lib/types.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getPushState, type PushState } from '#lib/push.js';
	import { api, withCursor, type Page } from '#lib/api.js';
	import { closeStale } from '#lib/seen.js';
	import { page } from '$app/state';
	import { activeProfiles, withAs } from '#lib/inbox.js';
	import { inboxUnread, setInboxUnread } from '#lib/inboxUnread.svelte.js';
	import type { SwitcherAccount } from '#lib/types.js';
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
			// later pages leave out the groups that moved up, but refreshTop may have shown one
			const seen = new Set(groups.map((g) => g.key));
			groups = [...groups, ...page.items.filter((g) => !seen.has(g.key))];
			next = page.next_cursor;
		} catch {
			// the button stays, so it can be tried again
		} finally {
			loadingMore = false;
		}
	}
	/**
	 * Puts the newest groups on top, keeping the pages already loaded below them (and the scroll):
	 * a group that grew is in the fresh page, so its old copy goes.
	 */
	async function refreshTop() {
		try {
			const page = await api<Page<NotificationGroup>>(data.source);
			const fresh = new Set(page.items.map((g) => g.key));
			groups = [...page.items, ...groups.filter((g) => !fresh.has(g.key))];
		} catch {
			// the next notification tries again
		}
	}

	// the profiles of the account, from the layout (the account switcher's data): no extra request
	const profiles = $derived(activeProfiles((page.data.accounts ?? []) as SwitcherAccount[]));
	const unreadOf = (p: (typeof profiles)[number]) => inboxUnread(p.username, p.unread);
	const allUnread = $derived(profiles.reduce((n, p) => n + unreadOf(p), 0));
	// ?profiles= of the reads: the filter, as in the list (nothing: only the profile in use)
	const scopeQuery = $derived(data.scope ? `?profiles=${encodeURIComponent(data.scope)}` : '');
	const tabClass = (active: boolean) =>
		`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-foreground hover:no-underline ${
			active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'
		}`;

	let push: PushState | null = $state(null);
	// the unread count is pushed by the layout; fetch the new ones when it grows
	onMount(() => {
		getPushState().then((state) => (push = state));
		let last = $notisCount;
		return notisCount.subscribe((count) => {
			if (count > last) void refreshTop();
			last = count;
		});
	});

	// the profile a group is for: in the inbox of several profiles it is the recipient
	const recipient = (group: NotificationGroup) =>
		group.recipients?.[0]?.username ?? $user?.username;
	// opening a group of another profile shows its target as that profile, without switching: the
	// profile in use comes first among the recipients when it is one of them
	const asOf = (group: NotificationGroup) => {
		const first = group.recipients?.[0]?.username;
		return first && first !== $user?.username ? first : null;
	};
	const to = (group: NotificationGroup, href: string) => withAs(href, asOf(group));
	const ownPost = (group: NotificationGroup) =>
		to(group, `/@${recipient(group)}/${group.post?.id}`);
	// recipients other than the profile in use: they get their avatars and a "to" line
	const foreign = (group: NotificationGroup) =>
		!!group.recipients?.some((r) => r.username !== $user?.username);
	const senderPost = (group: NotificationGroup) =>
		to(group, `/@${group.senders[0]?.username}/${group.post?.id}`);

	/** Where clicking the group goes. */
	function target(group: NotificationGroup) {
		const sender = group.senders[0];
		if (group.type === 'invites') return '/settings/invites';
		if (group.type === 'follow')
			return to(
				group,
				group.count > 1 ? `/@${recipient(group)}/followers` : `/@${sender?.username}`
			);
		if (!group.post) return to(group, `/@${sender?.username}`);
		if (group.type === 'like' || group.type === 'ratioed_by_you' || group.type === 'regiorg')
			return ownPost(group);
		return senderPost(group);
	}

	const readGroup = (group: NotificationGroup, redirect = true) => {
		if (group.unread > 0) {
			api(`notifications/groups/${group.key}/read${scopeQuery}`, { method: 'POST' })
				.then(() => closeStale())
				.catch(() => {});
			$notisCount = Math.max(0, $notisCount - group.unread);
			const now = new Date();
			groups = groups.map((g) => (g.key === group.key ? { ...g, unread: 0, read_at: now } : g));
		}
		if (redirect) goto(target(group));
	};

	/** A click on the card: a link in it goes where it points, the card only gets marked read. */
	function clickGroup(e: MouseEvent, group: NotificationGroup) {
		readGroup(group, !(e.target as Element).closest('a'));
	}

	function keyGroup(e: KeyboardEvent, group: NotificationGroup) {
		// keys on a link or button inside the card are theirs
		if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
		e.preventDefault();
		readGroup(group);
	}

	const readAll = async () => {
		try {
			await api(`notifications/read${scopeQuery}`, { method: 'POST' });
		} catch {
			return;
		}
		if (data.scope === 'all' || data.scope === null) $notisCount = 0;
		else {
			// one profile: only its share of the badge goes
			const own = profiles.find((p) => p.username === data.scope);
			if (own) $notisCount = Math.max(0, $notisCount - unreadOf(own));
			setInboxUnread(data.scope, 0);
		}
		void closeStale();
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
{#if data.scope && profiles.length > 1}
	<nav
		class="mt-2.5 flex overflow-x-auto border-b border-line [scrollbar-width:none]"
		aria-label="Notifications of"
	>
		<a
			class={tabClass(data.scope === 'all')}
			href="/notifications"
			data-sveltekit-replacestate
			data-sveltekit-noscroll
			aria-current={data.scope === 'all' ? 'page' : undefined}
		>
			All
			{#if allUnread > 0}<span class="text-[0.75em] text-accent">{allUnread}</span>{/if}
		</a>
		{#each profiles as p (p.username)}
			<a
				class={tabClass(data.scope === p.username)}
				href={`/notifications?profile=${encodeURIComponent(p.username)}`}
				data-sveltekit-replacestate
				data-sveltekit-noscroll
				aria-current={data.scope === p.username ? 'page' : undefined}
			>
				<Avatar user={p} size={20} clickable={false} />
				<span class="whitespace-nowrap">@{p.username}</span>
				{#if unreadOf(p) > 0}<span class="text-[0.75em] text-accent">{unreadOf(p)}</span>{/if}
			</a>
		{/each}
	</nav>
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
			onkeydown={(e) => keyGroup(e, group)}
			onclick={(e) => clickGroup(e, group)}
		>
			<div class="flex min-w-0 gap-2.5">
				<div class="relative shrink-0 self-start">
					{#if group.senders.length > 1}
						<!-- the latest senders stacked: the group reads as one entry -->
						<div class="flex w-[50px] -space-x-4 self-start pt-1">
							{#each group.senders as s (s.id)}
								<div class="rounded-full border-2 border-black">
									<Avatar user={s} size={24} />
								</div>
							{/each}
						</div>
					{:else if sender}
						<Avatar user={sender} size={50} />
					{/if}
					{#if group.recipients && foreign(group)}
						<!-- the profiles it is for, on the corner of the avatar -->
						<div class="absolute -right-1.5 -bottom-1.5 flex -space-x-2">
							{#each group.recipients.slice(0, 3) as r (r.id)}
								<div class="rounded-full border-2 border-black" title={`@${r.username}`}>
									<Avatar user={r} size={20} clickable={false} />
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex min-w-0 flex-col justify-center wrap-anywhere">
					{#if !sender}
						<!-- the sender was deleted along with the notification, so this can't happen -->
					{:else if group.type === 'follow' || group.type === 'like' || group.type === 'regiorg'}
						{@const { parts, others } = people(group)}
						<p>
							{#each parts as part (part.user.id)}
								<a href={to(group, `/@${part.user.username}`)}>@{part.user.username}</a
								>{part.sep}{' '}
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
					{:else if group.type === 'invites'}
						{@const n = group.invites ?? 0}
						<p>
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							gave you {n}
							{n === 1 ? 'invite' : 'invites'}
						</p>
						<p class="text-[0.9em] text-muted">
							<a href="/settings/invites">Invite someone</a> to join
						</p>
					{:else if !group.post}
						<!-- the post was deleted along with the notification, so this can't happen -->
					{:else if group.type === 'quote'}
						<p>
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							<a href={senderPost(group)}>quoted</a>
							{group.recipients ? 'a post' : 'your post'}
						</p>
						{#if group.post.content}
							<p class="text-muted">{clip(group.post.content)}</p>
						{/if}
					{:else if group.type === 'mention'}
						<p>
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							mentioned {group.recipients ? '' : 'you '}in
							<a href={senderPost(group)}>a post</a>
						</p>
					{:else if group.type === 'ratio'}
						<p>
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							ratioed
							<a href={senderPost(group)}>{group.recipients ? 'a post' : 'your post'}</a>
						</p>
					{:else if group.type === 'ratioed_by_you'}
						<p>
							You ratioed
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							with <a href={ownPost(group)}>your reply</a>
						</p>
					{:else if group.type === 'reply'}
						<p>
							<a href={to(group, `/@${sender.username}`)}>@{sender.username}</a>
							replied to
							<a href={senderPost(group)}>{group.recipients ? 'a post' : 'your post'}</a>
						</p>
						<p class="text-muted">{clip(group.post.content)}</p>
					{/if}
					{#if group.recipients && foreign(group)}
						<p class="text-[0.85em] text-muted">
							to {group.recipients.map((r) => `@${r.username}`).join(', ')}
						</p>
					{/if}
				</div>
			</div>
			{#if !group.read_at}
				<Button
					class="size-8 shrink-0"
					aria-label="Mark as read"
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
