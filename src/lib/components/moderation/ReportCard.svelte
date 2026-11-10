<script lang="ts">
	import Flag from '@lucide/svelte/icons/flag';
	import User from '@lucide/svelte/icons/user';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { api, messageOf } from '#lib/api.js';
	import { categoryLabel, type Report, type ReportStatus } from '#lib/moderation.js';

	type Props = {
		report: Report;
		/** something changed: what to tell the staff member, and whether it failed */
		onchange: (message: string, failed?: boolean) => void;
		/** opens the ban or mute dialog for the account behind the report */
		onmoderate: (action: 'ban' | 'mute', username: string) => void;
		/** hides who the report is against (the account page already says) */
		compact?: boolean;
	};

	let { report, onchange, onmoderate, compact = false }: Props = $props();

	let note = $state('');
	let busy = $state(false);

	const open = $derived(report.status === 'open');
	const subjectHref = $derived(
		report.kind === 'post' && report.post?.id && !report.post.deleted
			? `/@${report.target.username}/${report.post.id}`
			: `/@${report.target.username}`
	);

	async function setStatus(status: ReportStatus, related = false) {
		busy = true;
		try {
			const res = await api<{ message: string }>(`admin/reports/${report.id}`, {
				method: 'PATCH',
				json: { status, note, related }
			});
			note = '';
			onchange(res.message);
		} catch (e) {
			onchange(messageOf(e), true);
		} finally {
			busy = false;
		}
	}

	async function deletePost() {
		if (!report.post?.id) return;
		if (!confirm(`Delete this post by @${report.target.username}? Its replies go with it.`)) return;
		busy = true;
		try {
			await api(`posts/${report.post.id}`, { method: 'DELETE' });
			onchange('Post deleted, its reports are resolved.');
		} catch (e) {
			onchange(messageOf(e), true);
		} finally {
			busy = false;
		}
	}

	const badge = 'rounded-full border px-2 text-[0.75em] font-bold';
	const statusClass = {
		open: 'border-danger text-danger',
		resolved: 'border-accent text-accent',
		dismissed: 'border-line text-muted'
	};
</script>

<article
	class="flex flex-col gap-2.5 rounded-md border p-2.5 {open ? 'border-line' : 'border-line/60'}"
>
	<header class="flex flex-wrap items-center gap-x-2.5 gap-y-[5px]">
		<span class="flex items-center gap-[5px] font-bold">
			{#if report.kind === 'post'}<Flag size={15} />{:else}<User size={15} />{/if}
			{categoryLabel(report.category)}
		</span>
		<span class="{badge} {statusClass[report.status]}">{report.status}</span>
		{#if open && report.related_open > 0}
			<span class="{badge} border-danger bg-danger text-background"
				>+{report.related_open} more {report.related_open === 1 ? 'report' : 'reports'}</span
			>
		{/if}
		<span class="ml-auto text-[0.8em] text-muted">
			#{report.id} · <LocalTime date={report.created_at} />
		</span>
	</header>

	{#if !compact}
		<div class="flex items-center gap-2.5">
			<Avatar user={report.target} size={36} />
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="truncate">
					<a class="font-bold text-foreground" href="/@{report.target.username}"
						>{report.target.name}</a
					>
					<span class="opacity-70">@{report.target.username}</span>
				</span>
				<span class="text-[0.8em] text-muted">
					{#if report.account.username !== report.target.username}
						identity of @{report.account.username} ·
					{/if}
					{report.account.role !== 'user' ? report.account.role : 'user'}
					{#if report.account.banned}· <span class="text-danger">banned</span>{/if}
					{#if report.account.muted}· <span class="text-danger">muted</span>{/if}
				</span>
			</div>
			<Button size="sm" href="/admin/users/{report.account.username}">Case</Button>
		</div>
	{/if}

	{#if report.post}
		<a
			class="flex flex-col gap-[5px] rounded-md border-l-2 border-line bg-white/5 p-2.5 text-foreground hover:no-underline {report
				.post.deleted
				? 'pointer-events-none'
				: 'hover:border-accent'}"
			href={subjectHref}
		>
			<span class="text-[0.8em] text-muted">
				{report.post.deleted ? 'Post deleted · copy taken when reported' : 'Reported post'}
				{#if report.post.edited}· edited since{/if}
			</span>
			{#if report.post.content}
				<span class="line-clamp-6 break-words whitespace-pre-line">{report.post.content}</span>
			{/if}
			{#if report.post.images.length > 0}
				<span class="text-[0.85em] text-muted"
					>{report.post.images.length}
					{report.post.images.length === 1 ? 'image' : 'images'}</span
				>
			{/if}
		</a>
	{:else if compact}
		<a class="text-[0.9em]" href={subjectHref}>Reported profile @{report.target.username}</a>
	{/if}

	<p class="flex flex-wrap items-center gap-[5px] text-[0.85em] text-muted">
		Reported by
		<a class="text-foreground" href="/@{report.reporter.username}">@{report.reporter.username}</a>
	</p>
	{#if report.details}
		<blockquote class="rounded-[10px] border border-line p-2.5 text-[0.9em] whitespace-pre-line">
			{report.details}
		</blockquote>
	{/if}

	{#if !open}
		<p class="text-[0.85em] text-muted">
			{report.status === 'resolved' ? 'Resolved' : 'Dismissed'}
			{#if report.resolved_by}by @{report.resolved_by}{/if}
			{#if report.resolved_at}· <LocalTime date={report.resolved_at} />{/if}
			{#if report.resolution_note}<br /><span class="text-foreground"
					>“{report.resolution_note}”</span
				>{/if}
		</p>
		<div class="flex">
			<Button size="sm" disabled={busy} onclick={() => setStatus('open')}>Reopen</Button>
		</div>
	{:else}
		<input
			class="input py-[5px]! text-[0.9em]"
			type="text"
			maxlength="500"
			placeholder="Note for the staff (optional)"
			aria-label="Note for the staff"
			bind:value={note}
		/>
		<div class="flex flex-wrap gap-2.5">
			<Button
				size="sm"
				variant="primary"
				disabled={busy}
				onclick={() => setStatus('resolved', true)}
				>{report.related_open > 0 ? `Resolve all ${report.related_open + 1}` : 'Resolve'}</Button
			>
			<Button size="sm" disabled={busy} onclick={() => setStatus('dismissed', true)}
				>{report.related_open > 0 ? 'Dismiss all' : 'Dismiss'}</Button
			>
			{#if report.can_moderate}
				{#if report.post && !report.post.deleted}
					<Button size="sm" variant="danger" disabled={busy} onclick={deletePost}
						>Delete post</Button
					>
				{/if}
				{#if !report.account.muted}
					<Button size="sm" onclick={() => onmoderate('mute', report.account.username)}
						>Mute…</Button
					>
				{/if}
				{#if !report.account.banned}
					<Button
						size="sm"
						variant="danger"
						onclick={() => onmoderate('ban', report.account.username)}>Ban…</Button
					>
				{/if}
			{/if}
		</div>
	{/if}
</article>
