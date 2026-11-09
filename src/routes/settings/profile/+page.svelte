<script lang="ts">
	import Avatar from '#lib/components/Avatar.svelte';
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { userOf, type Me } from '#lib/me.js';
	import { user } from '#lib/store.js';
	import {
		fieldClass,
		fileInputClass,
		hintClass,
		inputClass,
		labelClass,
		sectionClass
	} from '#lib/settings.js';

	let { data }: PageProps = $props();

	const profile = $derived(data.profile);

	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);

	// the profile in use: an identity is edited the same way as the account
	async function save(e: SubmitEvent) {
		e.preventDefault();
		const fields = new FormData(e.currentTarget as HTMLFormElement);
		const avatar = fields.get('avatar');
		if (avatar instanceof File && avatar.size > 10 * 1024 * 1024) {
			error = 'Avatar too big, max size is 10mb';
			return;
		}
		busy = true;
		error = '';
		saved = false;
		try {
			if (avatar instanceof File && avatar.size > 0) {
				const upload = new FormData();
				upload.set('avatar', avatar);
				await api('me/avatar', { method: 'PUT', body: upload });
			} else if (fields.get('removeAvatar')) {
				await api('me/avatar', { method: 'DELETE' });
			}
			const me = await api<Me>('me', {
				method: 'PATCH',
				json: {
					name: fields.get('name'),
					username: fields.get('username'),
					bio: fields.get('bio'),
					website: fields.get('website')
				}
			});
			// the header and menus read the store, which the layout only fills on the first load
			user.set(userOf(me));
			await invalidateAll();
			saved = true;
		} catch (err) {
			error = messageOf(err, 'Could not save your profile');
		} finally {
			busy = false;
		}
	}
</script>

<section class={sectionClass}>
	<div class="flex items-center gap-2.5">
		<Avatar size={60} user={profile} />
		<div class="flex min-w-0 flex-1 flex-col">
			<h2 class="truncate">{profile.name}</h2>
			<a class="truncate text-[0.9em] text-inherit opacity-80" href="/@{profile.username}"
				>@{profile.username}</a
			>
		</div>
		<Button size="sm" href="/@{profile.username}">View profile</Button>
	</div>
	<p class={hintClass}>
		{#if profile.identity}
			You are editing the identity <b>@{profile.username}</b>. Switch profile from the avatar menu
			to edit another one.
		{:else}
			What everyone sees on your profile. Your email and password are under
			<a href="/settings/security">Security</a>.
		{/if}
	</p>

	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{/if}

	<!-- keyed by the profile, so switching profile or saving refills the fields -->
	{#key profile}
		<form class="flex flex-col gap-3" onsubmit={save}>
			<div class={fieldClass}>
				<label class={labelClass} for="avatar">Avatar</label>
				<input class={fileInputClass} id="avatar" name="avatar" type="file" accept="image/*" />
			</div>
			{#if profile.avatar}
				<label class="flex items-center gap-1.5 text-[0.85em]">
					<input type="checkbox" name="removeAvatar" value="1" />
					Remove the current picture
				</label>
			{/if}
			<div class={fieldClass}>
				<label class={labelClass} for="name">Name</label>
				<input
					class={inputClass}
					id="name"
					name="name"
					type="text"
					maxlength="64"
					value={profile.name}
					required
				/>
			</div>
			<div class={fieldClass}>
				<label class={labelClass} for="username">Username</label>
				<input
					class={inputClass}
					id="username"
					name="username"
					type="text"
					maxlength="32"
					value={profile.username}
					autocapitalize="none"
					autocomplete="off"
					required
				/>
			</div>
			<div class={fieldClass}>
				<label class={labelClass} for="bio">Bio</label>
				<!-- same limit as LIMITS.bio, enforced on the server; prettier 2 would self-close it -->
				<!-- prettier-ignore -->
				<textarea
					class="resize-none {inputClass}"
					id="bio"
					name="bio"
					rows="3"
					maxlength="160"
					placeholder="A few words about you"
					value={profile.bio}
				></textarea>
			</div>
			<div class={fieldClass}>
				<label class={labelClass} for="website">Website</label>
				<input
					class={inputClass}
					id="website"
					name="website"
					type="text"
					inputmode="url"
					maxlength="200"
					placeholder="giorgiovola.casa"
					value={profile.website}
				/>
			</div>
			<div class="flex items-center gap-2.5">
				<Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
				{#if saved}<span class="text-[0.85em] text-muted">Saved</span>{/if}
			</div>
		</form>
	{/key}
</section>
