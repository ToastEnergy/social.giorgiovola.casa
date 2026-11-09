<script lang="ts">
	import type { PageProps } from './$types';
	import Bots from '#lib/components/settings/Bots.svelte';
	import { hintClass } from '#lib/settings.js';

	let { data }: PageProps = $props();
</script>

<p class="mb-5 {hintClass}">
	Build on the <a href="/developers">API</a>. To call it as yourself from your own scripts, create a
	personal access token under <a href="/settings/security">Security</a>.
</p>
<Bots bots={data.bots} max={data.maxBots} />
