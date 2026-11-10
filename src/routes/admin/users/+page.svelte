<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import type { PageProps } from './$types';
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { DATE } from '#lib/time.svelte.js';
	import { relative } from '#lib/moderation.js';

	let { data }: PageProps = $props();

	const filters = [
		{ value: 'all', label: 'All' },
		{ value: 'reported', label: 'Reported' },
		{ value: 'banned', label: 'Banned' },
		{ value: 'muted', label: 'Muted' },
		{ value: 'staff', label: 'Staff' }
	];

	// keeps the search and filter when moving between pages
	const href = (page: number, filter: string = data.filter) => {
		const params = new URLSearchParams();
		if (data.q) params.set('q', data.q);
		if (filter !== 'all') params.set('filter', filter);
		if (page > 0) params.set('page', String(page));
		const query = params.toString();
		return query ? `?${query}` : '?';
	};

	// a search that found the account through one of its identities says which
	const matchedIdentity = (u: (typeof data.users)[number]) => {
		const q = data.q.toLowerCase();
		if (!q || u.username.includes(q) || u.name.toLowerCase().includes(q)) return null;
		return (
			[...u.identities, ...u.shared_with].find(
				(i) => i.username.includes(q) || i.name.toLowerCase().includes(q)
			) ?? null
		);
	};

	const badge = 'rounded-full border px-2 text-[0.75em] font-bold whitespace-nowrap';
</script>

<svelte:head>
	<title>Accounts · Moderation</title>
</svelte:head>

<div class="flex flex-col gap-2.5">
	<form method="GET" class="flex items-center gap-2.5 border-b focus-within:border-accent">
		<Search size={18} class="shrink-0 text-muted" />
		<input
			class="min-w-0 flex-1 bg-transparent py-2.5 outline-none"
			type="search"
			name="q"
			placeholder="Search accounts, identities and bots"
			aria-label="Search accounts"
			value={data.q}
		/>
		{#if data.filter !== 'all'}
			<input type="hidden" name="filter" value={data.filter} />
		{/if}
	</form>

	<nav class="flex flex-wrap gap-2.5" aria-label="Filter accounts">
		{#each filters as filter (filter.value)}
			<Button
				size="sm"
				variant={data.filter === filter.value ? 'primary' : 'default'}
				aria-current={data.filter === filter.value ? 'page' : undefined}
				href={href(0, filter.value)}>{filter.label}</Button
			>
		{/each}
	</nav>

	<ul class="flex flex-col">
		{#each data.users as u (u.username)}
			{@const via = matchedIdentity(u)}
			<li class="border-b border-line last:border-b-0">
				<a
					class="flex items-center gap-2.5 rounded-md p-2.5 text-foreground hover:bg-white/5 hover:no-underline"
					href="/admin/users/{u.username}"
				>
					<Avatar user={u} size={40} clickable={false} />
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="truncate">
							<b>{u.name}</b>
							<span class="opacity-70">@{u.username}</span>
						</span>
						<span class="truncate text-[0.8em] text-muted">
							{#if via}
								via @{via.username} ·
							{/if}
							{#if u.banned_at}
								banned {u.banned_until ? `· ends ${relative(u.banned_until)}` : ''}
							{:else if u.muted_at}
								muted {u.muted_until ? `· ends ${relative(u.muted_until)}` : ''}
							{:else}
								joined <LocalTime date={u.created_at} options={DATE} />
							{/if}
							{#if u.identities.length > 0}
								· {u.identities.length}
								{u.identities.length === 1 ? 'identity' : 'identities'}
							{/if}
						</span>
					</div>
					<div class="flex flex-wrap justify-end gap-[5px]">
						{#if u.open_reports > 0}
							<span class="{badge} border-danger bg-danger text-background"
								>{u.open_reports} {u.open_reports === 1 ? 'report' : 'reports'}</span
							>
						{/if}
						{#if u.role !== 'user'}
							<span class="{badge} border-accent text-accent">{u.role}</span>
						{/if}
						{#if u.banned_at}
							<span class="{badge} border-danger text-danger">banned</span>
						{/if}
						{#if u.muted_at}
							<span class="{badge} border-danger text-danger">muted</span>
						{/if}
						{#if u.self}
							<span class="{badge} border-line text-muted">you</span>
						{/if}
					</div>
					<ChevronRight size={18} class="shrink-0 text-muted" />
				</a>
			</li>
		{:else}
			<li class="py-10 text-center text-muted">No accounts found.</li>
		{/each}
	</ul>

	{#if data.page > 0 || data.hasMore}
		<div class="flex gap-2.5">
			{#if data.page > 0}
				<Button href={href(data.page - 1)}>Previous</Button>
			{/if}
			{#if data.hasMore}
				<Button href={href(data.page + 1)}>Next</Button>
			{/if}
		</div>
	{/if}
</div>
