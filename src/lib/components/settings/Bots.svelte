<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import LocalTime from '#lib/components/LocalTime.svelte';
	import NewTokenPanel from './NewToken.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { DAY, hintClass, sectionClass, type Bot, type NewToken } from '#lib/settings.js';

	let { bots, max }: { bots: Bot[]; max: number } = $props();

	let busy = $state(false);
	let error = $state('');
	// only in the response that created it: a token is never shown again
	let newToken = $state<NewToken | null>(null);
	// the bot whose profile form is open
	let editingBot = $state<number | null>(null);

	const canAddBot = $derived(bots.length < max);

	/** Runs an API call, then reloads the page's data; failures show above the list. */
	async function run(action: () => Promise<unknown>) {
		busy = true;
		error = '';
		try {
			await action();
			await invalidateAll();
			return true;
		} catch (e) {
			error = messageOf(e, 'Something went wrong, try again.');
			return false;
		} finally {
			busy = false;
		}
	}

	async function createBot(e: SubmitEvent) {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		const fields = new FormData(form);
		let created: { username: string; token: string } | undefined;
		const ok = await run(async () => {
			created = await api('me/bots', {
				method: 'POST',
				json: { name: fields.get('name'), username: fields.get('username') }
			});
		});
		if (ok && created) {
			newToken = { label: `@${created.username}`, token: created.token, bot: true };
			form.reset();
		}
	}

	async function regenerateToken(username: string) {
		if (!confirm(`Regenerate the token of @${username}? The current one stops working right away.`))
			return;
		let created: { username: string; token: string } | undefined;
		await run(async () => (created = await api(`me/bots/${username}/token`, { method: 'POST' })));
		if (created) newToken = { label: `@${created.username}`, token: created.token, bot: true };
	}

	function deleteBot(username: string) {
		if (confirm(`Delete @${username} and all of its posts? This can't be undone.`))
			run(() => api(`me/bots/${username}`, { method: 'DELETE' }));
	}

	// keeps the form open when the server refuses the changes, so they can be fixed
	async function saveBot(e: SubmitEvent, username: string) {
		e.preventDefault();
		const form = new FormData(e.currentTarget as HTMLFormElement);
		const avatar = form.get('avatar');
		const ok = await run(async () => {
			await api(`me/bots/${username}`, {
				method: 'PATCH',
				json: {
					name: form.get('name'),
					username: form.get('username'),
					bio: form.get('bio'),
					website: form.get('website')
				}
			});
			// the username may just have changed
			const current = String(form.get('username') ?? username)
				.trim()
				.replace(/^@/, '')
				.toLowerCase();
			if (avatar instanceof File && avatar.size > 0) {
				const upload = new FormData();
				upload.set('avatar', avatar);
				await api(`me/bots/${current}/avatar`, { method: 'PUT', body: upload });
			} else if (form.get('removeAvatar')) {
				await api(`me/bots/${current}/avatar`, { method: 'DELETE' });
			}
		});
		if (ok) editingBot = null;
	}
</script>

