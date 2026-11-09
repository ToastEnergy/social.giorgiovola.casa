<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import { invalidateAll } from '$app/navigation';
	import { api, messageOf } from '#lib/api.js';
	import { fieldClass, hintClass, inputClass, labelClass, sectionClass } from '#lib/settings.js';

	// the account's email and password. identities have neither: the email form only shows while
	// the account itself is in use (PATCH /me edits the profile in use), the password is the account's
	let { account, email, identity }: { account: string; email: string | null; identity: boolean } =
		$props();

	let busy = $state(false);
	let error = $state('');
	let done = $state('');

	async function run(e: SubmitEvent, message: string, action: (f: FormData) => Promise<unknown>) {
		e.preventDefault();
		const form = e.currentTarget as HTMLFormElement;
		busy = true;
		error = '';
		done = '';
		try {
			await action(new FormData(form));
			// the email field keeps what was saved
			form
				.querySelectorAll<HTMLInputElement>('input[type="password"]')
				.forEach((input) => (input.value = ''));
			done = message;
			await invalidateAll();
		} catch (err) {
			error = messageOf(err, 'Something went wrong, try again.');
		} finally {
			busy = false;
		}
	}

	const changeEmail = (e: SubmitEvent) =>
		run(e, 'Email changed.', (f) =>
			api('me', {
				method: 'PATCH',
				json: { email: f.get('email'), current_password: f.get('currentPassword') }
			})
		);

	const changePassword = (e: SubmitEvent) =>
		run(e, 'Password changed. Every other session was signed out.', async (f) => {
			if (f.get('password') !== f.get('confirmPassword')) throw new Error('Passwords do not match');
			await api('me/password', {
				method: 'PUT',
				json: { current_password: f.get('currentPassword'), password: f.get('password') }
			});
		});
</script>

<section class={sectionClass}>
	<h2>Email and password</h2>
	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{:else if done}
		<p class={hintClass}>{done}</p>
	{/if}

	{#if identity}
		<p class={hintClass}>
			Identities have no email. Switch to <b>@{account}</b> to change the email of your account.
		</p>
	{:else}
		<form class="flex flex-col gap-3" onsubmit={changeEmail}>
			<h3>Email</h3>
			<div class={fieldClass}>
				<label class={labelClass} for="email">Email</label>
				<input
					class={inputClass}
					id="email"
					name="email"
					type="email"
					maxlength="254"
					value={email ?? ''}
					autocomplete="email"
					required
				/>
			</div>
			<div class={fieldClass}>
				<label class={labelClass} for="email-password">Current password</label>
				<input
					class={inputClass}
					id="email-password"
					name="currentPassword"
					type="password"
					autocomplete="current-password"
					required
				/>
			</div>
			<Button class="self-start" type="submit" disabled={busy}>Change email</Button>
		</form>
	{/if}

	<form class="mt-2.5 flex flex-col gap-3" onsubmit={changePassword}>
		<h3>Password of @{account}</h3>
		<p class={hintClass}>Changing it signs out every other browser, app and token.</p>
		<div class={fieldClass}>
			<label class={labelClass} for="current-password">Current password</label>
			<input
				class={inputClass}
				id="current-password"
				name="currentPassword"
				type="password"
				autocomplete="current-password"
				required
			/>
		</div>
		<div class={fieldClass}>
			<label class={labelClass} for="new-password">New password</label>
			<input
				class={inputClass}
				id="new-password"
				name="password"
				type="password"
				minlength="8"
				maxlength="256"
				autocomplete="new-password"
				required
			/>
		</div>
		<div class={fieldClass}>
			<label class={labelClass} for="confirm-password">Confirm new password</label>
			<input
				class={inputClass}
				id="confirm-password"
				name="confirmPassword"
				type="password"
				minlength="8"
				maxlength="256"
				autocomplete="new-password"
				required
			/>
		</div>
		<Button class="self-start" type="submit" disabled={busy}>Change password</Button>
	</form>
</section>
