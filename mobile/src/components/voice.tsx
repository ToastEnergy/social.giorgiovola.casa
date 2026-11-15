import * as Haptics from 'expo-haptics';
import { router, useSegments } from 'expo-router';
import { Mic, Pause, Play, RotateCcw, RotateCw, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Pressable,
	View,
	type AccessibilityActionEvent,
	type StyleProp,
	type ViewStyle
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
	type SharedValue
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { duration } from '@/lib/format';
import { colors, TAB_BAR_HEIGHT } from '@/lib/theme';
import type { VoiceNote } from '@/lib/types';
import {
	nextRate,
	pause,
	play,
	positionOf,
	resume,
	seek,
	setRate,
	skip,
	stop,
	toggle,
	useVoice,
	type Track
} from '@/lib/voicePlayer';
import { Avatar, IconButton, Txt } from './ui';

export const BAR = 2;
export const GAP = 1.5;
/** notes longer than this get ±15 s buttons */
const LONG_MS = 2 * 60 * 1000;
/** the screen reader's adjustable steps */
const STEP_S = 5;

/** `peaks` (0–255) squeezed into `count` bars, keeping each group's loudest. */
function resample(peaks: number[], count: number) {
	if (count <= 0 || !peaks.length) return [];
	if (peaks.length <= count) return peaks;
	const out: number[] = [];
	for (let i = 0; i < count; i++) {
		const from = Math.floor((i * peaks.length) / count);
		const to = Math.max(from + 1, Math.floor(((i + 1) * peaks.length) / count));
		let max = 0;
		for (let j = from; j < to; j++) max = Math.max(max, peaks[j]);
		out.push(max);
	}
	return out;
}

/**
 * The bars of a voice note, as wide as their parent: `muted`, the part up to `progress` (0 to 1)
 * `accent`. Takes any number of peaks (0–255), so the recorder can draw a growing one too.
 */
export function Waveform({
	peaks,
	progress,
	height = 28
}: {
	peaks: number[];
	progress?: SharedValue<number>;
	height?: number;
}) {
	const [width, setWidth] = useState(0);
	const bars = useMemo(
		() => resample(peaks, Math.floor((width + GAP) / (BAR + GAP))),
		[peaks, width]
	);
	const clip = useAnimatedStyle(() => ({
		width: Math.max(0, Math.min(1, progress?.value ?? 0)) * width
	}));
	const row = (color: string) => (
		<View style={{ width, height, flexDirection: 'row', alignItems: 'center', gap: GAP }}>
			{bars.map((peak, i) => (
				<View
					key={i}
					style={{
						width: BAR,
						height: Math.max(BAR, (peak / 255) * height),
						borderRadius: 1,
						backgroundColor: color
					}}
				/>
			))}
		</View>
	);
	return (
		<View
			pointerEvents="none"
			style={{ height, alignSelf: 'stretch' }}
			onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
		>
			{width ? row(colors.muted) : null}
			{width && progress ? (
				<Animated.View
					style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' }, clip]}
				>
					{row(colors.accent)}
				</Animated.View>
			) : null}
		</View>
	);
}

const tick = () => {
	Haptics.selectionAsync().catch(() => {});
};

type PlayerProps = {
	note: VoiceNote;
	/** who and where, for the lock screen and the now playing bar */
	track: Omit<Track, 'note'>;
	/** smaller, for quotes */
	compact?: boolean;
	/** the recipient hasn't played it yet (a dot) */
	unplayed?: boolean;
	/** the sender's view of a direct message: whether the recipient played it */
	played?: boolean;
	/** a chat bubble's long press (its menu), which the player would otherwise take */
	onLongPress?: () => void;
};

/**
 * A voice note: play / pause, the waveform to tap or drag through, the time, the speed (1×, 1.5×,
 * 2×, remembered) and ±15 s on long notes. Plays in the app's one player (src/lib/voicePlayer.tsx).
 * Taps on it never reach what holds it (a post in a list stays closed).
 */
export function VoiceNotePlayer({
	note,
	track,
	compact,
	unplayed,
	played,
	onLongPress
}: PlayerProps) {
	const url = note.url;
	const total = note.duration_ms / 1000;
	const active = useVoice((s) => s.track?.note.url === url);
	const playing = useVoice((s) => s.track?.note.url === url && s.playing);
	const loading = useVoice((s) => s.track?.note.url === url && s.loading);
	const position = useVoice((s) => positionOf(s, url));
	const rate = useVoice((s) => s.rate);
	const failed = useVoice((s) => (s.track?.note.url === url ? s.error : null));

	const full: Track = { ...track, note };
	const fullRef = useRef(full);
	fullRef.current = full;

	// where the bars are filled to: follows the player, or the finger while scrubbing
	const progress = useSharedValue(total ? position / total : 0);
	const scrubbing = useSharedValue(false);
	const width = useSharedValue(0);
	const [scrub, setScrub] = useState<number | null>(null);
	useEffect(() => {
		if (scrubbing.value || !total) return;
		// between two updates (every 250 ms) it glides to where the player will be
		progress.value = playing
			? withTiming(Math.min(1, (position + 0.25 * rate) / total), {
					duration: 250,
					easing: Easing.linear
			  })
			: withTiming(position / total, { duration: 120 });
	}, [position, playing, rate, total, progress, scrubbing]);

	const commit = useCallback((share: number) => {
		const t = fullRef.current;
		seek(t.note, share * (t.note.duration_ms / 1000));
	}, []);
	const pan = usePanGesture({
		// sideways drags scrub, anything vertical is the list scrolling
		activeOffsetX: [-8, 8],
		failOffsetY: [-10, 10],
		onActivate: (e) => {
			'worklet';
			scrubbing.value = true;
			progress.value = width.value ? Math.max(0, Math.min(1, e.x / width.value)) : 0;
			scheduleOnRN(setScrub, progress.value);
		},
		onUpdate: (e) => {
			'worklet';
			progress.value = width.value ? Math.max(0, Math.min(1, e.x / width.value)) : 0;
			scheduleOnRN(setScrub, progress.value);
		},
		onDeactivate: (e) => {
			'worklet';
			if (!e.canceled) scheduleOnRN(commit, progress.value);
		},
		onFinalize: () => {
			'worklet';
			scrubbing.value = false;
			scheduleOnRN(setScrub, null);
		}
	});

	const onPlay = () => {
		if (!playing && !loading) tick();
		toggle(full);
	};
	const shown = scrub !== null ? scrub * total : position;
	const fresh = !active && position === 0;
	const onAction = (e: AccessibilityActionEvent) => {
		const step = e.nativeEvent.actionName === 'increment' ? STEP_S : -STEP_S;
		if (e.nativeEvent.actionName === 'activate') onPlay();
		else skip(note, step);
	};
	const size = compact ? 30 : 36;

	return (
		// not a button itself: it only keeps stray taps from opening the post around it
		<Pressable
			accessible={false}
			onPress={() => {}}
			onLongPress={onLongPress}
			delayLongPress={450}
			style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200 }}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={playing || loading ? 'Pause voice note' : 'Play voice note'}
				hitSlop={6}
				onPress={onPlay}
				style={({ pressed }) => ({
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: colors.accent,
					alignItems: 'center',
					justifyContent: 'center',
					opacity: pressed ? 0.7 : 1
				})}
			>
				{loading ? (
					<ActivityIndicator size="small" color={colors.background} />
				) : playing ? (
					<Pause size={size * 0.45} color={colors.background} fill={colors.background} />
				) : (
					<Play
						size={size * 0.45}
						color={colors.background}
						fill={colors.background}
						style={{ marginLeft: 2 }}
					/>
				)}
			</Pressable>
			<View style={{ flex: 1, gap: 3 }}>
				<GestureDetector gesture={pan}>
					<Pressable
						accessible
						accessibilityRole="adjustable"
						accessibilityLabel={`Voice note, ${duration(total)}`}
						accessibilityValue={{ text: `${duration(shown)} of ${duration(total)}` }}
						accessibilityActions={[
							{ name: 'increment' },
							{ name: 'decrement' },
							{ name: 'activate' }
						]}
						onAccessibilityAction={onAction}
						onLayout={(e) => (width.value = e.nativeEvent.layout.width)}
						// a tap moves there; on a note that isn't playing it also starts it
						onPress={(e) => {
							if (!width.value) return;
							const share = Math.max(0, Math.min(1, e.nativeEvent.locationX / width.value));
							if (active) seek(note, share * total);
							else {
								tick();
								play(full, share * total);
							}
						}}
						style={{ paddingVertical: 4 }}
					>
						<Waveform peaks={note.waveform} progress={progress} height={compact ? 20 : 26} />
					</Pressable>
				</GestureDetector>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 }}>
					<Txt size={12} muted style={{ fontVariant: ['tabular-nums'] }}>
						{fresh ? duration(total) : `${duration(shown)} / ${duration(total)}`}
					</Txt>
					{unplayed ? (
						<View
							accessibilityLabel="Not played yet"
							style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent }}
						/>
					) : null}
					{played !== undefined ? (
						<Mic
							size={13}
							color={played ? colors.accent : colors.muted}
							accessibilityLabel={played ? 'Played' : 'Not played yet'}
						/>
					) : null}
					{failed ? (
						<Txt size={12} style={{ color: colors.danger }} numberOfLines={1}>
							Couldn’t play
						</Txt>
					) : null}
					<View style={{ flex: 1 }} />
					{active && !compact && note.duration_ms > LONG_MS ? (
						<>
							<IconButton label="Back 15 seconds" onPress={() => skip(note, -15)}>
								<RotateCcw size={15} color={colors.foreground} />
							</IconButton>
							<IconButton label="Forward 15 seconds" onPress={() => skip(note, 15)}>
								<RotateCw size={15} color={colors.foreground} />
							</IconButton>
						</>
					) : null}
					{active ? <SpeedChip /> : null}
				</View>
			</View>
		</Pressable>
	);
}

