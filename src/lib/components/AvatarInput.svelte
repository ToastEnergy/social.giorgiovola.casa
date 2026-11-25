<script lang="ts">
	import Button from './Button.svelte';
	import type { User } from '#lib/types.js';
	import { getAvatar } from '#lib/utils.js';
	import { canCrop, cropAvatar } from '#lib/avatarCropper.svelte.js';

	type Props = {
		/** the profile whose picture this is; its current avatar shows until a new one is picked */
		user: Pick<User, 'username' | 'name' | 'avatar'>;
		id: string;
		label?: string;
		/** the picked (and cropped) picture, to upload on save */
		file?: File | null;
		/** the current picture is to be removed on save */
		remove?: boolean;
		disabled?: boolean;
	};

	let {
		user,
		id,
		label = 'Avatar',
		file = $bindable(null),
		remove = $bindable(false),
		disabled = false
	}: Props = $props();

	const MAX_BYTES = 10 * 1024 * 1024;
	const SIZE = 60;

	let input: HTMLInputElement | undefined = $state();
	let error = $state('');
	let preview: string | null = $state(null);

	$effect(() => {
		if (!file) {
			preview = null;
			return;
		}
		const url = URL.createObjectURL(file);
		preview = url;
		return () => URL.revokeObjectURL(url);
	});

	const src = $derived(
		preview ?? getAvatar({ ...user, avatar: remove ? null : user.avatar }, SIZE)
	);
	const hasPicture = $derived(!!file || (!!user.avatar && !remove));

	async function picked() {
		const picked = input?.files?.[0];
		// the same file can be picked again after a cancel
		if (input) input.value = '';
		if (!picked) return;
		error = '';
		// GIFs keep their animation: the server crops them square itself
		const out = canCrop(picked) ? await cropAvatar(picked) : picked;
		if (!out) return;
		if (out.size > MAX_BYTES) {
			error = 'Avatar too big, max size is 10mb';
			return;
		}
		file = out;
		remove = false;
	}

	function clear() {
		file = null;
		remove = !!user.avatar;
	}
</script>

<div class="flex flex-col gap-1.5">
	<label class="text-[0.8em] opacity-80" for={id}>{label}</label>
	{#if error}
		<p class="rounded-[5px] bg-danger p-[5px]">{error}</p>
	{/if}
	<div class="flex items-center gap-2.5">
		<img
			class="aspect-square max-w-none rounded-full object-cover"
			{src}
			alt=""
			width={SIZE}
			height={SIZE}
		/>
		<Button size="sm" {disabled} onclick={() => input?.click()}>
			{hasPicture ? 'Change picture' : 'Choose picture'}
		</Button>
		{#if hasPicture}
			<Button size="sm" variant="danger" {disabled} onclick={clear}>Remove</Button>
		{/if}
		<input bind:this={input} class="hidden" {id} type="file" accept="image/*" onchange={picked} />
	</div>
</div>