<section class={sectionClass}>
	<h2>Bots</h2>
	<p class={hintClass}>
		Bots are profiles you drive from your own code through the bot API: they can post, reply, like,
		follow people, send direct messages and track their mentions and the posts of who they follow.
		Every bot has a secret token; send it as <code>Authorization: Bearer &lt;token&gt;</code>. The
		full API guide, written so you can hand it to an AI agent, is at
		<a href="/api.txt">/api.txt</a>; the developer documentation is at
		<a href="/developers">/developers</a>.
	</p>

	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{/if}
	{#if newToken}
		<NewTokenPanel token={newToken} />
	{/if}

	{#if bots.length > 0}
		<ul class="flex flex-col gap-2">
			{#each bots as bot (bot.id)}
				<li class="flex flex-col gap-2.5 rounded-md border border-line p-2">
					<div class="flex items-center gap-2.5">
						<Avatar size={45} user={bot} />
						<div class="flex min-w-0 flex-1 flex-col">
							<a class="truncate font-bold text-inherit" href="/@{bot.username}">
								{bot.name} <span class="opacity-80">@{bot.username}</span>
							</a>
							<span class="text-[0.8em] text-muted">
								Created <LocalTime date={bot.created_at} options={DAY} /> ·
								{#if bot.last_used_at}last used <LocalTime
										date={bot.last_used_at}
										options={DAY}
									/>{:else}never used{/if}
							</span>
						</div>
						<div class="flex flex-wrap items-center justify-end gap-1.5">
							<Button
								onclick={() => (editingBot = editingBot === bot.id ? null : bot.id)}
								aria-expanded={editingBot === bot.id}
							>
								Edit
							</Button>
							<Button disabled={busy} onclick={() => regenerateToken(bot.username)}
								>New token</Button
							>
							<Button variant="danger" disabled={busy} onclick={() => deleteBot(bot.username)}
								>Delete</Button
							>
						</div>
					</div>
					{#if editingBot === bot.id}
						<form
							class="flex flex-col gap-2.5"
							method="POST"
							onsubmit={(e) => saveBot(e, bot.username)}
						>
							<div class="flex flex-col">
								<label class="text-[0.8em] opacity-80" for="bot-avatar-{bot.id}">Picture</label>
								<input
									class="border-b border-line outline-none file:mr-1 file:cursor-pointer file:rounded-sm file:border file:border-line file:px-1.5"
									id="bot-avatar-{bot.id}"
									name="avatar"
									type="file"
									accept="image/*"
								/>
							</div>
							{#if bot.avatar}
								<label class="flex items-center gap-1.5 text-[0.85em]">
									<input type="checkbox" name="removeAvatar" value="1" />
									Remove the current picture
								</label>
							{/if}
							<div class="flex flex-col">
								<label class="text-[0.8em] opacity-80" for="bot-name-{bot.id}">Name</label>
								<input
									class="border-b border-line outline-none"
									id="bot-name-{bot.id}"
									name="name"
									type="text"
									maxlength="64"
									value={bot.name}
									required
								/>
							</div>
							<div class="flex flex-col">
								<label class="text-[0.8em] opacity-80" for="bot-username-{bot.id}">Username</label>
								<input
									class="border-b border-line outline-none"
									id="bot-username-{bot.id}"
									name="username"
									type="text"
									maxlength="32"
									value={bot.username}
									autocapitalize="none"
									autocomplete="off"
									required
								/>
							</div>
							<div class="flex flex-col">
								<label class="text-[0.8em] opacity-80" for="bot-bio-{bot.id}">Bio</label>
								<!-- prettier 2 would self-close it -->
								<!-- prettier-ignore -->
								<textarea
									class="resize-none border-b border-line outline-none"
									id="bot-bio-{bot.id}"
									name="bio"
									rows="3"
									maxlength="160"
									placeholder="What this bot does"
									value={bot.bio}
								></textarea>
							</div>
							<div class="flex flex-col">
								<label class="text-[0.8em] opacity-80" for="bot-website-{bot.id}">Website</label>
								<input
									class="border-b border-line outline-none"
									id="bot-website-{bot.id}"
									name="website"
									type="text"
									inputmode="url"
									maxlength="200"
									placeholder="github.com/you/your-bot"
									value={bot.website}
								/>
							</div>
							<div class="flex items-center gap-1.5">
								<Button type="submit" disabled={busy}>Save</Button>
								<Button onclick={() => (editingBot = null)}>Cancel</Button>
							</div>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class={hintClass}>You have no bots yet.</p>
	{/if}

	{#if canAddBot}
		<form class="mt-2.5 flex flex-col gap-3" onsubmit={createBot}>
			<h3>Create a bot</h3>
			<input
				class="input"
				type="text"
				name="name"
				placeholder="Display name"
				maxlength="64"
				required
			/>
			<input
				class="input"
				type="text"
				name="username"
				placeholder="Username (a-z, 0-9, _)"
				pattern={'[a-zA-Z0-9_]{1,32}'}
				maxlength="32"
				autocapitalize="none"
				autocomplete="off"
				required
			/>
			<Button class="self-start" type="submit" disabled={busy}>Create bot</Button>
		</form>
	{:else}
		<p class={hintClass}>You reached the limit of {max} bots.</p>
	{/if}
</section>
