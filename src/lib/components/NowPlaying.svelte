<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import Avatar from './Avatar.svelte';
	import { clock, pillVisible, player, stop, toggle } from '#lib/audioPlayer.svelte.js';
	import { formatDuration } from '#lib/mediaPreview.js';

	// the voice note playing while its player is out of view (another page, scrolled away): who
	// sent it, where it is, pause and close. `rail`: inside the rail (mouse devices with room for
	// it), else floating over the bottom of the content
	let { rail = false, class: className = '' }: { rail?: boolean; class?: string } = $props();

	const track = $derived(player.track);
	const iconClass =
		'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[5px] outline-none hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent';
</script>

{#if track && pillVisible()}
	<div
		class="flex items-center gap-2.5 rounded-[5px] border border-accent bg-background py-[5px] pr-[5px] pl-2.5 text-[0.9em] {rail
			? 'w-full'
			: 'w-[min(360px,calc(100vw-40px))]'} {className}"
		role="region"
		aria-label="Now playing"
	>
		<Avatar user={track.sender} size={24} clickable={false} />
		<div class="flex min-w-0 flex-1 flex-col leading-tight">
			{#if track.href}
				<a class="truncate font-bold text-inherit" href={track.href}>{track.sender.name}</a>
			{:else}
				<span class="truncate font-bold">{track.sender.name}</span>
			{/if}
			<span class="text-[0.85em] text-muted tabular-nums"
				>{clock(player.time)} / {formatDuration(track.note.duration_ms)}</span
			>
		</div>
		<button
			type="button"
			class={iconClass}
			aria-label={player.playing ? 'Pause' : 'Play'}
			title={player.playing ? 'Pause' : 'Play'}
			onclick={() => toggle(track)}
		>
			{#if player.loading}
				<LoaderCircle size={18} class="animate-spin" />
			{:else if player.playing}
				<Pause size={18} class="fill-current" />
			{:else}
				<Play size={18} class="fill-current" />
			{/if}
		</button>
		<button type="button" class={iconClass} aria-label="Close" title="Close" onclick={stop}
			><X size={18} /></button
		>
	</div>
{/if}
