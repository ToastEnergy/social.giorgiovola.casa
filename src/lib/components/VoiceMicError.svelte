<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { platform } from '#lib/voiceSession.svelte.js';
	import type { MicError } from '#lib/voiceRecorder.svelte.js';

	// why the mic didn't start, and how to turn it back on (the chat input and the composers)
	let {
		error,
		onclose,
		class: className = ''
	}: { error: MicError; onclose: () => void; class?: string } = $props();

	const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<div
	class="flex items-start gap-2.5 rounded-[5px] border border-accent bg-background p-2.5 text-[0.9em] {className}"
	role="alert"
>
	<div class="flex min-w-0 flex-1 flex-col gap-[5px]">
		{#if error === 'denied'}
			<p class="font-bold">Microphone access is off</p>
			{#if platform === 'ios'}
				<p class="text-muted">
					Open Settings › Apps › Safari › Microphone and choose Ask or Allow (in Safari you can
					also tap ᴀA in the address bar › Website Settings › Microphone). Then try again.
				</p>
			{:else if platform === 'android'}
				<p class="text-muted">
					In Chrome, tap the icon left of the address bar › Permissions › Microphone and allow it.
					For the installed app: Chrome › ⋮ › Settings › Site settings › Microphone, then this
					site. Then try again.
				</p>
			{:else}
				<p class="text-muted">
					Click the icon at the left of the address bar, allow the microphone for this site and
					try again.
				</p>
			{/if}
		{:else if error === 'nomic'}
			<p class="font-bold">No microphone found</p>
			<p class="text-muted">Connect one (or allow this browser to use it) and try again.</p>
		{:else}
			<p class="font-bold">The microphone didn't start</p>
			<p class="text-muted">Another app may be using it. Close it and try again.</p>
		{/if}
	</div>
	<button
		type="button"
		class="flex shrink-0 cursor-pointer opacity-70 outline-none hover:opacity-100"
		aria-label="Close"
		title="Close"
		onmousedown={keepFocus}
		onclick={onclose}><X size={18} /></button
	>
</div>
