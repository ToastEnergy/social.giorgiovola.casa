<script lang="ts">
	import type { PageProps } from './$types';
	import Posts from '#lib/components/Posts.svelte';
	import Post from '#lib/components/Post.svelte';
	import PostComposer from '#lib/components/PostComposer.svelte';
	import type { Post as PostType } from '#lib/types.js';
	import { user } from '#lib/store.js';
	import { onMount } from 'svelte';
	import { onRealtime } from '#lib/realtime.js';
	import { onComposed } from '#lib/compose.svelte.js';
	import AccountSwitcher from '#lib/components/AccountSwitcher.svelte';
	import Settings from '@lucide/svelte/icons/settings';

	let { data }: PageProps = $props();

	// writable derived: reset on navigation (feed switch), prepended to by realtime posts
	let posts = $derived(data.posts);
	// writable derived: a pinned post that is deleted or unpinned leaves
	let pinned = $derived(data.pinned);

	// the following feed only shows posts by followed profiles and our own
	function belongs(post: PostType) {
		if (data.feed !== 'following') return true;
		return post.user.username === $user?.username || !!data.following?.includes(post.user.username);
	}

	function add(post: PostType) {
		if (post.reply_to || !belongs(post) || posts.some((p) => p.id === post.id)) return;
		if (pinned.some((p) => p.id === post.id)) return;
		posts = [post, ...posts];
	}

	// a followed profile (or you) regiorged a post: it moves to the top of the following feed
	function addRegiorg(post: PostType) {
		const by = post.regiorged_by?.username;
		if (data.feed !== 'following' || !by) return;
		const mine = by === $user?.username;
		if (!mine && !data.following?.includes(by)) return;
		if (pinned.some((p) => p.id === post.id)) return;
		// realtime posts are anonymous: keep what we know of our own like and regiorg
		const old = posts.find((p) => p.id === post.id);
		const entry = { ...post, liked: old?.liked, regiorged: mine || old?.regiorged };
		posts = [entry, ...posts.filter((p) => p.id !== post.id)];
	}

	onMount(() => {
		const offPost = onRealtime('post', add);
		const offRegiorg = onRealtime('regiorg', addRegiorg);
		// written in the full screen composer (touch devices)
		const offComposed = onComposed(add);
		return () => {
			offComposed();
			offPost();
			offRegiorg();
		};
	});

	const tabClass = (active: boolean) =>
		`flex-1 border-b-2 p-2.5 text-center text-foreground hover:no-underline ${
			active ? 'border-accent' : 'border-transparent opacity-60 hover:opacity-100'
		}`;
</script>

<!-- touch devices: the profile, the logo and settings in a row above the timeline (mouse devices
	have them in the sidebar and the rail) -->
<!-- 15px between the logo and the line, the same as between the line and the first post's avatar:
	12px padding + 3px of the row's height the 32px logo leaves free next to the 38px avatar, and
	5px margin + the post's 10px padding. above the timeline, so the profile menu opens over the posts -->
<div class="relative z-10 hidden grid-cols-3 items-center py-3 pointer-coarse:grid">
	<div class="flex justify-start">
		<AccountSwitcher size={38} start />
	</div>
	<a href="/" class="flex justify-center hover:no-underline" aria-label="Home">
		<img class="size-8 max-w-none" src="/Logo.png" alt="" width="32" height="32" />
	</a>
	<div class="flex justify-end">
		{#if $user}
			<a
				href="/settings"
				class="flex size-8 items-center justify-center text-foreground hover:no-underline"
				title="Settings"
				aria-label="Settings"><Settings size={24} strokeWidth={2} /></a
			>
		{/if}
	</div>
</div>
<!-- edge to edge, thin like the composer's divider -->
<!-- prettier-ignore -->
<div class="-mx-5 mb-[5px] hidden h-px scale-y-50 bg-foreground/60 pointer-coarse:block"></div>

{#if $user}
	{#if data.followingFeedEnabled}
		<nav class="mb-5 flex">
			<a
				class={tabClass(data.feed === 'all')}
				href="/?feed=all"
				aria-current={data.feed === 'all' ? 'page' : undefined}>All</a
			>
			<a
				class={tabClass(data.feed === 'following')}
				href="/?feed=following"
				aria-current={data.feed === 'following' ? 'page' : undefined}>Following</a
			>
		</nav>
	{/if}
	<!-- touch devices write posts from the button in the bottom bar instead -->
	<div class="pointer-coarse:hidden">
		<PostComposer oncreated={add} />
	</div>
{/if}

<!-- on touch devices the timeline reaches closer to the screen's edges -->
<div class="pointer-coarse:-mx-2.5">
	{#each pinned as post (post.id)}
		<Post
			pinned
			pinnedLabel="Pinned for everyone"
			{post}
			onpostdeleted={(id) => (pinned = pinned.filter((p) => p.id !== id))}
		/>
	{/each}

	{#if data.feed === 'following' && posts.length === 0}
		<p class="text-center text-muted">
			Nothing here yet. Follow people from their profile to see their posts.
		</p>
	{/if}

	{#key data.feed}
		<Posts source={data.source} next={data.next} {posts} />
	{/key}
</div>
