<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import { api, messageOf } from '#lib/api.js';
	import { STATUS_LABELS, linkOf, type Invite } from '#lib/invites.js';

	type Props = {
		invites: Invite[];
		/** the admin list: shows who made each code, and revokes through the admin API */
		admin?: boolean;
		/** after a code was revoked, with what to tell */
		onchange?: (message: string, failed?: boolean) => void;
		empty?: string;
	};

	let { invites, admin = false, onchange, empty = 'No invites yet.' }: Props = $props();

	let copied = $state<number | null>(null);
	let busy = $state<number | null>(null);

	async function copy(invite: Invite) {
		await navigator.clipboard.writeText(linkOf(invite));
		copied = invite.id;
		setTimeout(() => {
			if (copied === invite.id) copied = null;
		}, 2000);
	}

	async function revoke(invite: Invite) {
		const who = invite.note ? ` (${invite.note})` : '';
		if (!confirm(`Revoke the invite ${invite.code}${who}? The link stops working right away.`))
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
		<li class="flex flex-col gap-[5px] py-2.5">
			<div class="flex flex-wrap items-center gap-2.5">
				<code
					class="text-[0.95em] {invite.status === 'pending'
						? 'select-all'
						: 'line-through opacity-60'}">{invite.code}</code
				>
				<span class="rounded-full border px-2 text-[0.75em] font-bold {statusClass(invite.status)}"
					>{STATUS_LABELS[invite.status]}</span
				>
				{#if invite.note}
					<span class="min-w-0 flex-1 truncate text-[0.9em] opacity-80">{invite.note}</span>
				{/if}
				{#if invite.status === 'pending'}
					<div class="ml-auto flex gap-[5px]">
						<Button size="sm" onclick={() => copy(invite)}
							>{copied === invite.id ? 'Copied' : 'Copy link'}</Button
						>
						<Button
							size="sm"
							variant="danger"
							disabled={busy === invite.id}
							onclick={() => revoke(invite)}>Revoke</Button
						>
					</div>
				{/if}
			</div>
			<p class="flex flex-wrap items-center gap-[5px] text-[0.8em] text-muted">
				{#if admin}
					{#if invite.inviter}
						<span>
							by <a href="/admin/users/{invite.inviter.username}">@{invite.inviter.username}</a>
							{invite.by_staff ? '(admin code)' : ''} ·
						</span>
					{:else}
						<span>by a deleted account ·</span>
					{/if}
				{/if}
				<span>created <LocalTime date={invite.created_at} /></span>
				{#if invite.status === 'used' && invite.used_at}
					<span>
						· used <LocalTime date={invite.used_at} />
						{#if invite.used_by}by{/if}
					</span>
					{#if invite.used_by}
						<Avatar user={invite.used_by} size={24} clickable={false} />
						<a
							href={admin
								? `/admin/users/${invite.used_by.username}`
								: `/@${invite.used_by.username}`}>@{invite.used_by.username}</a
						>
					{/if}
				{:else if invite.status === 'pending'}
					<span>
						· {#if invite.expires_at}expires <LocalTime date={invite.expires_at} />{:else}never
							expires{/if}
					</span>
				{/if}
			</p>
		</li>
	{:else}
		<li class="py-10 text-center text-muted">{empty}</li>
	{/each}
</ul>
