<script lang="ts">
	import PushToggle from '#lib/components/settings/PushToggle.svelte';
	import { hintClass, sectionClass } from '#lib/settings.js';
</script>

<section class={sectionClass}>
	<h2>Push notifications</h2>
	<p class={hintClass}>
		Push notifications are set per browser: turn them on on every device where you want them. On
		iPhone and iPad, <a href="/install">install the app</a> first.
	</p>
	<PushToggle />
</section>
