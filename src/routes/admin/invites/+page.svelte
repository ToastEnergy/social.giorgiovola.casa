<script lang="ts">
	import type { PageProps } from './$types';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import InviteList from '#lib/components/InviteList.svelte';
	import { invalidate } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { STATUS_LABELS, linkOf, type Invite } from '#lib/invites.js';

	let { data }: PageProps = $props();

	const s = $derived(data.summary);
	const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let busy = $state(false);

	let grantCount = $state(1);
	let note = $state('');
	let count = $state(1);
	let days = $state('14');

	async function changed(message: string, failed = false) {
		flash = { message, failed };
		if (!failed) await invalidate('app:admin');
	}

	async function run(action: () => Promise<string>) {
		busy = true;
		try {
			await changed(await action());
		} catch (e) {
			await changed(messageOf(e), true);
		} finally {
			busy = false;
		}
	}

	function grant(e: SubmitEvent) {
		e.preventDefault();
		const n = grantCount;
		if (
			!confirm(`Give every account that isn't banned ${n} more ${n === 1 ? 'invite' : 'invites'}?`)
		)
			return;
		run(async () => {
			const res = await api<{ message: string }>('admin/invites/grant', {
				method: 'POST',
				json: { count: n }
			});
			return res.message;
		});
	}

	function create(e: SubmitEvent) {
		e.preventDefault();
		run(async () => {
			const res = await api<{ items: Invite[] }>('admin/invites', {
				method: 'POST',
				json: { note, count, days: days === 'never' ? null : Number(days) }
			});
			note = '';
			let copied = false;
			try {
				await navigator.clipboard.writeText(res.items.map(linkOf).join('\n'));
				copied = true;
			} catch {
				// no clipboard access: the links are in the list below
			}
			const what = res.items.length === 1 ? 'Invite' : `${res.items.length} invites`;
			const link = res.items.length === 1 ? 'link' : 'links';
			return copied ? `${what} created, ${link} copied.` : `${what} created.`;
		});
	}

	const stats = $derived([
		{ label: 'Available to give', value: s.available },
		{ label: 'Codes out', value: s.pending + s.pending_staff },
		{ label: 'Used', value: s.used },
		{ label: 'Accounts with invites', value: s.accounts.length }
	]);

	// the filters of this page with another status or cursor
	const pageHref = (status: string, cursor: string | null) => {
		const params = new URLSearchParams();
		if (status !== 'all') params.set('status', status);
		if (data.username) params.set('username', data.username);
		if (cursor) params.set('cursor', cursor);
		const query = params.toString();
		return query ? `?${query}` : '/admin/invites';
	};

	const fieldClass = 'flex min-w-0 flex-col';
	const labelClass = 'text-[0.8em] opacity-80';
	const inputClass = 'min-w-0 border-b bg-transparent py-[5px] outline-none focus:border-accent';
	const tabClass = (active: boolean) =>
		`shrink-0 grow border-b-2 px-2.5 py-2.5 text-center text-foreground hover:no-underline ${
			active ? 'border-accent font-bold' : 'border-transparent opacity-60 hover:opacity-100'
		}`;
</script>

<svelte:head>
	<title>Invites · Moderation</title>
</svelte:head>

