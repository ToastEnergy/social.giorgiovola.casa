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

	let { data }: PageProps = $props();

	// touch devices reply from a bar above the bottom one instead of the composer above the replies
	const touch = new MediaQuery('(pointer: coarse)');

	let replies: PostType[] = $state([]);
	let loaded = $state(false);

	// the streamed replies of the open post: navigating to another post starts over
	$effect(() => {
		const pending = data.streamed.replies;
		let current = true;
		loaded = false;
		replies = [];
		pending.then((list) => {
			if (!current) return;
			// replies sent from the bar while the list was loading stay
			replies = [...list, ...replies.filter((r) => !list.some((l) => l.id === r.id))];
			loaded = true;
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
	<!-- touch devices: as close to the screen's edges as the timeline, like the replies -->
	<div class="pointer-coarse:-mx-2.5">
		<Post post={data.post} showReplyTo={true} isPostOpen={true} loadReplies={false} />
	</div>
</div>
<!-- touch devices: an edge to edge line between the post and its replies, like the top bar's -->
<!-- prettier-ignore -->
<div class="-mx-5 mt-2.5 hidden h-px scale-y-50 bg-foreground/60 pointer-coarse:block"></div>

{#if $user && !touch.current}
	<div class="mb-2.5 rounded-[15px] bg-black p-5 max-nav:rounded-r-none">
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

{#if $user && touch.current}
	<ReplyDock replyTo={data.post.id} oncreated={onCreated} />
{/if}
