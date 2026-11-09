<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import NewTokenPanel from './NewToken.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { DAY, hintClass, sectionClass, type NewToken, type Session } from '#lib/settings.js';

	let { account, sessions }: { account: string; sessions: Session[] } = $props();

	let busy = $state(false);
	let error = $state('');
	// only in the response that created it: a token is never shown again
	let newToken = $state<NewToken | null>(null);

	const kindLabel = { cookie: 'Browser', token: 'App', personal: 'Personal access token' };

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

	function revokeSession(id: number, current: boolean) {
		const message = current
			? 'Sign out of this browser?'
			: 'Revoke this session? It is signed out right away.';
		if (!confirm(message)) return;
		run(() => api(`auth/sessions/${id}`, { method: 'DELETE' })).then((ok) => {
			if (ok && current) location.href = '/';
		});
	}

	async function createPersonalToken(e: SubmitEvent) {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		const fields = new FormData(form);
		const days = String(fields.get('days'));
		let created: { name: string; token: string } | undefined;
		const ok = await run(async () => {
			created = await api('auth/tokens', {
				method: 'POST',
				json: {
					name: fields.get('name'),
					current_password: fields.get('currentPassword'),
					expires_in_days: days === 'never' ? null : Number(days)
				}
			});
		});
		if (ok && created) {
			newToken = { label: created.name, token: created.token, bot: false };
			form.reset();
		}
	}
</script>

<section class={sectionClass}>
	<h2>Sessions and API tokens</h2>
	<p class={hintClass}>
		Everywhere <b>@{account}</b> is signed in: browsers, apps that signed in with your password or a
		passkey, and personal access tokens. A personal access token lets your own scripts and apps use
		the <a href="/api.txt">API</a> as you; send it as
		<code>Authorization: Bearer &lt;token&gt;</code>. Revoking signs it out right away.
	</p>

	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{/if}
	{#if newToken}
		<NewTokenPanel token={newToken} />
	{/if}

	<ul class="flex flex-col gap-2">
		{#each sessions as session (session.id)}
			<li
				class="flex items-center gap-2.5 rounded-md border p-2 {session.current
					? 'border-accent'
					: 'border-line'}"
			>
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="truncate font-bold">
						{session.name || kindLabel[session.kind]}
						{#if session.current}<span class="text-[0.8em] font-medium text-accent">· this one</span
							>{/if}
					</span>
					<span class="truncate text-[0.8em] text-muted">
						{kindLabel[session.kind]} · signed in <LocalTime
							date={session.created_at}
							options={DAY}
						/> ·
						{#if session.last_used_at}last used <LocalTime
								date={session.last_used_at}
								options={DAY}
							/>{:else}never used{/if} ·
						{#if session.expires_at}expires <LocalTime
								date={session.expires_at}
								options={DAY}
							/>{:else}never expires{/if}
					</span>
					{#if session.user_agent}
						<span class="truncate text-[0.75em] text-muted" title={session.user_agent}
							>{session.user_agent}</span
						>
					{/if}
				</div>
				<Button
					variant="danger"
					size="sm"
					disabled={busy}
					onclick={() => revokeSession(session.id, session.current)}
					>{session.current ? 'Sign out' : 'Revoke'}</Button
				>
			</li>
		{/each}
	</ul>

	<form class="mt-2.5 flex flex-col gap-3" onsubmit={createPersonalToken}>
		<h3>New personal access token</h3>
		<input
			class="input"
			type="text"
			name="name"
			placeholder="Name (e.g. My script)"
			maxlength="64"
			aria-label="Token name"
			required
		/>
		<label class="flex flex-col text-[0.8em] opacity-80">
			Expires
			<select
				class="border-b border-line bg-background p-2.5 text-[1.25em] outline-none"
				name="days"
			>
				<option value="30">in 30 days</option>
				<option value="90" selected>in 90 days</option>
				<option value="365">in a year</option>
				<option value="never">never</option>
			</select>
		</label>
		<label class="flex flex-col text-[0.8em] opacity-80">
			Your password
			<input
				class="border-b border-line bg-transparent p-2.5 text-[1.25em] outline-none"
				type="password"
				name="currentPassword"
				autocomplete="current-password"
				required
			/>
		</label>
		<Button class="self-start" type="submit" disabled={busy}>Create token</Button>
	</form>
</section>
