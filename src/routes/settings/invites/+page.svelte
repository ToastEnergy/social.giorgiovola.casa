<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import InviteList from '#lib/components/InviteList.svelte';
	import { invalidate } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { linkOf, type Invite } from '#lib/invites.js';
	import { fieldClass, hintClass, inputClass, labelClass, sectionClass } from '#lib/settings.js';

	let { data }: PageProps = $props();

	const b = $derived(data.balance);

	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let busy = $state(false);
	let note = $state('');

	async function changed(message: string, failed = false) {
		flash = { message, failed };
		if (!failed) await invalidate('app:invites');
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		try {
			const invite = await api<Invite>('me/invites', { method: 'POST', json: { note } });
			note = '';
			// copied right away: sending it is the next thing to do
			let copied = false;
			try {
				await navigator.clipboard.writeText(linkOf(invite));
				copied = true;
			} catch {
				// no clipboard access: the link is in the list below
			}
			await changed(
				copied ? `Invite ${invite.code} created, link copied.` : `Invite ${invite.code} created.`
			);
		} catch (err) {
			await changed(messageOf(err), true);
		} finally {
			busy = false;
		}
	}
</script>

<section class={sectionClass}>
	<h2>Invite someone</h2>
	{#if b.invites === 0}
		<p class={hintClass}>
			You don't have any invites. People join this instance by invitation only, and the admins hand
			invites out.
		</p>
	{:else}
		<p>
			You can invite <b>{b.available}</b>
			{b.available === 1 ? 'more person' : 'more people'}{#if b.pending > 0}, and {b.pending}
				{b.pending === 1 ? 'code is' : 'codes are'} waiting to be used{/if}.
		</p>
		<p class={hintClass}>
			Each invite is a link that works once and expires after two weeks. An invite is only used up
			when someone signs up with it: revoke a code, or let it expire, and you get it back.
		</p>
	{/if}
	{#if flash}
		<p class="rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-accent text-background'}">
			{flash.message}
		</p>
	{/if}
	{#if b.available > 0}
		<form class="flex items-end gap-2.5" onsubmit={create}>
			<label class="{fieldClass} flex-1" for="invite-note">
				<span class={labelClass}>Who is it for? (optional, only you see it)</span>
				<input
					id="invite-note"
					class={inputClass}
					type="text"
					maxlength="100"
					autocomplete="off"
					bind:value={note}
				/>
			</label>
			<Button type="submit" disabled={busy}>Create invite</Button>
		</form>
	{/if}
</section>

{#if data.invites.length > 0}
	<section class={sectionClass}>
		<h2>Your invites</h2>
		<InviteList invites={data.invites} onchange={changed} />
	</section>
{/if}
