<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import { onMount } from 'svelte';
	import { disablePush, enablePush, getPushState, PushError, type PushState } from '#lib/push.js';
	import { hintClass } from '#lib/settings.js';

	// web push for this browser: the subscription lives in the browser, so the state is only known
	// once mounted
	let push: PushState | null = $state(null);
	let busy = $state(false);
	let error: 'unavailable' | 'failed' | null = $state(null);

	onMount(() => {
		getPushState().then((state) => (push = state));
	});

	async function toggle() {
		busy = true;
		error = null;
		try {
			push = push === 'on' ? await disablePush() : await enablePush();
		} catch (e) {
			console.error(e);
			error = e instanceof PushError && e.reason === 'unavailable' ? 'unavailable' : 'failed';
		}
		busy = false;
	}
</script>

{#if push === 'on' || push === 'off'}
	<div class="flex items-center justify-between gap-2.5 rounded-[10px] bg-black/70 p-2.5">
		<p>
			{push === 'on'
				? 'Push notifications are on for this browser.'
				: 'Get a notification on this device when someone likes, regiorgios, quotes, replies, mentions, follows or messages you.'}
		</p>
		<Button disabled={busy} onclick={toggle}>{push === 'on' ? 'Turn off' : 'Turn on'}</Button>
	</div>
	{#if error === 'unavailable'}
		<p class={hintClass}>
			This browser has no push service, so it can't receive push notifications. Browsers without
			Google services (like Helium or ungoogled-chromium) don't support them; in Brave, turn on "Use
			Google services for push messaging". Chrome, Edge, Firefox and Safari work.
		</p>
	{:else if error === 'failed'}
		<p class={hintClass}>Something went wrong, try again.</p>
	{/if}
{:else if push === 'denied'}
	<p class={hintClass}>
		Notifications are blocked for this site: allow them in your browser settings to turn them on.
	</p>
{:else if push === 'unsupported'}
	<p class={hintClass}>This browser doesn't support push notifications.</p>
{/if}
