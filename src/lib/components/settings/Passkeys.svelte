<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { invalidateAll } from '$app/navigation';
	import {
		WebAuthnError,
		browserSupportsWebAuthn,
		sendSignal,
		startRegistration
	} from '@simplewebauthn/browser';
	import { onMount } from 'svelte';
	import { api, messageOf } from '#lib/api.js';
	import { DAY, hintClass, sectionClass, type Passkey } from '#lib/settings.js';

	let {
		account,
		passkeys,
		max,
		rpID,
		userHandle
	}: {
		account: string;
		passkeys: Passkey[];
		max: number;
		/** let the page tell the browser which passkeys are still valid, so deleted ones disappear */
		rpID: string;
		userHandle: string;
	} = $props();

	let supported = $state(true);
	let busy = $state(false);
	let error = $state('');
	let newName = $state('');
	let renaming = $state<string | null>(null);

	const canAdd = $derived(passkeys.length < max);

	onMount(() => {
		supported = browserSupportsWebAuthn();
	});

	// tells the password manager which passkeys are still accepted, so deleted ones go away there too
	$effect(() => {
		if (!supported) return;
		sendSignal({
			signalName: 'allAcceptedCredentials',
			rpID,
			userID: userHandle,
			allAcceptedCredentialIDs: passkeys.map((p) => p.id)
		}).catch(() => null);
	});

	/** Runs an API call, then reloads the page's data; failures show above the list. */
	async function run(action: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await action();
			await invalidateAll();
			return true;
		} catch (e) {
			error = messageOf(e, 'Something went wrong, try again.');
			return false;
		} finally {
			busy = false;
		}
	}

	async function addPasskey(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		const form = e.currentTarget as HTMLFormElement;
		const current_password = new FormData(form).get('currentPassword');
		busy = true;
		error = '';
		try {
			const { challenge_id, ...optionsJSON } = await api<
				Parameters<typeof startRegistration>[0]['optionsJSON'] & { challenge_id: string }
			>('me/passkeys/options', { method: 'POST', json: { current_password } });
			let response;
			try {
				response = await startRegistration({ optionsJSON });
			} catch (err) {
				if (
					err instanceof WebAuthnError &&
					err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'
				)
					throw new Error('This device already has a passkey for your account.');
				// cancelled by the user, or timed out: nothing to report
				if (err instanceof Error && err.name === 'NotAllowedError') return;
				throw err;
			}
			await api('me/passkeys', {
				method: 'POST',
				json: { challenge_id, name: newName, response }
			});
			newName = '';
			form.reset();
			await invalidateAll();
		} catch (err) {
			error = messageOf(err, 'Something went wrong, try again.');
		} finally {
			busy = false;
		}
	}

	async function renamePasskey(e: SubmitEvent, id: string) {
		e.preventDefault();
		const name = new FormData(e.currentTarget as HTMLFormElement).get('name');
		if (await run(() => api(`me/passkeys/${id}`, { method: 'PATCH', json: { name } })))
			renaming = null;
	}

	function deletePasskey(id: string, name: string) {
		if (confirm(`Delete the passkey "${name}"? You won't be able to sign in with it anymore.`))
			run(() => api(`me/passkeys/${id}`, { method: 'DELETE' }));
	}
</script>

<section class={sectionClass}>
	<h2>Passkeys</h2>
	<p class={hintClass}>
		Passkeys let you sign in to <b>@{account}</b> with your fingerprint, face, screen lock or a security
		key instead of typing your password. They are optional: your password keeps working either way.
	</p>

	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{/if}

	{#if passkeys.length > 0}
		<ul class="flex flex-col gap-2">
			{#each passkeys as passkey (passkey.id)}
				<li class="flex items-center gap-2.5 rounded-md border border-line p-2">
					{#if renaming === passkey.id}
						<form
							class="flex flex-1 items-center gap-1.5"
							onsubmit={(e) => renamePasskey(e, passkey.id)}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="input flex-1"
								type="text"
								name="name"
								value={passkey.name}
								maxlength="64"
								aria-label="Passkey name"
								autofocus
							/>
							<Button type="submit" disabled={busy}>Save</Button>
							<Button onclick={() => (renaming = null)}>Cancel</Button>
						</form>
					{:else}
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate font-bold">{passkey.name}</span>
							<span class="text-[0.8em] text-muted">
								Added <LocalTime date={passkey.created_at} options={DAY} /> ·
								{#if passkey.last_used_at}last used <LocalTime
										date={passkey.last_used_at}
										options={DAY}
									/>{:else}never used{/if}{passkey.backed_up ? ' · synced' : ''}
							</span>
						</div>
						<div class="flex items-center gap-1.5">
							<Button onclick={() => (renaming = passkey.id)}>Rename</Button>
							<Button
								variant="danger"
								disabled={busy}
								onclick={() => deletePasskey(passkey.id, passkey.name)}>Delete</Button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class={hintClass}>You have no passkeys yet.</p>
	{/if}

	{#if !supported}
		<p class={hintClass}>This browser doesn't support passkeys.</p>
	{:else if canAdd}
		<form class="mt-2.5 flex flex-col gap-3" onsubmit={addPasskey}>
			<h3>Add a passkey</h3>
			<input
				class="input"
				type="text"
				bind:value={newName}
				placeholder="Name (e.g. My phone)"
				maxlength="64"
				aria-label="Passkey name"
			/>
			<input
				class="input"
				type="password"
				name="currentPassword"
				autocomplete="current-password"
				placeholder="Your password"
				aria-label="Your password"
				required
			/>
			<Button class="self-start" type="submit" disabled={busy}>
				{busy ? 'Waiting for your device…' : 'Add passkey'}
			</Button>
		</form>
	{:else}
		<p class={hintClass}>You reached the limit of {max} passkeys.</p>
	{/if}
</section>
