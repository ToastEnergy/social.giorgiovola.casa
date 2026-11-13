<script lang="ts">
	import Post from '#lib/components/Post.svelte';
	import type { Post as PostType } from '#lib/types.js';
	import type { PageProps } from './$types';
	import Posts from '#lib/components/Posts.svelte';
	import PostComposer from '#lib/components/PostComposer.svelte';
	import ReplyDock from '#lib/components/ReplyDock.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { user } from '#lib/store.js';
	import LoadingScreen from '#lib/components/LoadingScreen.svelte';
	import { onRealtime } from '#lib/realtime.js';
	import { PUBLIC_NO_REPLIES_MESSAGE } from '$app/env/public';
	import { tick } from 'svelte';

	let { data }: PageProps = $props();

	// touch devices reply from a bar above the bottom one instead of the composer above the replies
	const touch = new MediaQuery('(pointer: coarse)');
	// the server can't tell which one the device needs: it renders both and css shows the right
	// one, so the page doesn't flash the composer and swap it for the bar once the script runs.
	// after hydrating only the right one stays mounted
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	let replies: PostType[] = $state([]);
	let loaded = $state(false);

	// the post the replies and parents on screen belong to: a reload of the same one (back from a
	// dropped connection) keeps them until the new lists arrive, instead of flashing empty
	let repliesOf: number | null = null;
	let parentsOf: number | null = null;

	// the streamed replies of the open post: navigating to another post starts over
	$effect(() => {
		const pending = data.streamed.replies;
		const id = data.post.id;
		let current = true;
		if (repliesOf !== id) {
			loaded = false;
			replies = [];
		}
		repliesOf = id;
		pending.then((list) => {
			if (!current) return;
			// replies sent from the bar (or arrived) while the list was loading stay. older ones
			// missing from it were deleted
			const newest = list.reduce((max, l) => Math.max(max, l.id), 0);
			replies = [...list, ...replies.filter((r) => r.id > newest)];
			loaded = true;
		});
		return () => (current = false);
	});

	// the thread above a reply. they arrive after the post is on screen: the post keeps its place
	// and the parents are reached by scrolling up
	let parents: PostType[] = $state([]);
	let parentsFailed = $state(false);
	let opened: HTMLDivElement | undefined = $state();

	$effect(() => {
		const pending = data.streamed.parents;
		const id = data.post.id;
		let current = true;
		if (parentsOf !== id) parents = [];
		parentsOf = id;
		parentsFailed = false;
		pending.then(async (list) => {
			// a frame later: after the navigation's own scroll to the top, before anything is painted
			await new Promise(requestAnimationFrame);
			if (!current) return;
			if (!list) return (parentsFailed = true);
			if (!list.length) return;
			const before = opened?.getBoundingClientRect().top;
			parents = list;
			await tick();
			// whatever the browser's own scroll anchoring did, the post ends up where it was
			if (current && opened && before !== undefined)
				window.scrollBy(0, opened.getBoundingClientRect().top - before);
		});
		return () => (current = false);
	});

	$effect(() =>
		onRealtime('post', (post) => {
			if (post.reply_to?.id !== data.post.id || replies.some((r) => r.id === post.id)) return;
			replies = [...replies, post];
		})
	);

	function onCreated(post: PostType) {
		if (!replies.some((r) => r.id === post.id)) replies = [...replies, post];
	}
</script>

<!-- mouse devices: the post, the reply composer and the replies are three separate black blocks.
	the replies block fills the rest of the window (the layout makes these pages a column) -->
<div
	class="not-pointer-coarse:mb-2.5 not-pointer-coarse:rounded-[15px] not-pointer-coarse:bg-black not-pointer-coarse:p-5 not-pointer-coarse:max-nav:rounded-r-none"
>
	<!-- touch devices: as close to the screen's edges as the timeline, like the replies. the
		parents share the post's block so the thread line runs from avatar to avatar -->
	<div class="pointer-coarse:-mx-2.5">
		{#each parents as parent, i (parent.id)}
			<!-- the first one links further up when the thread goes on above it -->
			<Post post={parent} showReplyTo={i === 0} threadDown={true} loadReplies={false} />
		{/each}
		<div bind:this={opened}>
			<!-- the "Replying to" link only when the parents couldn't be shown -->
			<Post post={data.post} showReplyTo={parentsFailed} isPostOpen={true} loadReplies={false} />
		</div>
	</div>
</div>
<!-- touch devices: an edge to edge line between the post and its replies, like the top bar's -->
<!-- prettier-ignore -->
<div class="-mx-5 mt-2.5 hidden h-px scale-y-50 bg-foreground/60 pointer-coarse:block"></div>

{#if $user && (!hydrated || !touch.current)}
	<div class="mb-2.5 rounded-[15px] bg-black p-5 pointer-coarse:hidden max-nav:rounded-r-none">
		<PostComposer alone replyTo={data.post.id} oncreated={onCreated} />
	</div>
{/if}

<div
	class="not-pointer-coarse:flex-1 not-pointer-coarse:rounded-[15px] not-pointer-coarse:bg-black not-pointer-coarse:p-5 not-pointer-coarse:max-nav:rounded-r-none not-pointer-coarse:max-nav:rounded-bl-none"
>
	{#if !loaded}
		<div class="flex items-center justify-center pointer-coarse:mt-5">
			<LoadingScreen size={64} />
		</div>
	{:else}
		<!-- touch devices: the replies reach as close to the screen's edges as the timeline -->
		<div class="pointer-coarse:mt-5 pointer-coarse:-mx-2.5">
			{#if replies.length === 0}
				<p class="text-center text-muted">{PUBLIC_NO_REPLIES_MESSAGE}</p>
			{/if}
			<Posts scrollToNew={true} loadReplies={true} replies={true} posts={replies} />
		</div>
	{/if}
</div>

{#if $user && (!hydrated || touch.current)}
	<div class="not-pointer-coarse:hidden">
		<ReplyDock replyTo={data.post.id} oncreated={onCreated} />
	</div>
{/if}
