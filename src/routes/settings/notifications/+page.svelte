<script lang="ts">
	import PushToggle from '#lib/components/settings/PushToggle.svelte';
	import Button from '#lib/components/Button.svelte';
	import type { PageProps } from './$types';
	import { hintClass, sectionClass } from '#lib/settings.js';

	let { data }: PageProps = $props();
</script>

<section class={sectionClass}>
	<h2>Notifications from</h2>
	<p class={hintClass}>
		Which notifications the notifications page and the unread badge cover. With all your profiles,
		the page can still be filtered by profile.
	</p>
	<div class="flex gap-2.5">
		<!-- the choice is remembered in a cookie by the layout's load (?inbox=) -->
		<Button
			href="?inbox=all"
			variant={data.inboxAll ? 'primary' : 'default'}
			data-sveltekit-replacestate
			data-sveltekit-noscroll
			aria-current={data.inboxAll ? 'page' : undefined}>All my profiles</Button
		>
		<Button
			href="?inbox=own"
			variant={data.inboxAll ? 'default' : 'primary'}
			data-sveltekit-replacestate
			data-sveltekit-noscroll
			aria-current={data.inboxAll ? undefined : 'page'}>Only the profile in use</Button
		>
	</div>
</section>

<section class={sectionClass}>
	<h2>Push notifications</h2>
	<p class={hintClass}>
		Push notifications are set per browser: turn them on on every device where you want them. On
		iPhone and iPad, <a href="/install">install the app</a> first.
	</p>
	<PushToggle />
</section>
