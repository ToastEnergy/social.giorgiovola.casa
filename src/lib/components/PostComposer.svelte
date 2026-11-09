<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import ChartNoAxesColumn from '@lucide/svelte/icons/chart-no-axes-column';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import X from '@lucide/svelte/icons/x';
	import { errorOf } from '#lib/api.js';
	import { onMount } from 'svelte';
	import type { Post, QuotedPost } from '#lib/types.js';
	import MentionInput from './MentionInput.svelte';
	import QuoteCard from './QuoteCard.svelte';
	import Button from './Button.svelte';
	import Avatar from './Avatar.svelte';
	import LoadingScreen from './LoadingScreen.svelte';
	import UploadProgress from './UploadProgress.svelte';
	import { Attachment, UploadError, uploadIds } from '#lib/attachment.svelte.js';
	import { user } from '#lib/store.js';
	import { onProfileSwitch, takeDraft, type ComposerDraft } from '#lib/composerDraft.js';
	import { page } from '$app/state';

	type Props = {
		/** Set to reply to a post instead of creating a top level one. */
		replyTo?: number | null;
		/** Set to quote a post (a quote regiorg): it is shown under the input. */
		quoteOf?: QuotedPost | null;
		/** Defaults to the message of the day set by the admins. */
		placeholder?: string;
		/** focuses the input when mounted (the full screen composer) */
		autofocus?: boolean;
		oncreated?: (post: Post) => void;
	};

	let {
		replyTo = null,
		quoteOf = null,
		placeholder: placeholderProp,
		autofocus = false,
		oncreated
	}: Props = $props();

	const placeholder = $derived(placeholderProp ?? page.data.motd ?? '');

	const MAX_IMAGES = 5;
	const MAX_BYTES = 10 * 1024 * 1024;
	const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

	const MAX_POLL_OPTIONS = 4;
	const MAX_POLL_OPTION = 80;
	const POLL_DURATIONS = [
		[60, '1 hour'],
		[6 * 60, '6 hours'],
		[24 * 60, '1 day'],
		[3 * 24 * 60, '3 days'],
		[7 * 24 * 60, '7 days']
	] as const;

	let content = $state('');
	// null when the post has no poll
	let pollOptions: string[] | null = $state(null);
	let pollMinutes = $state(24 * 60);
	let attachments: Attachment[] = $state([]);
	let error: string | null = $state(null);
	type Draft = {
		key: number;
		content: string;
		attachments: Attachment[];
		pollOptions: string[] | null;
		pollMinutes: number;
	};
	/** posts on their way to the server, shown under the form until they land */
	let pending: Draft[] = $state([]);
	let pendingKey = 0;
	let dragging = $state(false);
	let dragDepth = 0;
	let fileInput: HTMLInputElement | undefined = $state();
	let textarea: HTMLTextAreaElement | undefined = $state();
	let errorTimeout: ReturnType<typeof setTimeout>;
	/** submits still running, waited for before switching profile */
	const inflight = new Set<Promise<void>>();

	/** which composer a draft saved across a profile switch belongs to */
	const draftKey = () =>
		replyTo != null ? `reply:${replyTo}` : quoteOf ? `quote:${quoteOf.id}` : 'post';

	const isEmpty = () => !content.trim() && attachments.length === 0 && !pollOptions;

	function showError(message: string) {
		error = message;
		clearTimeout(errorTimeout);
		errorTimeout = setTimeout(() => (error = null), 4000);
	}

	function addOption() {
		if (pollOptions && pollOptions.length < MAX_POLL_OPTIONS) pollOptions = [...pollOptions, ''];
	}

	function removeOption(index: number) {
		if (pollOptions) pollOptions = pollOptions.filter((_, i) => i !== index);
	}

	function isImage(file: File) {
		return file.type.startsWith('image/') || (!file.type && IMAGE_EXT_RE.test(file.name));
	}

	function addFiles(files: Iterable<File>) {
		const added: Attachment[] = [];
		for (const file of files) {
			if (!isImage(file)) {
				showError(`${file.name || 'That file'} is not an image.`);
				continue;
			}
			if (file.size > MAX_BYTES) {
				showError(`${file.name || 'Image'} is too big, max size is 10mb.`);
				continue;
			}
			if (attachments.length + added.length >= MAX_IMAGES) {
				showError(`You can attach at most ${MAX_IMAGES} images.`);
				break;
			}
			// uploaded right away, so posting doesn't wait for it
			const attachment = new Attachment(file);
			attachment.done.catch((e) => {
				// once it's part of a post, submit reports it
				if (!attachments.includes(attachment)) return;
				showError(e instanceof UploadError ? e.message : 'Could not upload the image.');
				removeAttachment(attachment);
			});
			added.push(attachment);
		}
		if (added.length) attachments = [...attachments, ...added];
	}

	function removeAttachment(attachment: Attachment) {
		attachment.discard();
		attachments = attachments.filter((a) => a !== attachment);
	}

	function clearAttachments() {
		for (const a of attachments) a.discard();
		attachments = [];
	}

	function onFilesSelected() {
		if (!fileInput) return;
		addFiles(Array.from(fileInput.files ?? []));
		// lets the same file be picked again after removing it
		fileInput.value = '';
	}

	function onPaste(e: ClipboardEvent) {
		const files = Array.from(e.clipboardData?.files ?? []);
		if (files.length === 0) return;
		e.preventDefault();
		addFiles(files);
	}

	// dropping works anywhere on the page: otherwise a slightly missed drop would make the
	// browser navigate away to the image
	const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

	onMount(() => {
		// synchronous, so that iOS still counts it as part of the tap and opens the keyboard
		if (autofocus) textarea?.focus();
		const onDragEnter = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth++;
			dragging = true;
		};
		const onDragOver = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		};
		const onDragLeave = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			dragDepth = Math.max(0, dragDepth - 1);
			if (dragDepth === 0) dragging = false;
		};
		const onDrop = (e: DragEvent) => {
			if (!hasFiles(e)) return;
			e.preventDefault();
			dragDepth = 0;
			dragging = false;
			addFiles(Array.from(e.dataTransfer?.files ?? []));
		};
		window.addEventListener('dragenter', onDragEnter);
		window.addEventListener('dragover', onDragOver);
		window.addEventListener('dragleave', onDragLeave);
		window.addEventListener('drop', onDrop);

		let destroyed = false;
		// written before a profile switch (which reloads the page): put it back
		takeDraft(draftKey()).then((draft) => {
			if (!draft || destroyed || !isEmpty()) return;
			content = draft.content;
			pollOptions = draft.pollOptions;
			pollMinutes = draft.pollMinutes;
			// uploaded again: the old uploads belonged to the other profile
			addFiles(draft.files);
		});
		const unregister = onProfileSwitch(async (): Promise<ComposerDraft | null> => {
			// a post on its way either lands or comes back to the form, rather than being cut off
			await Promise.allSettled([...inflight]);
			if (isEmpty()) return null;
			for (const a of attachments) a.unstage();
			return {
				key: draftKey(),
				content,
				pollOptions: pollOptions && [...pollOptions],
				pollMinutes,
				files: attachments.map((a) => a.file)
			};
		});

		return () => {
			destroyed = true;
			unregister();
			window.removeEventListener('dragenter', onDragEnter);
			window.removeEventListener('dragover', onDragOver);
			window.removeEventListener('dragleave', onDragLeave);
			window.removeEventListener('drop', onDrop);
			clearTimeout(errorTimeout);
			clearAttachments();
			for (const draft of pending) for (const a of draft.attachments) a.release();
		};
	});

	async function submit() {
		if (!content.trim() && attachments.length === 0) return;
		if (pollOptions && !content.trim()) return showError('A poll needs a question.');
		if (pollOptions?.some((o) => !o.trim())) return showError('Fill in every poll option.');
		const draft: Draft = {
			key: pendingKey++,
			content,
			attachments,
			pollOptions: pollOptions && [...pollOptions],
			pollMinutes
		};
		// cleared right away: the post shows as pending below while it is on its way
		content = '';
		attachments = [];
		pollOptions = null;
		error = null;
		pending = [draft, ...pending];
		const settle = () => (pending = pending.filter((p) => p.key !== draft.key));
		const send = async (fresh: boolean) => {
			const uploads = await uploadIds(draft.attachments, fresh);
			return fetch('/api/v1/posts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					content: draft.content,
					reply_to: replyTo,
					quote_of: quoteOf?.id ?? null,
					uploads,
					poll: draft.pollOptions
						? { options: draft.pollOptions, duration_minutes: draft.pollMinutes }
						: null
				})
			});
		};
		try {
			let res = await send(false);
			// the server let the images expire (kept for a day, or lost on a restart): upload again
			if (res.status === 410) res = await send(true);
			if (res.ok) {
				const post: Post = await res.json();
				settle();
				for (const a of draft.attachments) a.release();
				oncreated?.(post);
				return;
			} else if (
				res.status === 400 ||
				res.status === 403 ||
				res.status === 410 ||
				res.status === 429
			) {
				showError((await errorOf(res)).message);
			} else if (res.status === 413) {
				showError('Images are too big.');
			} else {
				showError('Something went wrong.');
			}
		} catch (e) {
			showError(e instanceof UploadError ? e.message : 'Something went wrong.');
		}
		settle();
		// a failed upload is dropped, it would only fail again
		const kept = draft.attachments.filter((a) => !a.failed);
		for (const a of draft.attachments) if (a.failed) a.discard();
		// give back what didn't go out, unless something new was started meanwhile
		if (isEmpty()) {
			content = draft.content;
			attachments = kept;
			pollOptions = draft.pollOptions;
			pollMinutes = draft.pollMinutes;
		} else for (const a of kept) a.discard();
	}
