<script lang="ts">
	import { DATE_TIME, FULL, dateReady, formatDate } from '#lib/time.svelte.js';

	// a date in the reader's zone (see time.svelte.ts). on a first visit the server can't know it:
	// the text is then kept invisible (still taking its room) until the browser fills it in
	let {
		date,
		options = DATE_TIME,
		class: className = ''
	}: { date: string | Date; options?: Intl.DateTimeFormatOptions; class?: string } = $props();

	const iso = $derived(new Date(date).toISOString());
</script>

<time
	datetime={iso}
	title={formatDate(date, FULL)}
	class="{className} {dateReady() ? '' : 'invisible'}">{formatDate(date, options)}</time
>
