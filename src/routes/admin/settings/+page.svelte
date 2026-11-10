<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import Avatar from '#lib/components/Avatar.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import type { User } from '#lib/types.js';

	let { data }: PageProps = $props();

	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let busy = $state(false);

	async function saveMotd(e: SubmitEvent) {
		e.preventDefault();
		const motd = String(new FormData(e.currentTarget as HTMLFormElement).get('motd') ?? '');
		busy = true;
		try {
			const res = await api<{ message: string }>('admin/motd', { method: 'PUT', json: { motd } });
			flash = { message: res.message, failed: false };
			await invalidateAll();
		} catch (err) {
			flash = { message: messageOf(err), failed: true };
		} finally {
			busy = false;
		}
	}

	type FoundGroup = {
		id: number;
		name: string;
		owner: string | null;
		members: Pick<User, 'username' | 'name' | 'avatar'>[];
		messages: number;
		created_at: string;
	};

	let groupId = $state('');
	let group = $state<FoundGroup | null>(null);
	let groupReason = $state('');
	let groupFlash = $state<{ message: string; failed: boolean } | null>(null);
	let groupBusy = $state(false);

	async function findGroup(e: SubmitEvent) {
		e.preventDefault();
		const id = groupId.trim();
		if (!/^\d+$/.test(id)) {
			groupFlash = { message: 'A group id is a number.', failed: true };
			return;
		}
		groupBusy = true;
		group = null;
		groupFlash = null;
		try {
			group = await api<FoundGroup>(`admin/groups/${id}`);
		} catch (err) {
			groupFlash = { message: messageOf(err), failed: true };
		} finally {
			groupBusy = false;
		}
	}

	async function deleteGroup() {
		if (!group) return;
		const target = group;
		if (
			!confirm(
				`Delete “${target.name}” for all ${target.members.length} members? Its ${target.messages} messages and images go with it. This can't be undone.`
			)
		)
			return;
		groupBusy = true;
		try {
			const res = await api<{ message: string }>(`admin/groups/${target.id}`, {
				method: 'DELETE',
				json: { reason: groupReason }
			});
			groupFlash = { message: res.message, failed: false };
			group = null;
			groupId = '';
			groupReason = '';
		} catch (err) {
			groupFlash = { message: messageOf(err), failed: true };
		} finally {
			groupBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Settings · Moderation</title>
</svelte:head>

<section class="mb-10 flex flex-col gap-3">
	<h2>Message of the day</h2>
	{#if flash}
		<p class="rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-accent text-background'}">
			{flash.message}
		</p>
	{/if}
	<form class="flex flex-col gap-2.5" onsubmit={saveMotd}>
		<label class="flex flex-col" for="motd">
			<span class="text-[0.8em] opacity-80">Shown in the post composer</span>
			<input
				id="motd"
				class="input"
				type="text"
				name="motd"
				placeholder={data.defaultMotd}
				maxlength={data.maxMotd}
				value={data.motd}
			/>
		</label>
		<p class="text-[0.85em] text-muted">
			Leave it empty for the default (“{data.defaultMotd}”).
		</p>
		<Button class="self-start" type="submit" disabled={busy}>Save</Button>
	</form>
</section>

<section class="mb-10 flex flex-col gap-3">
	<h2>Delete a group</h2>
	<p class="text-[0.9em] text-muted">
		Deletes a group chat with all its messages and images for everyone in it. The id is the number
		in the group's address (<code>/messages/groups/<b>123</b></code>).
	</p>
	{#if groupFlash}
		<p
			class="rounded-[5px] p-[5px] {groupFlash.failed ? 'bg-danger' : 'bg-accent text-background'}"
		>
			{groupFlash.message}
		</p>
	{/if}
	<form class="flex items-end gap-2.5" onsubmit={findGroup}>
		<label class="flex flex-1 flex-col" for="group-id">
			<span class="text-[0.8em] opacity-80">Group id</span>
			<input
				id="group-id"
				class="input"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				required
				bind:value={groupId}
			/>
		</label>
		<Button type="submit" disabled={groupBusy}>Find</Button>
	</form>
	{#if group}
		<div class="flex flex-col gap-2.5 rounded-[10px] bg-black/70 p-2.5">
			<div class="flex flex-col">
				<span class="font-bold break-words">{group.name}</span>
				<span class="text-[0.85em] text-muted">
					#{group.id} · {group.members.length}
					{group.members.length === 1 ? 'member' : 'members'} · {group.messages}
					{group.messages === 1 ? 'message' : 'messages'} · created
					<LocalTime date={group.created_at} />
				</span>
			</div>
			<ul class="flex flex-wrap gap-2.5">
				{#each group.members as m (m.username)}
					<li class="flex items-center gap-[5px] text-[0.9em]">
						<Avatar user={m} size={24} clickable={false} />
						<a href="/admin/users/{m.username}">@{m.username}</a>
						{#if m.username === group.owner}<span class="text-[0.75em] text-muted">owner</span>{/if}
					</li>
				{/each}
			</ul>
			<label class="flex flex-col" for="group-reason">
				<span class="text-[0.8em] opacity-80">Reason, for the moderation log (optional)</span>
				<input
					id="group-reason"
					class="border-b"
					type="text"
					maxlength={200}
					bind:value={groupReason}
				/>
			</label>
			<Button class="self-start" variant="danger" disabled={groupBusy} onclick={deleteGroup}>
				Delete for everyone
			</Button>
		</div>
	{/if}
</section>

<section class="mb-10 flex flex-col gap-3">
	<h2>Staff</h2>
	<p class="text-[0.9em] text-muted">
		Make someone a mod from their case page (Accounts → the account → Admin). Mods handle reports,
		ban, mute and delete posts of regular users. Admins also reset passwords and manage mods; new
		admins are made on the server with <code>bun admin.ts</code>.
	</p>
	<Button class="self-start" href="/admin/users?filter=staff">See the staff</Button>
</section>
