<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/Button.svelte';
	import { installState, promptInstall } from '#lib/install.svelte.js';

	// the install state only exists in the browser: render it after hydration
	let ready = $state(false);
	onMount(() => (ready = true));

	// the mobile workflows attach both files to every mobile-v* release (README "mobile app builds"),
	// and GitHub redirects /releases/latest/download/<file> to the newest one
	const repo = 'https://github.com/ToastEnergy/social.giorgiovola.casa';
	const latest = (file: string) => `${repo}/releases/latest/download/${file}`;
	// mobile-ios publishes the source on the altstore branch. altstore.io takes its url without the
	// scheme and opens AltStore with it
	const altStoreSource =
		'https://altstore.io/source/raw.githubusercontent.com/ToastEnergy/social.giorgiovola.casa/altstore/source.json';

	const guides = [
		{
			name: 'iPhone and iPad (Safari)',
			steps: ['Tap the share button', 'Choose "Add to Home Screen"', 'Tap "Add"']
		},
		{
			name: 'Android (Chrome, Edge, Firefox)',
			steps: [
				'Open the browser menu (⋮)',
				'Choose "Install app" or "Add to Home screen"',
				'Confirm'
			]
		},
		{
			name: 'Desktop (Chrome, Edge, Brave)',
			steps: [
				'Click the install icon at the right end of the address bar, or open the browser menu',
				'Choose "Install Social Giorgiovola Casa"',
				'Confirm'
			]
		}
	];
</script>

<h1>Install app</h1>
<p class="mt-2.5 text-muted">
	Install the app on this device for its own window or home screen icon, an unread badge and push
	notifications.
</p>

{#if ready}
	<div class="mt-5 flex items-center justify-between gap-2.5 rounded-[10px] bg-black/70 p-2.5">
		{#if installState.standalone}
			<p>The app is already installed on this device.</p>
		{:else if installState.event}
			<p>Ready to install.</p>
			<Button variant="primary" onclick={promptInstall}>Install</Button>
		{:else}
			<p>
				{installState.ios
					? 'Safari has no install button: follow the steps for iPhone and iPad below.'
					: "This browser didn't offer a one click install, follow the steps below."}
			</p>
		{/if}
	</div>
{/if}

<div class="mt-5 flex flex-col gap-2.5">
	{#each guides as guide (guide.name)}
		<section class="rounded-[10px] bg-black/70 p-2.5">
			<h2 class="mb-[5px] font-bold">{guide.name}</h2>
			<ol class="flex list-decimal flex-col gap-[5px] pl-5">
				{#each guide.steps as step (step)}
					<li>{step}</li>
				{/each}
			</ol>
		</section>
	{/each}
</div>
<p class="mt-2.5 text-[0.85em] text-muted">
	Desktop Firefox can't install web apps. Once installed, turn on push notifications in
	<a href="/settings/notifications">Settings → Notifications</a>.
</p>

<section class="mt-10 flex flex-col gap-2.5">
	<h2 class="font-bold">Mobile app</h2>
	<p class="text-muted">
		There is also a native app for phones, outside the app stores. Get it from the latest release:
	</p>
	<div class="flex flex-wrap gap-2.5">
		<Button href={latest('SocialGiorgiovolaCasa.apk')} rel="external">Android (.apk)</Button>
		<Button href={altStoreSource} rel="external">Add to AltStore (iPhone)</Button>
		<Button href={latest('SocialGiorgiovolaCasa.ipa')} rel="external">iPhone (.ipa)</Button>
	</div>
	<ul class="flex list-disc flex-col gap-[5px] pl-5 text-[0.85em] text-muted">
		<li>
			Android: open the downloaded file and allow installs from your browser when asked. The app
			then updates itself.
		</li>
		<li>
			iPhone: install <a href="https://altstore.io" rel="external">AltStore</a>, add the source and
			install the app from it to get updates there. AltStore signs it with your Apple ID, and can
			also open the .ipa by itself.
		</li>
		<li>
			<a href={`${repo}/releases`} rel="external">All releases</a>
		</li>
	</ul>
</section>
