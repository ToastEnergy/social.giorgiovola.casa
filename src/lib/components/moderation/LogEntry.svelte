<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import Clock from '@lucide/svelte/icons/clock';
	import Flag from '@lucide/svelte/icons/flag';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Ticket from '@lucide/svelte/icons/ticket';
	import MicOff from '@lucide/svelte/icons/mic-off';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Shield from '@lucide/svelte/icons/shield';
	import Trash from '@lucide/svelte/icons/trash';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { LOG_ACTIONS, relative, type LogEntry } from '#lib/moderation.js';

	type Props = {
		entry: LogEntry;
		/** leaves out who it was about (the account page is about one account) */
		compact?: boolean;
	};

	let { entry, compact = false }: Props = $props();

	const d = $derived(entry.details ?? {});
	const expired = $derived(d.expired === true);
	const Icon = $derived(
		expired
			? Clock
			: {
					ban: Ban,
					unban: RotateCcw,
					mute: MicOff,
					unmute: RotateCcw,
					role: Shield,
					password: KeyRound,
					delete_post: Trash,
					delete_group: Trash,
					note: NotebookPen,
					report_resolved: Flag,
					report_dismissed: Flag,
					report_reopened: Flag,
					invites: Ticket,
					invites_everyone: Ticket
			  }[entry.action] ?? Shield
	);
	const danger = $derived(['ban', 'mute', 'delete_post', 'delete_group'].includes(entry.action));
	const reportCount = $derived(Array.isArray(d.reports) ? d.reports.length : 0);
</script>

<li class="flex gap-2.5 py-2.5">
	<span
		class="mt-[2px] flex size-7 shrink-0 items-center justify-center rounded-full border {danger
			? 'border-danger text-danger'
			: entry.action === 'note'
			? 'border-accent text-accent'
			: 'border-line text-muted'}"
	>
		<Icon size={14} />
	</span>
	<div class="flex min-w-0 flex-1 flex-col gap-[5px]">
		<p class="text-[0.95em]">
			<b>{LOG_ACTIONS[entry.action] ?? entry.action}</b>
			{#if !compact && entry.target}
				<span class="text-muted">·</span>
				<a href="/admin/users/{entry.target}">@{entry.target}</a>
			{/if}
			{#if entry.expires_at}
				<span class="text-muted">· ends {relative(entry.expires_at)}</span>
			{:else if entry.action === 'ban' || entry.action === 'mute'}
				<span class="text-muted">· permanent</span>
			{/if}
			{#if entry.action === 'role'}
				<span class="text-muted">· {d.from} → {d.to}</span>
			{/if}
			{#if entry.action === 'invites'}
				<span class="text-muted"
					>· {d.from} → {d.to}{#if typeof d.revoked === 'number' && d.revoked > 0}, {d.revoked}
						{d.revoked === 1 ? 'code' : 'codes'} revoked{/if}</span
				>
			{/if}
			{#if entry.action === 'invites_everyone'}
				<span class="text-muted"
					>· +{d.count} to {d.accounts} {d.accounts === 1 ? 'account' : 'accounts'}</span
				>
			{/if}
			{#if entry.action === 'delete_group' && typeof d.name === 'string'}
				<span class="text-muted">· “{d.name}”</span>
			{/if}
			{#if reportCount > 1}
				<span class="text-muted">· {reportCount} reports</span>
			{/if}
		</p>
		{#if entry.action === 'note' && entry.reason}
			<p
				class="rounded-[10px] border border-line p-2.5 text-[0.9em] break-words whitespace-pre-line"
			>
				{entry.reason}
			</p>
		{:else if entry.reason}
			<p class="text-[0.9em] break-words opacity-80">“{entry.reason}”</p>
		{/if}
		{#if entry.action === 'delete_post' && typeof d.content === 'string'}
			<p
				class="line-clamp-4 rounded-md border-l-2 border-line bg-white/5 p-2.5 text-[0.9em] break-words whitespace-pre-line"
			>
				{#if d.author && d.author !== entry.target}<span class="text-muted"
						>@{d.author}:
					</span>{/if}{d.content || '(no text)'}
			</p>
		{/if}
		{#if entry.action === 'delete_group' && Array.isArray(d.members)}
			<p class="text-[0.9em] break-words text-muted">
				{d.members.length}
				{d.members.length === 1 ? 'member' : 'members'}{#if d.members.length > 0}:
					{d.members.map((u) => `@${u}`).join(', ')}{/if}{#if typeof d.messages === 'number'}
					· {d.messages} {d.messages === 1 ? 'message' : 'messages'}{/if}
			</p>
		{/if}
		<p class="text-[0.8em] text-muted">
			{#if expired}
				ran out
			{:else if entry.system}
				system
			{:else}
				by <a class="text-inherit" href="/admin/log?actor={entry.actor}">@{entry.actor}</a>
			{/if}
			· <LocalTime date={entry.created_at} />
		</p>
	</div>
</li>
