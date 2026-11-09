<script lang="ts">
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	import { page } from '$app/state';
	import Button from '#lib/components/Button.svelte';
	import ConversationList from '#lib/components/ConversationList.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	let list = $state<ReturnType<typeof ConversationList>>();

	const chat = $derived(
		page.route.id === '/messages/[username]' || page.route.id === '/messages/groups/[id]'
	);
	const index = $derived(page.route.id === '/messages');
</script>

{#if (chat || index) && data.conversations && data.groups}
	<!-- wide screens keep the list beside the open chat (or an empty one); narrow ones show only
		the list on the index and only the chat in a chat. on mouse devices each is its own black,
		rounded block as tall as the window allows and the chat takes the space the list leaves. on
		touch devices there are no blocks: the list reaches 10px past the column on both sides (room
		for its rows' hover background), so alone it is 20px wider than the column -->
	<div class="flex gap-5 not-pointer-coarse:gap-2.5">
		<aside
			class="min-w-0 shrink-0 overscroll-contain not-pointer-coarse:h-[calc(100dvh-40px-var(--bar))] not-pointer-coarse:overflow-y-auto not-pointer-coarse:rounded-[15px] not-pointer-coarse:bg-black not-pointer-coarse:p-5 pointer-coarse:-ml-2.5 pointer-coarse:px-2.5 {chat
				? 'hidden h-[calc(100dvh-120px)] w-85 overflow-y-auto lg:block'
				: 'w-[calc(100%+20px)] not-pointer-coarse:w-full lg:h-[calc(100dvh-120px)] lg:w-85 lg:overflow-y-auto'}"
		>
			<ConversationList bind:this={list} conversations={data.conversations} groups={data.groups} />
		</aside>
		{#if index}
			<div
				class="hidden h-[calc(100dvh-120px)] min-w-0 flex-1 flex-col items-center justify-center gap-2.5 text-center not-pointer-coarse:h-[calc(100dvh-40px-var(--bar))] not-pointer-coarse:rounded-[15px] not-pointer-coarse:bg-black lg:flex"
			>
				<MessageCircle class="mb-2.5 size-12" strokeWidth={1.5} />
				<h2 class="text-[1.3em] font-extrabold">Start Conversation</h2>
				<p class="text-muted">
					Choose from your existing conversations,<br />or start a new one.
				</p>
				<Button class="mt-2.5" onclick={() => list?.focusSearch()}>New chat</Button>
			</div>
		{:else}
			<div
				class="min-w-0 flex-1 not-pointer-coarse:h-[calc(100dvh-40px-var(--bar))] not-pointer-coarse:rounded-[15px] not-pointer-coarse:bg-black not-pointer-coarse:p-5"
			>
				{@render children()}
			</div>
		{/if}
	</div>
{:else}
	{@render children()}
{/if}
