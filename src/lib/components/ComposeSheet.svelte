<script lang="ts">
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import { afterNavigate } from '$app/navigation';
	import { modal } from '#lib/modal.js';
	import { compose, closeCompose, composed } from '#lib/compose.svelte.js';
	import type { Post } from '#lib/types.js';
	import { keyboard } from '#lib/keyboard.svelte.js';
	import { lockScroll } from '#lib/scrollLock.js';
	import Button from './Button.svelte';
	import PostComposer from './PostComposer.svelte';

	afterNavigate(closeCompose);

	let sheet: HTMLDialogElement | undefined = $state();

	// the page behind doesn't scroll under the open composer, and on iOS a swipe doesn't pan the
	// viewport away from it while the keyboard is up (SGC-60)
	$effect(() => {
		if (!compose.open || !sheet) return;
		return lockScroll(sheet);
	});

	function oncreated(post: Post) {
		composed(post);
		closeCompose();
	}

	/** a tap on Post doesn't take the focus off the field: the keyboard stays up if it fails */
	const keepFocus = (e: MouseEvent) => e.preventDefault();
</script>

<!-- iOS only shrinks the visual viewport for the keyboard: the sheet follows what's visible, so
	the text being typed and the buttons stay above the keyboard. it places itself, so the layout
	doesn't scroll it into view (data-keyboard-fit) -->
<dialog
	bind:this={sheet}
	data-keyboard-fit
	class="fixed inset-0 z-999 m-0 h-full max-h-none w-screen max-w-none overscroll-none border-none bg-background p-0 text-foreground"
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
			class="flex h-full flex-col overflow-y-auto overscroll-contain px-5 pt-[calc(10px+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]"
		>
			<!-- Cancel and Post at the top, where the keyboard never covers them however long the
				text gets (SGC-29, SGC-60). the form is the composer's (form="compose-sheet") -->
			<div class="mb-2.5 flex shrink-0 items-center justify-between">
				<button
					type="button"
					class="cursor-pointer py-[5px] outline-none focus-visible:underline"
					onclick={closeCompose}>Cancel</button
				>
				<Button
					type="submit"
					form="compose-sheet"
					variant="primary"
					size="sm"
					class="w-10"
					onmousedown={keepFocus}
					aria-label="Post"
					title="Post"><SendHorizontal size={18} strokeWidth={1.8} /></Button
				>
			</div>
			<!-- the field grows up to what's left above the keyboard beside the Cancel row and the
				attachment buttons, so the line being typed stays in view -->
			<PostComposer
				autofocus
				formId="compose-sheet"
				maxHeight="max-h-[max(5lh,calc(var(--vv-height,100dvh)-env(safe-area-inset-top)-9rem))]"
				{oncreated}
			/>
		</div>
	{/if}
</dialog>
