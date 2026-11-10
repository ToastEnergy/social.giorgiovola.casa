<script lang="ts">
	import Shield from '@lucide/svelte/icons/shield';
	import Button from '#lib/components/Button.svelte';
	import ActionDialog from '#lib/components/moderation/ActionDialog.svelte';
	import { invalidateAll } from '$app/navigation';
	import { messageOf } from '#lib/api.js';
	import { moderate, relative } from '#lib/moderation.js';

	type Props = {
		username: string;
		banned: boolean;
		muted: boolean;
		banReason: string | null;
		muteReason: string | null;
		bannedUntil: string | null;
		mutedUntil: string | null;
		identity: boolean;
	};

	let { username, banned, muted, banReason, muteReason, bannedUntil, mutedUntil, identity }: Props =
		$props();

	let message = $state<string | null>(null);
	let failed = $state(false);
	let busy = $state(false);
	let dialog = $state<'ban' | 'mute' | null>(null);

	async function done(text: string) {
		dialog = null;
		message = text;
		failed = false;
		await invalidateAll();
	}

	async function lift(action: 'unban' | 'unmute') {
		busy = true;
		try {
			await done((await moderate(username, action)).message);
		} catch (err) {
			message = messageOf(err);
			failed = true;
		} finally {
			busy = false;
		}
	}

	const states = $derived(
		[
			banned && { label: 'Banned', reason: banReason, until: bannedUntil },
			muted && { label: 'Muted', reason: muteReason, until: mutedUntil }
		].filter((s) => !!s)
	);
</script>

<section
	class="mb-5 flex flex-col gap-2.5 rounded-md border p-2.5 {banned || muted
		? 'border-danger'
		: 'border-line'}"
	aria-label="Moderation"
>
	<div class="flex items-center gap-2.5">
		<Shield size={18} class="shrink-0 text-muted" />
		<b class="flex-1 text-[0.9em]">Moderation</b>
		<a class="text-[0.85em]" href="/admin/users/{username}">Open case</a>
	</div>
	{#if identity}
		<p class="text-[0.85em] text-muted">
			This profile is an identity: actions apply to the whole account behind it.
		</p>
	{/if}
	{#each states as s (s.label)}
		<p class="text-[0.9em]">
			<b class="text-danger">{s.label}</b>
			<span class="text-muted">
				{s.until ? `· ends ${relative(s.until)}` : '· permanent'}
			</span>
			{#if s.reason}<br /><span class="text-[0.9em] opacity-80">“{s.reason}”</span>{/if}
		</p>
	{/each}
	{#if message}
		<p class="rounded-[5px] p-[5px] {failed ? 'bg-danger' : 'bg-accent text-background'}">
			{message}
		</p>
	{/if}

	<div class="flex flex-wrap gap-2.5">
		{#if banned}
			<Button size="sm" disabled={busy} onclick={() => lift('unban')}>Unban</Button>
			<Button size="sm" onclick={() => (dialog = 'ban')}>Change ban</Button>
		{:else}
			<Button size="sm" variant="danger" onclick={() => (dialog = 'ban')}>Ban…</Button>
		{/if}
		{#if muted}
			<Button size="sm" disabled={busy} onclick={() => lift('unmute')}>Unmute</Button>
			<Button size="sm" onclick={() => (dialog = 'mute')}>Change mute</Button>
		{:else}
			<Button size="sm" onclick={() => (dialog = 'mute')}>Mute…</Button>
		{/if}
	</div>
</section>

<ActionDialog
	action={dialog}
	{username}
	current={dialog === 'ban' && banned
		? { reason: banReason, until: bannedUntil }
		: dialog === 'mute' && muted
		? { reason: muteReason, until: mutedUntil }
		: null}
	onclose={() => (dialog = null)}
	ondone={done}
/>