function SpeedChip() {
	const rate = useVoice((s) => s.rate);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Playback speed ${rate}×`}
			accessibilityHint="Changes the speed"
			hitSlop={6}
			onPress={() => setRate(nextRate(rate))}
			style={({ pressed }) => ({
				borderWidth: 1,
				borderColor: colors.accent,
				borderRadius: 10,
				paddingHorizontal: 6,
				minWidth: 36,
				alignItems: 'center',
				opacity: pressed ? 0.6 : 1
			})}
		>
			<Txt size={12} bold accent>
				{rate}×
			</Txt>
		</Pressable>
	);
}

/**
 * The note playing, while you are elsewhere: who, how far, pause and close. Tapping it opens the
 * post or chat it is in. Hidden on that chat itself (`hideHref`).
 */
export function NowPlayingBar({
	hideHref,
	style
}: {
	hideHref?: string;
	style?: StyleProp<ViewStyle>;
}) {
	const track = useVoice((s) => s.track);
	const playing = useVoice((s) => s.playing);
	const loading = useVoice((s) => s.loading);
	const position = useVoice((s) => Math.floor(s.position));
	if (!track || (hideHref && track.href === hideHref)) return null;
	const total = track.note.duration_ms / 1000;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`Now playing: voice note from ${track.title}`}
			accessibilityHint={track.href ? 'Opens where it was sent' : undefined}
			onPress={() => track.href && router.push(track.href as never)}
			style={[
				{
					flexDirection: 'row',
					alignItems: 'center',
					gap: 10,
					paddingVertical: 6,
					paddingHorizontal: 10,
					borderRadius: 5,
					borderWidth: 1,
					borderColor: colors.accent,
					backgroundColor: colors.background,
					overflow: 'hidden'
				},
				style
			]}
		>
			{track.user ? (
				<Avatar user={track.user} size={28} />
			) : (
				<Mic size={20} color={colors.accent} />
			)}
			<View style={{ flex: 1 }}>
				<Txt size={14} bold numberOfLines={1}>
					{track.title}
				</Txt>
				<Txt size={12} muted numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
					{track.subtitle ? `${track.subtitle} · ` : ''}
					{duration(position)} / {duration(total)}
				</Txt>
			</View>
			<IconButton
				label={playing || loading ? 'Pause' : 'Play'}
				onPress={() => (playing || loading ? pause() : resume())}
			>
				{loading ? (
					<ActivityIndicator size="small" color={colors.accent} />
				) : playing ? (
					<Pause size={20} color={colors.foreground} fill={colors.foreground} />
				) : (
					<Play size={20} color={colors.foreground} fill={colors.foreground} />
				)}
			</IconButton>
			<IconButton label="Stop" onPress={stop}>
				<X size={20} color={colors.muted} />
			</IconButton>
			<View
				pointerEvents="none"
				style={{
					position: 'absolute',
					left: 0,
					bottom: 0,
					height: 2,
					width: `${total ? Math.min(100, (position / total) * 100) : 0}%`,
					backgroundColor: colors.accent
				}}
			/>
		</Pressable>
	);
}

/** screens with their own bar (the chats) or where it would be in the way */
const HIDDEN = new Set(['compose', 'share', 'report', 'menu', 'login', 'register', 'admin']);

/**
 * The now playing bar floating over the screens, above the tab bar: mounted once in the root
 * layout. Chats show it themselves, under their header, so it never covers what you type.
 */
export function NowPlayingOverlay() {
	const segments = useSegments() as string[];
	const insets = useSafeAreaInsets();
	const route = segments.filter((s) => s !== 'index').join('/');
	if (HIDDEN.has(segments[0] ?? '') || route === 'chat/[username]' || route === 'group/[id]')
		return null;
	const tabs = segments[0] === '(tabs)';
	return (
		<View
			pointerEvents="box-none"
			style={{
				position: 'absolute',
				left: 10,
				right: 10,
				bottom: (tabs ? TAB_BAR_HEIGHT : 0) + insets.bottom + 8
			}}
		>
			<NowPlayingBar />
		</View>
	);
}
