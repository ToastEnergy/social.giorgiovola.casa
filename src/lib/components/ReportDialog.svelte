<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { afterNavigate } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import { api, messageOf } from '#lib/api.js';
	import { modal } from '#lib/modal.js';
	import { REPORT_CATEGORIES, type ReportCategory } from '#lib/moderation.js';
	import { closeReport, report } from '#lib/report.svelte.js';

	const target = $derived(report.target);
	const open = $derived(target !== null);

	let category = $state<ReportCategory | null>(null);
	let details = $state('');
	let busy = $state(false);
	let error = $state('');
	// the answer once it is sent: the dialog then thanks and closes
	let sent = $state('');

	// every opening starts empty
	$effect(() => {
		if (!open) return;
		category = null;
		details = '';
		error = '';
		sent = '';
	});

	afterNavigate(closeReport);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!target || !category || busy) return;
		busy = true;
		error = '';
		try {
			const res = await api<{ message: string }>('reports', {
				method: 'POST',
				json: {
					...(target.kind === 'post' ? { post_id: target.id } : { username: target.username }),
					category,
					details
				}
			});
			sent = res.message;
		} catch (err) {
			error = messageOf(err);
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	class="fixed top-0 left-0 z-999 m-0 h-full w-screen border-none bg-background/20 p-0 text-foreground backdrop-blur-[2px]"
	{open}
	aria-modal="true"
	aria-labelledby="report-title"
	use:modal={{ open, onclose: closeReport }}
>
	{#if target}
		<div class="flex h-full items-center justify-center p-5">
			<div
				class="flex max-h-full w-full max-w-[420px] flex-col gap-5 overflow-y-auto rounded-md border border-accent bg-background p-5"
				data-modal-panel
			>
				{#if sent}
					<div class="flex flex-col items-center gap-2.5 text-center">
						<span
							class="flex size-10 items-center justify-center rounded-full bg-accent text-background"
						>
							<Check size={22} strokeWidth={3} />
						</span>
						<h3 id="report-title" class="font-extrabold">Report sent</h3>
						<p class="text-[0.9em] text-muted">{sent}</p>
					</div>
					<Button class="w-full" onclick={closeReport}>Done</Button>
				{:else}
					<form class="flex flex-col gap-5" onsubmit={submit}>
						<div class="flex flex-col gap-[5px]">
							<h3 id="report-title" class="font-extrabold">
								{target.kind === 'post' ? 'Report post' : `Report @${target.username}`}
							</h3>
							<p class="text-[0.85em] text-muted">
								Only the staff see reports. @{target.username} isn’t told who reported.
							</p>
						</div>

						{#if error}
							<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
						{/if}

						<fieldset class="flex flex-col gap-[5px]">
							<legend class="mb-2.5 text-[0.8em] opacity-80">What’s wrong?</legend>
							{#each REPORT_CATEGORIES as c (c.value)}
								<label
									class="flex cursor-pointer flex-col rounded-md border px-2.5 py-2 has-focus-visible:ring-2 has-focus-visible:ring-accent {category ===
									c.value
										? 'border-accent bg-white/5'
										: 'border-line hover:bg-white/5'}"
								>
									<input
										class="sr-only"
										type="radio"
										name="category"
										value={c.value}
										checked={category === c.value}
										onchange={() => (category = c.value)}
									/>
									<span class="font-bold">{c.label}</span>
									<span class="text-[0.85em] text-muted">{c.hint}</span>
								</label>
							{/each}
						</fieldset>

						<label class="flex flex-col">
							<span class="text-[0.8em] opacity-80">
								Anything the staff should know? {category === 'other' ? '' : '(optional)'}
							</span>
							<!-- prettier-ignore -->
							<textarea
								class="input min-h-20 resize-y"
								maxlength="1000"
								required={category === 'other'}
								bind:value={details}
							></textarea>
						</label>

						<div class="flex gap-2.5">
							<Button class="w-full" onclick={closeReport}>Cancel</Button>
							<Button class="w-full" type="submit" variant="danger" disabled={!category || busy}
								>{busy ? 'Sending…' : 'Report'}</Button
							>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{/if}
</dialog>
