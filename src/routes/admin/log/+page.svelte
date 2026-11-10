<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import LogEntry from '#lib/components/moderation/LogEntry.svelte';
	import { LOG_ACTIONS } from '#lib/moderation.js';

	let { data }: PageProps = $props();

	const filtered = $derived(!!(data.username || data.actor || data.action));

	// the filters of this page with another cursor
	const pageHref = (cursor: string | null) => {
		const params = new URLSearchParams();
		if (data.username) params.set('username', data.username);
		if (data.actor) params.set('actor', data.actor);
		if (data.action) params.set('action', data.action);
		if (cursor) params.set('cursor', cursor);
		const query = params.toString();
		return query ? `?${query}` : '/admin/log';
	};

	const fieldClass = 'flex min-w-0 flex-1 basis-32 flex-col';
	const labelClass = 'text-[0.8em] opacity-80';
	const inputClass = 'min-w-0 border-b bg-transparent py-[5px] outline-none focus:border-accent';
</script>

<svelte:head>
	<title>Log · Moderation</title>
</svelte:head>

<div class="flex flex-col gap-2.5">
	<form method="GET" class="flex flex-wrap items-end gap-2.5">
		<label class={fieldClass}>
			<span class={labelClass}>Account</span>
			<input class={inputClass} name="username" placeholder="@username" value={data.username} />
		</label>
		<label class={fieldClass}>
			<span class={labelClass}>Staff member</span>
			<input class={inputClass} name="actor" placeholder="@username" value={data.actor} />
		</label>
		<label class={fieldClass}>
			<span class={labelClass}>Action</span>
			<select class="{inputClass} bg-background" name="action" value={data.action}>
				<option value="">Any</option>
				{#each Object.entries(LOG_ACTIONS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</label>
		<div class="flex gap-2.5">
			<Button size="sm" type="submit">Filter</Button>
			{#if filtered}
				<Button size="sm" href="/admin/log">Clear</Button>
			{/if}
		</div>
	</form>

	<ul class="flex flex-col divide-y divide-line">
		{#each data.entries as entry (entry.id)}
			<LogEntry {entry} />
		{:else}
			<li class="py-10 text-center text-muted">
				{filtered ? 'Nothing matches these filters.' : 'Nothing has been logged yet.'}
			</li>
		{/each}
	</ul>

	{#if data.cursor || data.next}
		<div class="flex gap-2.5">
			{#if data.cursor}
				<Button href={pageHref(null)}>Newest</Button>
			{/if}
			{#if data.next}
				<Button href={pageHref(data.next)}>Older</Button>
			{/if}
		</div>
	{/if}
</div>
