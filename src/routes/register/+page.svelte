<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import type { PageProps } from './$types';
	import { onMount } from 'svelte';
	import { api, ApiError, messageOf } from '#lib/api.js';
	import { isInviteCode, normalizeInviteCode, type InviteCheck } from '#lib/invites.js';

	let { data }: PageProps = $props();

	const labelClass = 'text-[0.8em] opacity-80';
	const hintClass = 'mt-[5px] text-[0.85em] text-muted';

	let error = $state('');
	let busy = $state(false);
	// the form only works through the API, so a submit before hydration would post to nothing
	let hydrated = $state(false);
	onMount(() => (hydrated = true));

	// the invite the form signs up with: the link's, or one typed in and checked
	let invite = $derived<InviteCheck | null>(data.invite);
	let code = $derived(data.invite?.code ?? data.code);
	// a working link fills the code in: the field only shows to change it
	let editingCode = $derived(!data.invite);
	let codeError = $derived(
		data.code && !data.invite
			? "This invite link doesn't work anymore: it may have been used, revoked or expired. Ask for a new one."
			: ''
	);
	let checking = $state(false);
	let followInviter = $state(true);

	let name = $state('');
	let username = $state('');
	// the username follows the name until it is edited by hand
	let usernameEdited = $state(false);

	const usernameOf = (value: string) =>
		value
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 32);

	function nameInput() {
		if (!usernameEdited) username = usernameOf(name);
	}

	function usernameInput() {
		usernameEdited = username !== '';
		// usernames are lowercase: show what it will be
		username = username.toLowerCase();
	}

	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	// the code the last check was for, so a slow answer for an older one is dropped
	let checkingFor = '';

	function codeInput() {
		clearTimeout(checkTimer);
		invite = null;
		codeError = '';
		const normalized = normalizeInviteCode(code);
		checkingFor = normalized;
		// only complete codes are checked: wrong ones count against a rate limit
		if (!isInviteCode(normalized)) {
			checking = false;
			return;
		}
		checking = true;
		checkTimer = setTimeout(() => checkCode(normalized), 300);
	}

	async function checkCode(normalized: string) {
		try {
			const found = await api<InviteCheck>(`invites/${encodeURIComponent(normalized)}`);
			if (checkingFor !== normalized) return;
			invite = found;
		} catch (err) {
			if (checkingFor !== normalized) return;
			codeError =
				err instanceof ApiError && err.status === 404
					? "This code doesn't work: it may be mistyped, used, revoked or expired."
					: messageOf(err, "Couldn't check the code, try again.");
		} finally {
			if (checkingFor === normalized) checking = false;
		}
	}

	function changeCode() {
		editingCode = true;
		invite = null;
		code = '';
		codeError = '';
	}

	function expiresIn(date: string) {
		const ms = new Date(date).getTime() - Date.now();
		const days = Math.floor(ms / 86_400_000);
		if (days >= 1) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
		const hours = Math.max(1, Math.ceil(ms / 3_600_000));
		return `in ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
	}

	async function register(e: SubmitEvent) {
		e.preventDefault();
		const form = new FormData(e.currentTarget as HTMLFormElement);
		busy = true;
		error = '';
		const inviter = invite?.inviter;
		try {
			await api('auth/register', {
				method: 'POST',
				json: {
					invite_code: data.inviteRequired ? invite?.code ?? code : '',
					email: form.get('email'),
					name,
					username,
					password: form.get('password'),
					session: 'cookie'
				}
			});
		} catch (err) {
			error = messageOf(err, 'Something went wrong, try again.');
			busy = false;
			scrollTo({ top: 0 });
			return;
		}
		// signed up already: a failed follow shouldn't keep them on this page
		if (inviter && followInviter)
			await api(`users/${encodeURIComponent(inviter.username)}/follow`, { method: 'PUT' }).catch(
				() => null
			);
		// a full reload: the whole page belongs to the account now signed in
		location.href = '/';
	}
</script>

<svelte:head>
	<title>Sign up / social.giorgiovola.casa</title>
</svelte:head>

{#if error}
	<p class="mb-5 rounded-[5px] bg-danger p-[5px]" role="alert">{error}</p>
{/if}

{#if !data.inviteRequired}
	<p class="mb-5 rounded-[10px] bg-black/70 p-2.5">
		This is the first account on this instance, so no invite is needed.
	</p>
{:else if invite?.inviter}
	{@const inviter = invite.inviter}
	<section class="mb-5 flex flex-col gap-2.5 rounded-[10px] bg-black/70 p-2.5" aria-live="polite">
		<div class="flex items-center gap-2.5">
			<Avatar
				user={{ ...inviter, avatar: inviter.avatar_url ?? inviter.avatar }}
				size={50}
				clickable={false}
			/>
			<div class="min-w-0">
				<p class="text-[0.85em] text-muted">You've been invited by</p>
				<p class="truncate">
					<b class="font-bold">{inviter.name}</b>
					<span class="opacity-70">@{inviter.username}</span>
				</p>
			</div>
		</div>
		{#if inviter.bio}
			<p class="line-clamp-3 whitespace-pre-line break-words text-[0.9em]">{inviter.bio}</p>
		{/if}
		<p class="text-[0.85em] text-muted">
			{#if invite.expires_at}This invite expires {expiresIn(invite.expires_at)}. {/if}
			{#if !editingCode}
				<button type="button" class="text-accent hover:underline" onclick={changeCode}>
					Use a different code
				</button>
			{/if}
		</p>
	</section>
{:else if invite}
	<p class="mb-5 rounded-[10px] bg-black/70 p-2.5" aria-live="polite">
		You've been invited to join.
		{#if invite.expires_at}
			<span class="text-[0.85em] text-muted">
				This invite expires {expiresIn(invite.expires_at)}.
			</span>
		{/if}
	</p>
{:else if !code}
	<p class="mb-5 rounded-[10px] bg-black/70 p-2.5 text-[0.9em]">
		Joining is by invitation. Paste the invite link or code someone here sent you, or ask a member
		for one.
	</p>
{/if}

<form method="POST" class="flex flex-col gap-5" onsubmit={register}>
	{#if data.inviteRequired && editingCode}
		<div class="flex flex-col">
			<label class={labelClass} for="inviteCode">Invite code or link</label>
			<input
				class="input"
				id="inviteCode"
				type="text"
				name="inviteCode"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				bind:value={code}
				oninput={codeInput}
				aria-invalid={codeError ? 'true' : undefined}
				aria-describedby="inviteHint"
				required
			/>
			<p id="inviteHint" class={hintClass} aria-live="polite">
				{#if checking}
					Checking…
				{:else if codeError}
					<span class="text-danger">{codeError}</span>
				{:else if invite}
					<span class="text-accent">This invite works.</span>
				{:else}
					12 letters and numbers, from the invite link.
				{/if}
			</p>
		</div>
	{/if}
	<div class="flex flex-col">
		<label class={labelClass} for="email">Email</label>
		<input
			class="input"
			id="email"
			type="email"
			name="email"
			maxlength="254"
			autocomplete="email"
			required
		/>
	</div>
	<div class="flex flex-col">
		<label class={labelClass} for="fullName">Name</label>
		<input
			class="input"
			id="fullName"
			type="text"
			name="fullName"
			maxlength="64"
			autocomplete="name"
			bind:value={name}
			oninput={nameInput}
			required
		/>
		<p class={hintClass}>Shown on your profile and posts. You can change it later.</p>
	</div>
	<div class="flex flex-col">
		<label class={labelClass} for="username">Username</label>
		<input
			class="input"
			id="username"
			type="text"
			name="username"
			pattern={'[a-z0-9_]{1,32}'}
			maxlength="32"
			autocomplete="username"
			autocapitalize="none"
			spellcheck="false"
			bind:value={username}
			oninput={usernameInput}
			aria-describedby="usernameHint"
			required
		/>
		<p id="usernameHint" class={hintClass}>
			{#if username}Your profile will be @{username}.{/if}
			Lowercase letters, numbers and _, up to 32.
		</p>
	</div>
	<div class="flex flex-col">
		<label class={labelClass} for="password">Password</label>
		<input
			class="input"
			id="password"
			type="password"
			name="password"
			minlength="8"
			maxlength="256"
			autocomplete="new-password"
			aria-describedby="passwordHint"
			required
		/>
		<p id="passwordHint" class={hintClass}>
			At least 8 characters. You can add a passkey in settings afterwards.
		</p>
	</div>
	{#if invite?.inviter}
		<label class="flex items-center gap-1.5 text-[0.9em]">
			<input type="checkbox" bind:checked={followInviter} />
			Follow {invite.inviter.name}
		</label>
	{/if}
	<Button
		class="mt-2.5"
		size="lg"
		type="submit"
		disabled={busy || !hydrated || (data.inviteRequired && checking)}
	>
		{busy ? 'Creating your account…' : 'Create account'}
	</Button>
</form>

<p class="mt-5 text-center text-[0.9em]">
	Already have an account? <a href="/login">Log in</a>
</p>
