<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import ActionDialog from '#lib/components/moderation/ActionDialog.svelte';
	import ReportCard from '#lib/components/moderation/ReportCard.svelte';
	import { invalidate } from '$app/navigation';

	let { data }: PageProps = $props();

	// the outcome of the last action
	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let dialog = $state<{ action: 'ban' | 'mute'; username: string } | null>(null);

	async function changed(message: string, failed = false) {
		flash = { message, failed };
		dialog = null;
		if (!failed) await invalidate('app:admin');
	}

	const filters = [
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'dismissed', label: 'Dismissed' },
		{ value: 'all', label: 'All' }
	];
	// keeps the account filter when switching status or page
	const hrefOf = (status: string, cursor?: string | null) => {
		const params = new URLSearchParams();
		if (status !== 'open') params.set('status', status);
		if (data.username) params.set('username', data.username);
		if (cursor) params.set('cursor', cursor);
		const query = params.toString();
		return query ? `/admin?${query}` : '/admin';
	};
</script>

<svelte:head>
	<title>Reports · Moderation</title>
</svelte:head>

<div class="flex flex-col gap-2.5">
	<nav class="flex flex-wrap gap-2.5" aria-label="Report status">
		{#each filters as f (f.value)}
			<Button
				size="sm"
				variant={data.status === f.value ? 'primary' : 'default'}
				aria-current={data.status === f.value ? 'page' : undefined}
				href={hrefOf(f.value)}>{f.label}</Button
			>
		{/each}
	</nav>

	{#if data.username}
		<p class="flex items-center gap-2.5 text-[0.9em]">
			<span>Reports against <a href="/admin/users/{data.username}">@{data.username}</a></span>
			<a
				class="text-muted"
				href={data.status === 'open' ? '/admin' : `/admin?status=${data.status}`}>Show everyone’s</a
			>
		</p>
	{/if}

	{#if flash}
		<p
			class="rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-accent text-background'}"
			role="status"
		>
			{flash.message}
		</p>
	{/if}

	{#each data.reports as report (report.id)}
		<ReportCard
			{report}
			onchange={changed}
			onmoderate={(action, username) => (dialog = { action, username })}
		/>
	{:else}
		<div class="flex flex-col items-center gap-2.5 py-10 text-center text-muted">
			<Inbox size={32} />
			<p>
				{data.status === 'open'
					? 'No open reports. All caught up.'
					: `No ${data.status === 'all' ? '' : data.status} reports.`}
			</p>
		</div>
	{/each}

	{#if data.cursor || data.next}
		<div class="flex gap-2.5">
			{#if data.cursor}
				<Button href={hrefOf(data.status)}>Newest</Button>
			{/if}
			{#if data.next}
				<Button href={hrefOf(data.status, data.next)}>Older</Button>
			{/if}
		</div>
	{/if}
</div>

<ActionDialog
	action={dialog?.action ?? null}
	username={dialog?.username ?? ''}
	onclose={() => (dialog = null)}
	ondone={(message) => changed(message)}
/>
