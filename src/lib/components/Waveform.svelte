<script lang="ts" module>
	/**
	 * The bar style shared by the player and the live recorder: rounded bars up to 2px wide, at
	 * least 2px high, spread over the width with at least 1px between them.
	 * `inverse` is for a voice note on an accent bubble (your own messages).
	 */
	export const barClass = 'min-h-0.5 max-w-0.5 min-w-px flex-1 rounded-full';
	export const barColors = {
		default: { played: 'bg-accent', rest: 'bg-muted' },
		inverse: { played: 'bg-background', rest: 'bg-background/40' }
	};
	export type WaveformTone = keyof typeof barColors;
</script>

<script lang="ts">
	type Props = {
		/** peaks 0–255 (a VoiceNote's 64) */
		bars: number[];
		/** how much has played, 0–1: those bars are coloured */
		progress?: number;
		tone?: WaveformTone;
		class?: string;
	};

	let { bars, progress = 0, tone = 'default', class: className = '' }: Props = $props();

	const colors = $derived(barColors[tone]);
</script>

<!-- the bars spread over the width; their height is a share of the box's -->
<div class="flex items-center justify-between gap-px {className}" aria-hidden="true">
	{#each bars as bar, i}
		<!-- prettier-ignore -->
		<span
			class="{barClass} {(i + 0.5) / bars.length <= progress ? colors.played : colors.rest}"
			style:height="{Math.max(8, (bar / 255) * 100)}%"
		></span>
	{/each}
</div>
