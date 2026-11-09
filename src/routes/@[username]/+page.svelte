<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';
	import Posts from '#lib/components/Posts.svelte';
	import Post from '#lib/components/Post.svelte';
	import { user } from '#lib/store.js';
	import { api, messageOf } from '#lib/api.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import ModerationControls from '#lib/components/ModerationControls.svelte';
	import { getAvatar, websiteLabel } from '#lib/utils.js';
	import { openImage } from '#lib/imageViewer.svelte.js';

	let { data }: PageProps = $props();

	let error: string | null = $state(null);
	let profile = $derived(data.user);
	// writable derived: reset on navigation, updated by the follow button
	let follow = $derived(data.follow);
	// writable derived: cleared when the pinned post is deleted
	let pinned = $derived(data.pinned);
	let bio = $derived(data.bio);
	let website = $derived(data.website);
	let followBusy = $state(false);

	const tabClass = (active: boolean) =>
		`flex-1 border-b-2 p-2.5 text-center text-foreground hover:no-underline ${
			active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'
		}`;

	const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	// "A, B, and 3 others", like the profile card
	const followedByText = $derived.by(() => {
		const { users, total } = data.followedBy;
		const names = users.map((u) => u.name);
		const rest = total - names.length;
		if (rest > 0) return `${names.join(', ')}, and ${rest} other${rest === 1 ? '' : 's'}`;
		if (names.length > 1) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
		return names[0] ?? '';
	});

	async function toggleFollow() {
		followBusy = true;
		try {
			follow = await api(`users/${profile.username}/follow`, {
				method: follow.followed ? 'DELETE' : 'PUT'
			});
			error = null;
		} catch (e) {
			error = messageOf(e, 'Could not update follow');
		} finally {
			followBusy = false;
		}
	}

	async function logout() {
		try {
			await api('auth/logout', { method: 'POST' });
		} catch {
			// signed out already
		}
		// the realtime stream and the whole page belong to the account that was signed in
		location.href = '/';
	}
</script>

{#if error}
	<p class="mb-5 rounded-[5px] bg-danger p-[5px]">{error}</p>
{/if}
<!-- mobile: avatar and actions on one row, details full width below (like twitter);
	sm and up: avatar | details | actions -->
<div
	class="mb-5 grid grid-cols-[auto_1fr] gap-2.5 [grid-template-areas:'avatar_actions'_'info_info'] sm:grid-cols-[auto_1fr_auto] sm:[grid-template-areas:'avatar_info_actions']"
>
	<button
		type="button"
		class="shrink-0 cursor-zoom-in self-start rounded-full [grid-area:avatar] outline-none focus-visible:ring-2 focus-visible:ring-accent"
		aria-label="Expand {profile.name}'s avatar"
		onclick={() => openImage([getAvatar(profile, 1024)])}
	>
		<Avatar size={60} user={profile} clickable={false} />
	</button>

	<div class="min-w-0 [grid-area:info]">
		<h2 class="break-words">{profile.name}</h2>
		<p>
			@{profile.username}
			{#if data.bot}
				<span
					class="ml-1 rounded-full border border-accent px-2 align-middle text-[0.75em] text-accent"
					>bot</span
				>
			{/if}
		</p>
		{#if bio}
			<p class="mt-2 break-words whitespace-pre-line">{bio}</p>
		{/if}
		{#if website}
			<a
				class="mt-1 block break-all"
				href={website}
				target="_blank"
				rel="noopener noreferrer nofollow ugc">{websiteLabel(website)}</a
			>
		{/if}
		<p class="mt-1 flex gap-3 text-[0.9em] text-muted">
			<a class="text-inherit" href="/@{profile.username}/following"
				><b class="text-foreground">{nf.format(follow.following)}</b> following</a
			>
			<a class="text-inherit" href="/@{profile.username}/followers"
				><b class="text-foreground">{nf.format(follow.followers)}</b>
				{follow.followers === 1 ? 'follower' : 'followers'}</a
			>
		</p>
		{#if data.followedBy.total > 0}
			<a
				class="mt-2 flex items-center gap-2.5 text-[0.85em] text-muted"
				href="/@{profile.username}/followers/known"
			>
				<span class="flex shrink-0">
					{#each data.followedBy.users as u, i (u.username)}
						<span class="rounded-full ring-2 ring-background {i > 0 ? '-ml-2' : ''}">
							<Avatar size={24} user={u} clickable={false} />
						</span>
					{/each}
				</span>
				<span>Followed by {followedByText}</span>
			</a>
		{/if}
	</div>
	{#if $user && data.self}
		<div class="flex gap-2.5 self-center justify-self-end [grid-area:actions] sm:self-start">
			<!-- editing lives in the settings; this is the shortcut people look for on their profile -->
			<Button size="sm" href="/settings/profile">Edit profile</Button>
			<Button variant="danger" size="sm" onclick={logout}>Logout</Button>
		</div>
	{:else if $user}
		<div class="flex gap-2.5 self-center justify-self-end [grid-area:actions] sm:self-start">
			<Button
				size="sm"
				variant={follow.followed ? 'default' : 'primary'}
				disabled={followBusy}
				onclick={toggleFollow}>{follow.followed ? 'Unfollow' : 'Follow'}</Button
			>
			<Button size="sm" href={`/messages/${profile.username}`}>Message</Button>
		</div>
	{/if}
</div>

{#if data.moderation}
	<ModerationControls
		username={profile.username}
		banned={data.moderation.banned}
		muted={data.moderation.muted}
		banReason={data.moderation.ban_reason}
		muteReason={data.moderation.mute_reason}
		identity={data.moderation.identity}
	/>
{/if}

<nav class="mb-5 flex">
	<a
		class={tabClass(data.tab === 'posts')}
		href="/@{profile.username}"
		data-sveltekit-noscroll
		aria-current={data.tab === 'posts' ? 'page' : undefined}>Posts</a
	>
	<a
		class={tabClass(data.tab === 'replies')}
		href="/@{profile.username}?tab=replies"
		data-sveltekit-noscroll
		aria-current={data.tab === 'replies' ? 'page' : undefined}>Replies</a
	>
</nav>

{#if pinned}
	{#key pinned.id}
		<Post pinned post={pinned} onpostdeleted={() => (pinned = null)} />
	{/key}
{/if}
{#if data.posts.length === 0 && !pinned}
	<p class="text-center text-muted">
		{data.tab === 'replies' ? 'No replies yet.' : 'No posts yet.'}
	</p>
{/if}
{#key profile}
	<Posts
		source={data.source}
		next={data.next}
		showReplyTo={data.tab === 'replies'}
		posts={data.posts}
	/>
{/key}
