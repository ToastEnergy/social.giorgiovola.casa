<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import type { PageProps } from './$types';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import ActionDialog from '#lib/components/moderation/ActionDialog.svelte';
	import LogEntry from '#lib/components/moderation/LogEntry.svelte';
	import ReportCard from '#lib/components/moderation/ReportCard.svelte';
	import { invalidate } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { moderate, relative, type ModerationAction } from '#lib/moderation.js';
	import { DATE } from '#lib/time.svelte.js';

	let { data }: PageProps = $props();

	const a = $derived(data.account);
	const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let busy = $state(false);
	let dialog = $state<'ban' | 'mute' | 'password' | null>(null);
	let tab = $state<'history' | 'reports' | 'identities'>('history');
	let note = $state('');
	// the invites field, reset to the account's count whenever the page data changes
	let invitesValue = $derived(data.account.invites.invites);

	async function saveInvites(e: SubmitEvent) {
		e.preventDefault();
		const count = invitesValue;
		const out = a.invites.pending;
		if (
			count < out &&
			!confirm(
				`@${a.username} has ${out} invite ${
					out === 1 ? 'link' : 'links'
				} out. Going down to ${count} revokes the newest ${out - count}. Continue?`
			)
		)
			return;
		busy = true;
		try {
			const res = await api<{ message: string }>(
				`admin/users/${encodeURIComponent(a.username)}/invites`,
				{ method: 'PUT', json: { invites: count } }
			);
			await changed(res.message);
		} catch (err) {
			await changed(messageOf(err), true);
		} finally {
			busy = false;
		}
	}

	async function changed(message: string, failed = false) {
		flash = { message, failed };
		dialog = null;
		if (!failed) await invalidate('app:admin');
	}

	async function run(action: ModerationAction, fields: { role?: string } = {}, ask?: string) {
		if (ask && !confirm(ask)) return;
		busy = true;
		try {
			await changed((await moderate(a.username, action, fields)).message);
		} catch (e) {
			await changed(messageOf(e), true);
		} finally {
			busy = false;
		}
	}

	async function addNote(e: SubmitEvent) {
		e.preventDefault();
		if (!note.trim() || busy) return;
		busy = true;
		try {
			const res = await api<{ message: string }>(
				`admin/users/${encodeURIComponent(a.username)}/notes`,
				{ method: 'POST', json: { note } }
			);
			note = '';
			await changed(res.message);
		} catch (err) {
			await changed(messageOf(err), true);
		} finally {
			busy = false;
		}
	}

	const states = $derived(
		[
			a.banned_at && {
				label: 'Banned',
				since: a.banned_at,
				until: a.banned_until,
				reason: a.ban_reason,
				hint: 'Signed out everywhere and can’t sign in.'
			},
			a.muted_at && {
				label: 'Muted',
				since: a.muted_at,
				until: a.muted_until,
				reason: a.mute_reason,
				hint: 'Can read, but can’t post, reply or send messages.'
			}
		].filter((s) => !!s)
	);

	const stats = $derived([
		{ label: 'Posts', value: a.stats.posts },
		{ label: 'Followers', value: a.stats.followers },
		{ label: 'Open reports', value: a.stats.open_reports, alert: a.stats.open_reports > 0 },
		{ label: 'Reports made', value: a.stats.reports_made }
	]);

	const tabs = $derived([
		{ value: 'history', label: 'Notes & history', count: a.stats.log_entries },
		{ value: 'reports', label: 'Reports', count: a.stats.reports },
		{ value: 'identities', label: 'Identities', count: a.identities.length + a.shared_with.length }
	] as const);

	const tabClass = (active: boolean) =>
		`flex shrink-0 grow items-center justify-center gap-[5px] border-b-2 px-2.5 py-2.5 ${
			active ? 'border-accent font-bold' : 'border-transparent opacity-60 hover:opacity-100'
		}`;
	const badge = 'rounded-full border px-2 text-[0.75em] font-bold';
	const sectionTitle = 'text-[0.8em] font-bold tracking-wide text-muted uppercase';
</script>

<svelte:head>
	<title>@{a.username} · Moderation</title>
</svelte:head>