<div class="mb-10 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
	{#each stats as stat (stat.label)}
		<div class="flex flex-col rounded-[10px] border border-line p-2.5">
			<span class="text-[1.25em] leading-tight font-extrabold">{nf.format(stat.value)}</span>
			<span class="text-[0.8em] text-muted">{stat.label}</span>
		</div>
	{/each}
</div>

{#if flash}
	<p
		class="mb-5 rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-accent text-background'}"
		role="status"
	>
		{flash.message}
	</p>
{/if}

<section class="mb-10 flex flex-col gap-3">
	<h2>Give invites</h2>
	<p class="text-[0.85em] text-muted">
		People turn their invites into links from Settings → Invites. An invite is only used up when
		someone signs up with it. To give or take away invites from one person, open their case page
		(Accounts → the account).
	</p>
	<form class="flex flex-wrap items-end gap-2.5" onsubmit={grant}>
		<label class="{fieldClass} w-24" for="grant-count">
			<span class={labelClass}>Invites each</span>
			<input
				id="grant-count"
				class={inputClass}
				type="number"
				min="1"
				max="100"
				required
				bind:value={grantCount}
			/>
		</label>
		<Button type="submit" disabled={busy}>Give to everyone</Button>
	</form>
</section>

<section class="mb-10 flex flex-col gap-3">
	<h2>Create invite links</h2>
	<p class="text-[0.85em] text-muted">
		Links of your own, for people you invite yourself. They don't come out of anyone's invites.
	</p>
	<form class="flex flex-wrap items-end gap-2.5" onsubmit={create}>
		<label class="{fieldClass} flex-1 basis-40" for="invite-note">
			<span class={labelClass}>Who is it for? (optional)</span>
			<input
				id="invite-note"
				class={inputClass}
				type="text"
				maxlength="100"
				autocomplete="off"
				bind:value={note}
			/>
		</label>
		<label class="{fieldClass} w-20" for="invite-count">
			<span class={labelClass}>How many</span>
			<input
				id="invite-count"
				class={inputClass}
				type="number"
				min="1"
				max="50"
				required
				bind:value={count}
			/>
		</label>
		<label class="{fieldClass} w-28" for="invite-days">
			<span class={labelClass}>Expires after</span>
			<select id="invite-days" class="{inputClass} bg-background" bind:value={days}>
				<option value="1">1 day</option>
				<option value="7">1 week</option>
				<option value="14">2 weeks</option>
				<option value="30">30 days</option>
				<option value="never">Never</option>
			</select>
		</label>
		<Button type="submit" disabled={busy}>Create</Button>
	</form>
</section>

<section class="mb-10 flex flex-col gap-3">
	<h2>Who has invites</h2>
	{#if s.accounts.length > 0}
		<p class="text-[0.85em] text-muted">
			{s.held}
			{s.held === 1 ? 'invite' : 'invites'} held: {s.available} still to give, {s.pending} out as links.
		</p>
		<ul class="flex flex-col divide-y divide-line">
			{#each s.accounts as account (account.username)}
				<li>
					<a
						class="flex items-center gap-2.5 rounded-md py-2.5 text-foreground hover:bg-white/5 hover:no-underline"
						href="/admin/users/{account.username}"
					>
						<Avatar user={account} size={32} clickable={false} />
						<span class="min-w-0 flex-1 truncate">
							<b>{account.name}</b> <span class="opacity-70">@{account.username}</span>
						</span>
						<span class="text-right text-[0.9em]">
							<b>{account.available}</b>
							<span class="text-muted">
								to give{#if account.pending > 0}, {account.pending} out{/if}</span
							>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-muted">Nobody has invites to give right now.</p>
	{/if}
</section>

<section class="flex flex-col gap-3">
	<h2>Invite links</h2>
	<nav class="flex overflow-x-auto [scrollbar-width:none]" aria-label="Invite status">
		{#each ['all', 'pending', 'used', 'expired', 'revoked'] as status (status)}
			{@const active = data.status === status}
			<a
				class={tabClass(active)}
				href={pageHref(status, null)}
				aria-current={active ? 'page' : undefined}
				>{status === 'all' ? 'All' : STATUS_LABELS[status as Invite['status']]}</a
			>
		{/each}
	</nav>
	<form method="GET" class="flex items-end gap-2.5">
		{#if data.status !== 'all'}<input type="hidden" name="status" value={data.status} />{/if}
		<label class="{fieldClass} flex-1" for="invite-user">
			<span class={labelClass}>Made by or used by</span>
			<input
				id="invite-user"
				class={inputClass}
				name="username"
				placeholder="@username"
				value={data.username}
			/>
		</label>
		<Button size="sm" type="submit">Filter</Button>
		{#if data.username}
			<Button size="sm" href={data.status === 'all' ? '/admin/invites' : `?status=${data.status}`}
				>Clear</Button
			>
		{/if}
	</form>
	<InviteList
		invites={data.invites}
		admin
		onchange={changed}
		empty={data.username || data.status !== 'all' ? 'Nothing matches.' : 'No invites yet.'}
	/>
	{#if data.cursor || data.next}
		<div class="flex gap-2.5">
			{#if data.cursor}
				<Button href={pageHref(data.status, null)}>Newest</Button>
			{/if}
			{#if data.next}
				<Button href={pageHref(data.status, data.next)}>Older</Button>
			{/if}
		</div>
	{/if}
</section>