</script>

{#if dragging}
	<div
		class="pointer-events-none fixed inset-0 z-999 flex items-center justify-center bg-background/70 p-5 backdrop-blur-[2px]"
	>
		<div
			class="w-full max-w-[442px] rounded-md border-2 border-dashed border-accent p-10 text-center"
		>
			Drop images to attach
		</div>
	</div>
{/if}

{#if error}
	<div class="mb-5 rounded-[5px] bg-danger p-2.5">
		<p>{error}</p>
	</div>
{/if}

<form
	class="mb-5 flex flex-col gap-2.5"
	onsubmit={(e) => {
		e.preventDefault();
		const sending = submit();
		inflight.add(sending);
		sending.finally(() => inflight.delete(sending));
	}}
	onpaste={onPaste}
>
	<div class="flex flex-col">
		<MentionInput
			bind:value={content}
			bind:element={textarea}
			required={attachments.length === 0 || !!pollOptions}
			placeholder={pollOptions ? 'Ask a question' : placeholder}
			inputClass="bg-transparent p-2.5 outline-none"
		/>
	</div>
	<div class="flex items-center gap-[5px]">
		<input
			bind:this={fileInput}
			onchange={onFilesSelected}
			type="file"
			accept="image/*"
			multiple
			hidden
		/>
		<button
			type="button"
			title="Attach images"
			aria-label="Attach images"
			disabled={attachments.length >= MAX_IMAGES}
			onclick={() => fileInput?.click()}
			class="flex cursor-pointer items-center rounded-[5px] p-[5px] outline-none hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40"
			><ImageIcon size={20} strokeWidth={1.8} /></button
		>
		<button
			type="button"
			title={pollOptions ? 'Remove poll' : 'Add a poll'}
			aria-label={pollOptions ? 'Remove poll' : 'Add a poll'}
			aria-pressed={!!pollOptions}
			onclick={() => (pollOptions = pollOptions ? null : ['', ''])}
			class="flex cursor-pointer items-center rounded-[5px] p-[5px] outline-none hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-accent"
			><ChartNoAxesColumn
				size={20}
				strokeWidth={1.8}
				class={pollOptions ? 'text-accent' : ''}
			/></button
		>
		<Button
			type="submit"
			variant="primary"
			size="sm"
			class="ml-auto w-10 transition-transform duration-200 ease-out hover:scale-115 hover:rotate-15 hover:bg-accent! hover:text-background!"
			aria-label="Post"
			title="Post"><SendHorizontal size={18} strokeWidth={1.8} /></Button
		>
	</div>
	{#if attachments.length > 0}
		<div class="flex flex-wrap gap-2.5">
			{#each attachments as attachment (attachment.url)}
				<div class="relative size-20 overflow-hidden rounded-[5px] border border-line">
					<img class="size-full object-cover" src={attachment.url} alt="" />
					{#if !attachment.id}
						<div class="absolute inset-0 flex items-center justify-center bg-black/50">
							<UploadProgress progress={attachment.progress} />
						</div>
					{/if}
					<button
						type="button"
						title="Remove"
						aria-label="Remove image"
						onclick={() => removeAttachment(attachment)}
						class="absolute top-0.5 right-0.5 flex size-5 cursor-pointer items-center justify-center rounded-full bg-background/80 outline-none hover:bg-danger"
						><X size={12} /></button
					>
				</div>
			{/each}
		</div>
	{/if}
	{#if pollOptions}
		<div class="flex flex-col gap-2.5 rounded-[10px] bg-black/70 p-2.5">
			{#each pollOptions as option, i}
				<div class="flex items-end gap-2.5">
					<label class="flex flex-1 flex-col">
						<span class="text-[0.8em] opacity-80">Option {i + 1}</span>
						<input
							class="border-b bg-transparent p-[5px] outline-none focus:border-accent"
							bind:value={pollOptions[i]}
							maxlength={MAX_POLL_OPTION}
							placeholder={i < 2 || option ? '' : 'Optional'}
						/>
					</label>
					{#if pollOptions.length > 2}
						<button
							type="button"
							title="Remove option"
							aria-label="Remove option {i + 1}"
							onclick={() => removeOption(i)}
							class="flex size-6 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-danger"
							><X size={14} /></button
						>
					{/if}
				</div>
			{/each}
			<div class="flex flex-wrap items-end justify-between gap-2.5">
				<label class="flex flex-col">
					<span class="text-[0.8em] opacity-80">Poll length</span>
					<select
						class="cursor-pointer border-b bg-background p-[5px] outline-none focus:border-accent"
						bind:value={pollMinutes}
					>
						{#each POLL_DURATIONS as [minutes, label]}
							<option value={minutes}>{label}</option>
						{/each}
					</select>
				</label>
				{#if pollOptions.length < MAX_POLL_OPTIONS}
					<Button size="sm" onclick={addOption}>Add option</Button>
				{/if}
			</div>
		</div>
	{/if}
	{#if quoteOf}
		<QuoteCard quote={quoteOf} link={false} />
	{/if}
	<!-- divides the composer from the posts below: thin and rounded -->
	<!-- prettier-ignore -->
	<div class="-mx-5 mt-2.5 h-px scale-y-50 rounded-full bg-foreground/60"></div>
</form>

{#each pending as draft (draft.key)}
	<!-- on its way: dimmed, with the loading mark, until the real post replaces it -->
	<div class="mb-5 flex gap-2.5 opacity-70" aria-busy="true">
		{#if $user}
			<Avatar user={$user} size={45} />
		{/if}
		<div class="flex min-w-0 flex-1 flex-col gap-2.5">
			<div class="flex items-center justify-between gap-2.5">
				<p class="truncate">
					<span class="font-bold">{$user?.name}</span>
					<span class="opacity-80">@{$user?.username}</span>
				</p>
				<LoadingScreen size={20} />
			</div>
			{#if draft.content.trim()}
				<p class="wrap-anywhere whitespace-pre-wrap">{draft.content.trim()}</p>
			{/if}
			{#if draft.pollOptions}
				<div class="flex flex-col gap-[5px]">
					{#each draft.pollOptions as option}
						<p class="rounded-[5px] border border-line p-[5px] text-[0.9em]">{option}</p>
					{/each}
				</div>
			{/if}
			{#if draft.attachments.length > 0}
				<div class="flex flex-wrap gap-2.5">
					{#each draft.attachments as attachment (attachment.url)}
						<div class="relative size-20 overflow-hidden rounded-[5px] border border-line">
							<img class="size-full object-cover" src={attachment.url} alt="" />
							{#if !attachment.id}
								<div class="absolute inset-0 flex items-center justify-center bg-black/50">
									<UploadProgress progress={attachment.progress} />
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/each}
