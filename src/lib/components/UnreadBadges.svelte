<script lang="ts">
	import MessageCircle from '@lucide/svelte/icons/message-circle';
	let { notifications, messages }: { notifications: number; messages: number } = $props();

	const pill = 'flex shrink-0 items-center gap-[3px] rounded-full px-[7px] text-[0.75em] font-bold';
</script>

<!-- notifications are a filled pill, messages an outlined one with the chat bubble of the nav -->
{#if notifications > 0}
	<span class="{pill} bg-accent text-background" title="Unread notifications">{notifications}</span>
{/if}
{#if messages > 0}
	<span class="{pill} border border-accent text-accent" title="Unread messages">
		<MessageCircle size="0.9em" />{messages}
	</span>
{/if}
