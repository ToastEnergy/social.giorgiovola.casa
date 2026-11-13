<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import type { PageProps } from './$types';
	import { onMount } from 'svelte';
	import { api, messageOf } from '#lib/api.js';

	let { data }: PageProps = $props();

	let error = $state('');
	let busy = $state(false);
	// the form only works through the API, so a submit before hydration would post to nothing
	let hydrated = $state(false);
	onMount(() => (hydrated = true));

	async function register(e: SubmitEvent) {
		e.preventDefault();
		const form = new FormData(e.currentTarget as HTMLFormElement);
		busy = true;
		error = '';
		try {
			await api('auth/register', {
				method: 'POST',
				json: {
					invite_code: form.get('inviteCode') ?? '',
					email: form.get('email'),
					name: form.get('fullName'),
					username: form.get('username'),
					password: form.get('password'),
					session: 'cookie'
				}
			});
			// a full reload: the whole page belongs to the account now signed in
			location.href = '/';
		} catch (err) {
			error = messageOf(err, 'Something went wrong, try again.');
			busy = false;
		}
	}
</script>

{#if error}
	<p class="mb-5 rounded-[5px] bg-danger p-[5px]">{error}</p>
{/if}

{#if data.inviteRequired}
	{#if data.invite?.inviter}
		<div class="mb-5 flex items-center gap-2.5 rounded-[10px] bg-black/70 p-2.5">
			<Avatar user={data.invite.inviter} size={45} clickable={false} />
			<p>
				<b>{data.invite.inviter.name}</b>
				<span class="opacity-70">@{data.invite.inviter.username}</span>
				invited you to join.
			</p>
		</div>
	{:else if data.invite}
		<p class="mb-5 rounded-[10px] bg-black/70 p-2.5">You've been invited to join.</p>
	{:else if data.code}
		<p class="mb-5 rounded-[5px] bg-danger p-[5px]">
			This invite link doesn't work anymore: it may have been used, revoked or expired. Ask for a
			new one.
		</p>
	{:else}
		<p class="mb-5 text-[0.85em] text-muted">
			Joining is by invitation: ask someone already here for an invite link or code.
		</p>
	{/if}
{:else}
	<p class="mb-5 rounded-[10px] bg-black/70 p-2.5">
		This is the first account on this instance, so no invite is needed.
	</p>
{/if}

<form method="POST" class="flex flex-col gap-5" onsubmit={register}>
	{#if data.inviteRequired}
		<input
			class="input"
			type="text"
			name="inviteCode"
			placeholder="Invite code"
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			value={data.invite?.code ?? data.code}
			required
		/>
	{/if}
	<input class="input" type="email" name="email" placeholder="Email" maxlength="254" required />
	<input
		class="input"
		type="text"
		name="fullName"
		placeholder="Full name"
		maxlength="64"
		required
	/>
	<input
		class="input"
		type="text"
		name="username"
		placeholder="Username (a-z, 0-9, _)"
		pattern={'[a-zA-Z0-9_]{1,32}'}
		maxlength="32"
		required
	/>
	<input
		class="input"
		type="password"
		name="password"
		placeholder="Password (min. 8 characters)"
		minlength="8"
		maxlength="256"
		autocomplete="new-password"
		required
	/>
	<Button class="mt-2.5" size="lg" type="submit" disabled={busy || !hydrated}>Register</Button>
</form>
