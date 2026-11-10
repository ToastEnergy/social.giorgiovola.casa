<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';

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
	<h2>Staff</h2>
	<p class="text-[0.9em] text-muted">
		Make someone a mod from their case page (Accounts → the account → Admin). Mods handle reports,
		ban, mute and delete posts of regular users. Admins also reset passwords and manage mods; new
		admins are made on the server with <code>bun admin.ts</code>.
	</p>
	<Button class="self-start" href="/admin/users?filter=staff">See the staff</Button>
</section>
