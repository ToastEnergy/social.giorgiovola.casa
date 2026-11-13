<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { api, messageOf } from '#lib/api.js';
	import { STATUS_LABELS, copyText, expiresIn, linkOf, type Invite } from '#lib/invites.js';
	import { DAY } from '#lib/settings.js';
	import { FULL, formatDate } from '#lib/time.svelte.js';

	type Props = {
		invites: Invite[];
		/** the admin list: shows who made each code, and revokes through the admin API */
		admin?: boolean;
		/** the status pill; a list of only pending codes doesn't need it */
		showStatus?: boolean;
		/** after a code was revoked, with what to tell */
		onchange?: (message: string, failed?: boolean) => void;
		empty?: string;
	};

	let {
		invites,
		admin = false,
		showStatus = true,
		onchange,
		empty = 'No invites yet.'
	}: Props = $props();

	let copied = $state<number | null>(null);
	let busy = $state<number | null>(null);

	async function copy(invite: Invite) {
		if (!(await copyText(linkOf(invite)))) {
			onchange?.('Could not copy the link.', true);
			return;
		}
		copied = invite.id;
		setTimeout(() => {
			if (copied === invite.id) copied = null;
		}, 2000);
	}

	async function revoke(invite: Invite) {
		const who = invite.note ? ` for ${invite.note}` : '';
		if (!confirm(`Revoke the invite${who} (${invite.code})? The link stops working right away.`))
			return;
		busy = invite.id;
		try {
			const res = await api<{ message: string }>(`${admin ? 'admin' : 'me'}/invites/${invite.id}`, {
				method: 'DELETE'
			});
			onchange?.(res.message);
		} catch (e) {
			onchange?.(messageOf(e), true);
		} finally {
			busy = null;
		}
	}

	const statusClass = (status: Invite['status']) =>
		status === 'pending'
			? 'border-accent text-accent'
			: status === 'used'
			? 'border-line text-foreground'
			: 'border-line text-muted';
</script>

<ul class="flex flex-col divide-y divide-line">
	{#each invites as invite (invite.id)}
		{@const pending = invite.status === 'pending'}
		<li class="flex items-center gap-2.5 py-2.5">
			<div class="flex min-w-0 flex-1 flex-col gap-[5px] {pending ? '' : 'opacity-70'}">
				<div class="flex min-w-0 items-center gap-2.5">
					{#if invite.note}
						<span class="min-w-0 truncate font-bold">{invite.note}</span>
					{:else}
						<span class="min-w-0 truncate text-muted italic">No note</span>
					{/if}
					{#if showStatus}
						<span
							class="shrink-0 rounded-full border px-2 text-[0.75em] font-bold {statusClass(
								invite.status
							)}">{STATUS_LABELS[invite.status]}</span
						>
					{/if}
				</div>
				<p class="flex flex-wrap items-center gap-x-[5px] text-[0.8em] text-muted">
					<code class={pending ? 'select-all' : 'line-through'}>{invite.code}</code>
					{#if admin}
						<span>·</span>
						{#if invite.inviter}
							<span>
								by <a href="/admin/users/{invite.inviter.username}">@{invite.inviter.username}</a>
								{invite.by_staff ? '(admin code)' : ''}
							</span>
						{:else}
							<span>by a deleted account</span>
						{/if}
					{/if}
					<span>·</span>
					{#if invite.status === 'used' && invite.used_at}
						{#if invite.used_by}
							<span>used by</span>
							<Avatar user={invite.used_by} size={24} clickable={false} />
							<a
								href={admin
									? `/admin/users/${invite.used_by.username}`
									: `/@${invite.used_by.username}`}>@{invite.used_by.username}</a
							>
							<span>on <LocalTime date={invite.used_at} options={DAY} /></span>
						{:else}
							<span>used <LocalTime date={invite.used_at} options={DAY} /></span>
						{/if}
					{:else if pending}
						{#if invite.expires_at}
							<span title={formatDate(invite.expires_at, FULL)}
								>expires {expiresIn(invite.expires_at)}</span
							>
						{:else}
							<span>never expires</span>
						{/if}
					{:else}
						<span>created <LocalTime date={invite.created_at} options={DAY} /></span>
					{/if}
				</p>
			</div>
			{#if pending}
				<div class="flex shrink-0 gap-[5px]">
					<Button size="sm" onclick={() => copy(invite)}
						>{copied === invite.id ? 'Copied!' : 'Copy link'}</Button
					>
					<Button
						size="sm"
						variant="danger"
						disabled={busy === invite.id}
						onclick={() => revoke(invite)}>Revoke</Button
					>
				</div>
			{/if}
		</li>
	{:else}
		<li class="py-10 text-center text-muted">{empty}</li>
	{/each}
</ul>