<div class="flex flex-col gap-5">
	<a class="flex items-center gap-[5px] self-start text-[0.9em]" href="/admin/users"
		><ArrowLeft size={16} /> Accounts</a
	>

	<header class="flex items-start gap-2.5">
		<Avatar user={a} size={64} />
		<div class="flex min-w-0 flex-1 flex-col gap-[5px]">
			<h2 class="leading-tight break-words">{a.name}</h2>
			<p class="flex flex-wrap items-center gap-[5px]">
				<span class="opacity-80">@{a.username}</span>
				{#if a.role !== 'user'}
					<span class="{badge} border-accent text-accent">{a.role}</span>
				{/if}
				{#if a.banned_at}
					<span class="{badge} border-danger text-danger">banned</span>
				{/if}
				{#if a.muted_at}
					<span class="{badge} border-danger text-danger">muted</span>
				{/if}
				{#if a.self}
					<span class="{badge} border-line text-muted">you</span>
				{/if}
			</p>
			<p class="text-[0.8em] text-muted">
				Joined <LocalTime date={a.created_at} options={DATE} />
				{#if a.invites.invited_by}
					· invited by
					<a href="/admin/users/{a.invites.invited_by.username}">@{a.invites.invited_by.username}</a
					>
				{/if}
				{#if a.email}· {a.email}{/if}
			</p>
			{#if a.via}
				<p class="text-[0.85em] text-muted">
					You opened @{a.via}, an identity of this account. Moderation applies to the whole account.
				</p>
			{/if}
		</div>
		<Button size="sm" href="/@{a.username}">Profile</Button>
	</header>

	<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
		{#each stats as s (s.label)}
			<div
				class="flex flex-col rounded-[10px] border p-2.5 {s.alert
					? 'border-danger'
					: 'border-line'}"
			>
				<span class="text-[1.25em] leading-tight font-extrabold {s.alert ? 'text-danger' : ''}"
					>{nf.format(s.value)}</span
				>
				<span class="text-[0.8em] text-muted">{s.label}</span>
			</div>
		{/each}
	</div>

	{#if flash}
		<p
			class="rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-accent text-background'}"
			role="status"
		>
			{flash.message}
		</p>
	{/if}

	{#each states as s (s.label)}
		<div class="flex flex-col gap-[5px] rounded-[10px] border border-danger p-2.5">
			<p>
				<b class="text-danger">{s.label}</b>
				<span class="text-[0.9em] text-muted">
					since <LocalTime date={s.since} /> ·
					{#if s.until}
						ends {relative(s.until)} (<LocalTime date={s.until} />)
					{:else}
						permanent
					{/if}
				</span>
			</p>
			{#if s.reason}
				<p class="text-[0.9em]">“{s.reason}”</p>
			{/if}
			<p class="text-[0.85em] text-muted">{s.hint}</p>
		</div>
	{/each}

	{#if a.can_moderate}
		<section class="flex flex-col gap-2.5" aria-labelledby="actions-title">
			<h3 id="actions-title" class={sectionTitle}>Actions</h3>
			<div class="flex flex-wrap gap-2.5">
				{#if a.banned_at}
					<Button size="sm" disabled={busy} onclick={() => run('unban')}>Unban</Button>
					<Button size="sm" onclick={() => (dialog = 'ban')}>Change ban</Button>
				{:else}
					<Button size="sm" variant="danger" onclick={() => (dialog = 'ban')}>Ban…</Button>
				{/if}
				{#if a.muted_at}
					<Button size="sm" disabled={busy} onclick={() => run('unmute')}>Unmute</Button>
					<Button size="sm" onclick={() => (dialog = 'mute')}>Change mute</Button>
				{:else}
					<Button size="sm" onclick={() => (dialog = 'mute')}>Mute…</Button>
				{/if}
			</div>
			{#if a.can_manage}
				<h3 class="{sectionTitle} mt-2.5">Admin</h3>
				<div class="flex flex-wrap gap-2.5">
					<Button
						size="sm"
						variant={a.role === 'mod' ? 'danger-on-hover' : 'default'}
						disabled={busy}
						onclick={() =>
							run(
								'role',
								{ role: a.role === 'mod' ? 'user' : 'mod' },
								a.role === 'mod'
									? `Remove @${a.username} from the mods?`
									: `Make @${a.username} a mod? They can ban, mute and delete posts of regular users.`
							)}>{a.role === 'mod' ? 'Remove mod' : 'Make mod'}</Button
					>
					<Button size="sm" variant="danger" onclick={() => (dialog = 'password')}
						>Reset password…</Button
					>
				</div>
			{/if}
		</section>
	{:else}
		<p class="rounded-[10px] border border-line p-2.5 text-[0.9em] text-muted">
			{a.self
				? 'This is your account: you can’t moderate yourself, but you can leave notes.'
				: `@${a.username} is ${
						a.role === 'admin' ? 'an admin' : 'a mod'
				  }: only someone ranked higher can act on them.`}
		</p>
	{/if}

	{#if data.role === 'admin'}
		<section class="flex flex-col gap-2.5" aria-labelledby="invites-title">
			<h3 id="invites-title" class={sectionTitle}>Invites</h3>
			<p class="text-[0.9em]">
				{#if a.invites.invites === 0}
					No invites to give.
				{:else}
					<b>{a.invites.available}</b> to give{#if a.invites.pending > 0}, {a.invites.pending}
						out as {a.invites.pending === 1 ? 'a link' : 'links'}{/if}.
				{/if}
				{#if a.invites.used > 0}
					<a href="/admin/invites?status=used&username={a.username}"
						>{a.invites.used}
						{a.invites.used === 1 ? 'person' : 'people'} joined with their invites</a
					>.
				{/if}
			</p>
			<form class="flex items-end gap-2.5" onsubmit={saveInvites}>
				<label class="flex w-28 flex-col" for="invites-count">
					<span class="text-[0.8em] opacity-80">Invites held</span>
					<input
						id="invites-count"
						class="border-b bg-transparent py-[5px] outline-none focus:border-accent"
						type="number"
						min="0"
						max="1000"
						required
						bind:value={invitesValue}
					/>
				</label>
				<Button size="sm" type="submit" disabled={busy || invitesValue === a.invites.invites}
					>Save</Button
				>
			</form>
		</section>
	{/if}

	<div class="flex flex-col">
		<nav class="mb-2.5 flex overflow-x-auto [scrollbar-width:none]" aria-label="Case sections">
			{#each tabs as t (t.value)}
				<button
					type="button"
					class="{tabClass(tab === t.value)} cursor-pointer"
					aria-current={tab === t.value ? 'page' : undefined}
					onclick={() => (tab = t.value)}
				>
					{t.label}
					{#if t.count > 0}<span class="text-[0.8em] text-muted">{t.count}</span>{/if}
				</button>
			{/each}
		</nav>

		{#if tab === 'history'}
			<form class="flex flex-col gap-2.5" onsubmit={addNote}>
				<label class="flex flex-col">
					<span class="text-[0.8em] opacity-80">Add a note for the staff</span>
					<!-- prettier-ignore -->
					<textarea
						class="input min-h-16 resize-y"
						maxlength="1000"
						placeholder="What happened, what you told them, what to watch for…"
						bind:value={note}
					></textarea>
				</label>
				<Button class="self-end" size="sm" type="submit" disabled={busy || !note.trim()}
					>Add note</Button
				>
			</form>
			<ul class="flex flex-col divide-y divide-line">
				{#each data.log as entry (entry.id)}
					<LogEntry {entry} compact />
				{:else}
					<li class="py-10 text-center text-muted">No history yet.</li>
				{/each}
			</ul>
			{#if data.moreLog}
				<Button class="self-start" href="/admin/log?username={a.username}">Full history</Button>
			{/if}
		{:else if tab === 'reports'}
			<div class="flex flex-col gap-2.5">
				{#each data.reports as report (report.id)}
					<ReportCard
						{report}
						compact
						onchange={changed}
						onmoderate={(action) => (dialog = action)}
					/>
				{:else}
					<p class="py-10 text-center text-muted">Nobody reported this account.</p>
				{/each}
				{#if data.moreReports}
					<Button class="self-start" href="/admin?status=all&username={a.username}"
						>All reports</Button
					>
				{/if}
			</div>
		{:else}
			<ul class="flex flex-col divide-y divide-line">
				{#each a.identities as i (i.username)}
					<li class="flex items-center gap-2.5 py-2.5">
						<Avatar user={i} size={32} />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">
								<a class="font-bold text-foreground" href="/@{i.username}">{i.name}</a>
								<span class="opacity-70">@{i.username}</span>
							</span>
							<span class="text-[0.85em] text-muted">
								{i.bot ? 'Bot' : 'Identity'} owned by this account{#if i.members.length > 0}, shared
									with {i.members.map((m) => '@' + m).join(', ')}{/if}
							</span>
						</div>
					</li>
				{/each}
				{#each a.shared_with as i (i.username)}
					<li class="flex items-center gap-2.5 py-2.5">
						<Avatar user={i} size={32} />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="truncate">
								<a class="font-bold text-foreground" href="/@{i.username}">{i.name}</a>
								<span class="opacity-70">@{i.username}</span>
							</span>
							<span class="text-[0.85em] text-muted">
								Shared with this account by
								<a href="/admin/users/{i.owner_username}">@{i.owner_username}</a>
							</span>
						</div>
					</li>
				{/each}
				{#if a.identities.length === 0 && a.shared_with.length === 0}
					<li class="py-10 text-center text-muted">No identities or bots.</li>
				{/if}
			</ul>
		{/if}
	</div>
</div>

<ActionDialog
	action={dialog}
	username={a.username}
	current={dialog === 'ban' && a.banned_at
		? { reason: a.ban_reason, until: a.banned_until }
		: dialog === 'mute' && a.muted_at
		? { reason: a.mute_reason, until: a.muted_until }
		: null}
	onclose={() => (dialog = null)}
	ondone={(message) => changed(message)}
/>
