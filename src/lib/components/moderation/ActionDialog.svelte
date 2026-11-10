<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import { messageOf } from '#lib/api.js';
	import { modal } from '#lib/modal.js';
	import { DURATIONS, moderate } from '#lib/moderation.js';

	type Props = {
		/** the dialog is open while an action is set */
		action: 'ban' | 'mute' | 'password' | null;
		username: string;
		/** the ban or mute the account already has: the dialog then changes it */
		current?: { reason: string | null; until: string | null } | null;
		onclose: () => void;
		/** the action went through: what the server said */
		ondone: (message: string) => void;
	};

	let { action, username, current = null, onclose, ondone }: Props = $props();

	let reason = $state('');
	let duration = $state<number | null>(null);
	let password = $state('');
	let busy = $state(false);
	let error = $state('');

	// every opening starts from the current state
	$effect(() => {
		if (!action) return;
		reason = current?.reason ?? '';
		// a ban for good stays for good, a new one starts at a day
		duration = current ? (current.until ? DURATIONS[1].seconds : null) : DURATIONS[1].seconds;
		password = '';
		error = '';
	});

	const copy = $derived(
		{
			ban: {
				title: current ? `Change the ban of @${username}` : `Ban @${username}`,
				hint: 'They are signed out everywhere and can’t sign in until the ban ends. Their identities and bots stop too.',
				submit: current ? 'Update ban' : 'Ban'
			},
			mute: {
				title: current ? `Change the mute of @${username}` : `Mute @${username}`,
				hint: 'They can still read, but can’t post, reply or send messages, from any of their profiles.',
				submit: current ? 'Update mute' : 'Mute'
			},
			password: {
				title: `Reset the password of @${username}`,
				hint: 'They are signed out everywhere. Tell them the new password some other way.',
				submit: 'Reset password'
			}
		}[action ?? 'ban']
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!action || busy) return;
		busy = true;
		error = '';
		try {
			const { message } = await moderate(
				username,
				action,
				action === 'password' ? { password } : { reason, duration }
			);
			password = '';
			ondone(message);
		} catch (err) {
			error = messageOf(err);
		} finally {
			busy = false;
		}
	}

	const labelClass = 'text-[0.8em] opacity-80';
</script>

<dialog
	class="fixed top-0 left-0 z-999 m-0 h-full w-screen border-none bg-background/20 p-0 text-foreground backdrop-blur-[2px]"
	open={action !== null}
	aria-modal="true"
	aria-labelledby="moderation-dialog-title"
	use:modal={{ open: action !== null, onclose }}
>
	{#if action}
		<div class="flex h-full items-center justify-center p-5">
			<form
				class="flex w-full max-w-[420px] flex-col gap-5 rounded-md border border-accent bg-background p-5"
				data-modal-panel
				onsubmit={submit}
			>
				<div class="flex flex-col gap-[5px]">
					<h3 id="moderation-dialog-title" class="font-extrabold">{copy.title}</h3>
					<p class="text-[0.85em] text-muted">{copy.hint}</p>
				</div>

				{#if error}
					<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
				{/if}

				{#if action === 'password'}
					<label class="flex flex-col">
						<span class={labelClass}>New password</span>
						<input
							class="input"
							type="password"
							autocomplete="new-password"
							minlength="8"
							maxlength="256"
							required
							bind:value={password}
						/>
					</label>
				{:else}
					<fieldset class="flex flex-col gap-2.5">
						<legend class="{labelClass} mb-2.5">How long</legend>
						<div class="grid grid-cols-3 gap-[5px]">
							{#each DURATIONS as d (d.label)}
								<label
									class="cursor-pointer rounded-[5px] border px-[5px] py-2 text-center text-[0.9em] has-focus-visible:ring-2 has-focus-visible:ring-accent {duration ===
									d.seconds
										? 'border-accent bg-accent font-bold text-background'
										: 'border-line hover:bg-white/5'}"
								>
									<input
										class="sr-only"
										type="radio"
										name="duration"
										value={d.seconds ?? ''}
										checked={duration === d.seconds}
										onchange={() => (duration = d.seconds)}
									/>
									{d.label}
								</label>
							{/each}
						</div>
						{#if current?.until && duration !== null}
							<p class="text-[0.85em] text-muted">The new length counts from now.</p>
						{/if}
					</fieldset>
					<label class="flex flex-col">
						<span class={labelClass}>Reason (they see it)</span>
						<input
							class="input"
							type="text"
							maxlength="200"
							placeholder="Optional"
							bind:value={reason}
						/>
					</label>
				{/if}

				<div class="flex gap-2.5">
					<Button class="w-full" onclick={onclose}>Cancel</Button>
					<Button
						class="w-full"
						type="submit"
						variant={action === 'mute' ? 'primary' : 'danger'}
						disabled={busy}>{busy ? 'Working…' : copy.submit}</Button
					>
				</div>
			</form>
		</div>
	{/if}
</dialog>
