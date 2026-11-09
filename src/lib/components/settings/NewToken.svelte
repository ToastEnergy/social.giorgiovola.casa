<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import { page } from '$app/state';
	import { hintClass, type NewToken } from '#lib/settings.js';

	// a token just created: only this response carries it, so it is shown once with a way to copy it
	let { token }: { token: NewToken } = $props();

	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(token.token);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<div class="flex flex-col gap-2.5 rounded-[10px] bg-black/70 p-2.5">
	<p>
		Token for <b>{token.label}</b>. Copy it now: you won't be able to see it again.
	</p>
	<code class="break-all select-all">{token.token}</code>
	<div class="flex items-center gap-2.5">
		<Button size="sm" onclick={copy}>{copied ? 'Copied' : 'Copy token'}</Button>
	</div>
	<p class={hintClass}>
		Try it: <code class="break-all"
			>curl -H "Authorization: Bearer {token.token}" {page.url.origin}{token.bot
				? '/api/bot/me'
				: '/api/v1/me'}</code
		>
	</p>
</div>
