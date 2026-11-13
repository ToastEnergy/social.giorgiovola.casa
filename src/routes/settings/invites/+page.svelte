<script lang="ts">
	import type { PageProps } from './$types';
	import Button from '#lib/components/Button.svelte';
	import InviteList from '#lib/components/InviteList.svelte';
	import { tick } from 'svelte';
	import { browser } from '$app/env';
	import { invalidate } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { copyText, expiresIn, linkOf, type Invite } from '#lib/invites.js';
	import { hintClass, inputClass, labelClass, sectionClass } from '#lib/settings.js';

	let { data }: PageProps = $props();

	const b = $derived(data.balance);
	const pending = $derived(data.invites.filter((i) => i.status === 'pending'));
	const past = $derived(data.invites.filter((i) => i.status !== 'pending'));

	let flash = $state<{ message: string; failed: boolean } | null>(null);
	let busy = $state(false);
	let note = $state('');

	// the code just made, shown with its link until dismissed; gone once it's revoked
	let freshId = $state<number | null>(null);
	const fresh = $derived(pending.find((i) => i.id === freshId) ?? null);
	let freshCopied = $state(false);
	// the card only shows after creating one in the browser, so the server never renders this
	const canShare = browser && typeof navigator.share === 'function';

	async function changed(message: string, failed = false) {
		flash = { message, failed };
		if (!failed) await invalidate('app:invites');
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		flash = null;
		try {
			const invite = await api<Invite>('me/invites', { method: 'POST', json: { note } });
			note = '';
			await invalidate('app:invites');
			freshId = invite.id;
			// sending it is the next thing to do; without clipboard access the button is right there
			freshCopied = await copyText(linkOf(invite)).catch(() => false);
		} catch (err) {
			flash = { message: messageOf(err), failed: true };
		} finally {
			busy = false;
		}
	}

	let noteInput = $state<HTMLInputElement>();

	// back to the form, ready to type the next name
	async function another() {
		freshId = null;
		await tick();
		noteInput?.focus();
	}

	async function copyFresh(invite: Invite) {
		freshCopied = await copyText(linkOf(invite));
		if (!freshCopied) flash = { message: 'Could not copy the link.', failed: true };
	}

	async function shareFresh(invite: Invite) {
		try {
			await navigator.share({ url: linkOf(invite) });
		} catch {
			// cancelled
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
			{#if b.available > 0}
				You have <b>{b.available}</b> {b.available === 1 ? 'invite' : 'invites'} left.
			{:else}
				You have no invites left.
			{/if}
			{#if b.pending > 0}
				<span class="text-muted"
					>{b.pending}
					{b.pending === 1 ? 'link is' : 'links are'} waiting to be used.</span
				>
			{/if}
		</p>
		<p class={hintClass}>
			Each invite is a link that works once and expires after two weeks. If nobody signs up with it,
			you get the invite back.
		</p>
	{/if}

	{#if flash}
		<p class="rounded-[5px] p-[5px] {flash.failed ? 'bg-danger' : 'bg-black/70'}">
			{flash.message}
		</p>
	{/if}

	{#if fresh}
		<div class="flex flex-col gap-2.5 rounded-[10px] border border-accent bg-black/70 p-2.5">
			<p class="font-bold">
				{fresh.note ? `Your invite for ${fresh.note} is ready` : 'Your invite is ready'}
			</p>
			<input
				class="{inputClass} w-full p-[5px] font-mono text-[0.9em]"
				readonly
				aria-label="Invite link"
				value={linkOf(fresh)}
				onfocus={(e) => e.currentTarget.select()}
			/>
			<div class="flex flex-wrap items-center gap-[5px]">
				<Button variant="primary" onclick={() => copyFresh(fresh)}
					>{freshCopied ? 'Link copied!' : 'Copy link'}</Button
				>
				{#if canShare}
					<Button onclick={() => shareFresh(fresh)}>Share…</Button>
				{/if}
				{#if b.available > 0}
					<Button class="ml-auto" onclick={another}>Invite someone else</Button>
				{:else}
					<Button class="ml-auto" onclick={() => (freshId = null)}>Done</Button>
				{/if}
			</div>
			<p class={hintClass}>
				Send it to them however you like. It works once{fresh.expires_at
					? ` and expires ${expiresIn(fresh.expires_at)}`
					: ''}.{#if b.available > 0}
					You have {b.available} more {b.available === 1 ? 'invite' : 'invites'} to give.{/if}
			</p>
		</div>
	{:else if b.available > 0}
		<form class="flex flex-col gap-2.5" onsubmit={create}>
			<label class="flex flex-col" for="invite-note">
				<span class={labelClass}>Who is it for?</span>
				<input
					bind:this={noteInput}
					id="invite-note"
					class="{inputClass} py-[5px]"
					type="text"
					maxlength="100"
					autocomplete="off"
					placeholder="A name, so you remember (optional, only you see it)"
					bind:value={note}
				/>
			</label>
			<Button class="self-start" variant="primary" type="submit" disabled={busy}
				>{busy ? 'Creating…' : 'Create invite link'}</Button
			>
		</form>
	{/if}
</section>

{#if pending.length > 0}
	<section class={sectionClass}>
		<h2>Waiting to be used</h2>
		<InviteList invites={pending} showStatus={false} onchange={changed} />
	</section>
{/if}

{#if past.length > 0}
	<section class={sectionClass}>
		<details>
			<summary class="cursor-pointer text-muted">
				Past invites ({past.length})
			</summary>
			<InviteList invites={past} onchange={changed} />
		</details>
	</section>
{/if}
