<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { modal } from '#lib/modal.js';
	import { compose, closeCompose, composed } from '#lib/compose.svelte.js';
	import type { Post } from '#lib/types.js';
	import { keyboard } from '#lib/keyboard.svelte.js';
	import PostComposer from './PostComposer.svelte';

	afterNavigate(closeCompose);

	// the page behind doesn't scroll under the open composer
	$effect(() => {
		if (!compose.open) return;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = overflow;
		};
	});

	function oncreated(post: Post) {
		composed(post);
		closeCompose();
	}
</script>

<!-- iOS only shrinks the visual viewport for the keyboard: the sheet follows what's visible, so
	the text being typed and the buttons stay above the keyboard. it places itself, so the layout
	doesn't scroll it into view (data-keyboard-fit) -->
<dialog
	data-keyboard-fit
	class="fixed inset-0 z-999 m-0 h-full max-h-none w-screen max-w-none border-none bg-background p-0 text-foreground"
	style:top={keyboard.inset ? 'var(--vv-top)' : undefined}
	style:height={keyboard.inset ? 'var(--vv-height)' : undefined}
	open={compose.open}
	aria-modal="true"
	aria-label="New post"
	use:modal={{ open: compose.open, onclose: closeCompose }}
>
	{#if compose.open}
		<div
			data-modal-panel
			class="flex h-full flex-col overflow-y-auto px-5 pt-[calc(10px+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]"
		>
			<div class="mb-2.5 flex items-center">
				<button
					type="button"
					class="cursor-pointer py-[5px] outline-none focus-visible:underline"
					onclick={closeCompose}>Cancel</button
				>
			</div>
			<!-- the field grows up to what's left above the keyboard beside the Cancel row and the
				buttons, so the line being typed and the Post button stay in view -->
			<PostComposer
				autofocus
				maxHeight="max-h-[max(5lh,calc(var(--vv-height,100dvh)-env(safe-area-inset-top)-9rem))]"
				{oncreated}
			/>
		</div>
	{/if}
</dialog>
