import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
	ChevronLeft,
	ChevronUp,
	Lock,
	Mic,
	MicOff,
	Pause,
	Play,
	SendHorizontal,
	Square,
	Trash2,
	X
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View, type LayoutChangeEvent } from 'react-native';
import {
	GestureDetector,
	useLongPressGesture,
	usePanGesture,
	useSimultaneousGestures
} from 'react-native-gesture-handler';
import Animated, {
	cancelAnimation,
	Easing,
	FadeIn,
	FadeOut,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withSequence,
	withSpring,
	withTiming,
	ZoomIn,
	type SharedValue
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { playbackMode } from '@/lib/audioSession';
import { duration } from '@/lib/format';
import { LIVE_BARS, type VoiceRecorder } from '@/lib/recorder';
import { colors } from '@/lib/theme';
import { pause as pauseGlobal } from '@/lib/voicePlayer';
import type { LocalVoice, UploadState } from '@/lib/voiceUpload';
import { IconButton, Txt } from './ui';
import { UploadProgress } from './UploadProgress';
import { BAR, GAP, Waveform } from './voice';

/** the mic / send button of the chat input */
export const MIC_SIZE = 44;
/** sliding left past this share of the input row cancels */
const CANCEL_SHARE = 0.4;
/** sliding up this far locks */
const LOCK_DISTANCE = 90;

function LiveBar({
	index,
	levels,
	height
}: {
	index: number;
	levels: SharedValue<number[]>;
	height: number;
}) {
	const style = useAnimatedStyle(() => ({
		height: Math.max(BAR, (levels.value[index] ?? 0) * height)
	}));
	return (
		<Animated.View
			style={[{ width: BAR, borderRadius: 1, backgroundColor: colors.accent }, style]}
		/>
	);
}

/**
 * The levels being recorded, newest on the right, scrolling left on the UI thread between two
 * samples. The same bars as the player, so the review looks like the note that's sent.
 */
export function LiveWaveform({
	levels,
	scroll,
	height = 26
}: {
	levels: SharedValue<number[]>;
	scroll: SharedValue<number>;
	height?: number;
}) {
	const row = useAnimatedStyle(() => ({ transform: [{ translateX: scroll.value * (BAR + GAP) }] }));
	return (
		<View
			pointerEvents="none"
			importantForAccessibility="no-hide-descendants"
			style={{
				flex: 1,
				height,
				overflow: 'hidden',
				flexDirection: 'row',
				justifyContent: 'flex-end'
			}}
		>
			<Animated.View
				style={[{ flexDirection: 'row', alignItems: 'center', gap: GAP, height }, row]}
			>
				{Array.from({ length: LIVE_BARS }, (_, i) => (
					<LiveBar key={i} index={i} levels={levels} height={height} />
				))}
			</Animated.View>
		</View>
	);
}

/** the red dot: pulses by opacity while recording (no glow), still when paused */
function RecDot({ live }: { live: boolean }) {
	const opacity = useSharedValue(1);
	useEffect(() => {
		if (live)
			opacity.value = withRepeat(
				withSequence(
					withTiming(0.2, { duration: 550, easing: Easing.inOut(Easing.quad) }),
					withTiming(1, { duration: 550, easing: Easing.inOut(Easing.quad) })
				),
				-1
			);
		else {
			cancelAnimation(opacity);
			opacity.value = withTiming(1, { duration: 150 });
		}
		return () => cancelAnimation(opacity);
	}, [live, opacity]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
	return (
		<Animated.View
			style={[
				{
					width: 10,
					height: 10,
					borderRadius: 5,
					backgroundColor: live ? colors.danger : colors.muted
				},
				style
			]}
		/>
	);
}

/** m:ss recorded, and in the last minute how much is left */
function RecTimer({ rec }: { rec: VoiceRecorder }) {
	const { seconds, started, phase } = rec.state;
	const left = Math.ceil(rec.maxMs / 1000) - seconds;
	return (
		<View
			accessible
			accessibilityLabel={`${phase === 'paused' ? 'Paused' : 'Recording'}, ${duration(seconds)}`}
			style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
		>
			<RecDot live={phase === 'recording' && started} />
			<Txt
				size={15}
				style={{ fontVariant: ['tabular-nums'], opacity: started ? 1 : 0.5, minWidth: 38 }}
			>
				{duration(seconds)}
			</Txt>
			{left <= 60 ? (
				<Txt size={12} style={{ color: colors.danger, fontVariant: ['tabular-nums'] }}>
					{left}s left
				</Txt>
			) : null}
		</View>
	);
}

/**
 * A recording on this device, before it's sent: play / pause, the waveform to tap through, the
 * length. Its own player (a local file): the app's voice note player pauses meanwhile.
 */
export function ReviewPlayer({ voice }: { voice: LocalVoice }) {
	const player = useAudioPlayer(voice.uri, { updateInterval: 100 });
	const status = useAudioPlayerStatus(player);
	const total = status.duration > 0 ? status.duration : voice.duration_ms / 1000;
	const progress = useSharedValue(0);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		progress.value = withTiming(total ? Math.min(1, status.currentTime / total) : 0, {
			duration: status.playing ? 100 : 0,
			easing: Easing.linear
		});
	}, [status.currentTime, status.playing, total, progress]);
	useEffect(() => {
		if (status.didJustFinish) player.seekTo(0).catch(() => {});
	}, [status.didJustFinish, player]);
	const toggle = async () => {
		if (status.playing) return player.pause();
		pauseGlobal();
		await playbackMode();
		if (total && status.currentTime >= total - 0.2) await player.seekTo(0).catch(() => {});
		player.play();
	};
	const shown = status.playing || status.currentTime > 0 ? status.currentTime : total;
	return (
		<View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={status.playing ? 'Pause the recording' : 'Play the recording'}
				hitSlop={6}
				onPress={toggle}
				style={({ pressed }) => ({
					width: 32,
					height: 32,
					borderRadius: 16,
					backgroundColor: colors.accent,
					alignItems: 'center',
					justifyContent: 'center',
					opacity: pressed ? 0.7 : 1
				})}
			>
				{status.playing ? (
					<Pause size={15} color={colors.background} fill={colors.background} />
				) : (
					<Play
						size={15}
						color={colors.background}
						fill={colors.background}
						style={{ marginLeft: 2 }}
					/>
				)}
			</Pressable>
			<Pressable
				accessibilityRole="adjustable"
				accessibilityLabel={`Your recording, ${duration(total)}`}
				accessibilityValue={{ text: `${duration(status.currentTime)} of ${duration(total)}` }}
				accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
				onAccessibilityAction={(e) =>
					player
						.seekTo(
							Math.max(
								0,
								Math.min(
									total,
									status.currentTime + (e.nativeEvent.actionName === 'increment' ? 5 : -5)
								)
							)
						)
						.catch(() => {})
				}
				onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
				onPress={(e) => {
					if (!width || !total) return;
					const share = Math.max(0, Math.min(1, e.nativeEvent.locationX / width));
					progress.value = share;
					player.seekTo(share * total).catch(() => {});
				}}
				style={{ flex: 1, paddingVertical: 4 }}
			>
				<Waveform peaks={voice.peaks} progress={progress} height={24} />
			</Pressable>
			<Txt size={13} muted style={{ fontVariant: ['tabular-nums'], minWidth: 34 }}>
				{duration(shown)}
			</Txt>
		</View>
	);
}

/** trash, the time, the live waveform, pause / resume (and stop, in a composer) */
function LockedControls({ rec, showStop }: { rec: VoiceRecorder; showStop?: boolean }) {
	const paused = rec.state.phase === 'paused';
	return (
		<View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
			<IconButton label="Delete the recording" onPress={rec.cancel}>
				<Trash2 size={21} color={colors.danger} />
			</IconButton>
			<RecTimer rec={rec} />
			<LiveWaveform levels={rec.levels} scroll={rec.scroll} />
			<IconButton
				label={paused ? 'Resume recording' : 'Pause recording'}
				onPress={paused ? rec.resume : rec.pause}
			>
				{paused ? (
					<Mic size={22} color={colors.danger} />
				) : (
					<Pause size={22} color={colors.foreground} fill={colors.foreground} />
				)}
			</IconButton>
			{showStop ? (
				<IconButton label="Stop and review" onPress={rec.stop}>
					<Square size={19} color={colors.foreground} fill={colors.foreground} />
				</IconButton>
			) : null}
		</View>
	);
}

/** a tooltip above the mic, gone after a few seconds */
function Hint({ text, onDone }: { text: string; onDone: () => void }) {
	useEffect(() => {
		const timer = setTimeout(onDone, 3500);
		return () => clearTimeout(timer);
	}, [text, onDone]);
	return (
		<Animated.View
			entering={FadeIn.duration(120)}
			exiting={FadeOut.duration(200)}
			accessibilityLiveRegion="polite"
			style={{
				position: 'absolute',
				right: 0,
				bottom: '100%',
				marginBottom: 10,
				width: 240,
				padding: 10,
				borderRadius: 5,
				borderWidth: 1,
				borderColor: colors.accent,
				backgroundColor: colors.background
			}}
		>
			<Pressable accessibilityRole="button" accessibilityLabel={text} onPress={onDone}>
				<Txt size={14}>{text}</Txt>
			</Pressable>
		</Animated.View>
	);
}

/** the microphone is off for the app: how to turn it on */
export function MicDenied({ onClose }: { onClose: () => void }) {
	return (
		<View
			accessibilityLiveRegion="polite"
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				padding: 10,
				borderRadius: 10,
				backgroundColor: 'rgba(0,0,0,0.7)',
				borderWidth: 1,
				borderColor: colors.line
			}}
		>
			<MicOff size={20} color={colors.muted} />
			<View style={{ flex: 1, gap: 6 }}>
				<Txt size={14}>Voice notes need the microphone. Allow it in Settings.</Txt>
				<Pressable
					accessibilityRole="button"
					onPress={() => Linking.openSettings().catch(() => {})}
					hitSlop={6}
				>
					<Txt size={14} bold accent>
						Open Settings
					</Txt>
				</Pressable>
			</View>
			<IconButton label="Close" onPress={onClose}>
				<X size={18} color={colors.muted} />
			</IconButton>
		</View>
	);
}

/** a round button at the right of the input: the mic, or send */
const roundStyle = (filled: boolean) => ({
	width: MIC_SIZE,
	height: MIC_SIZE,
	borderRadius: MIC_SIZE / 2,
	alignItems: 'center' as const,
	justifyContent: 'center' as const,
	backgroundColor: filled ? colors.accent : 'transparent'
});

/**
 * A chat's input row with voice notes (docs/voice-notes-plan.md, section 5): while the field is
 * empty, send is a mic. Press and hold records at once, release sends, slide left cancels, slide
 * up onto the lock records hands-free (pause, stop to review, delete, send). The text field stays
 * mounted under the recorder, so the keyboard doesn't jump.
 */
export function ChatVoiceInput({
	rec,
	mic,
	onSend,
	sendButton,
	children
}: {
	rec: VoiceRecorder;
	/** the mic is shown (nothing typed or attached, voice notes on) */
	mic: boolean;
	onSend: (voice: LocalVoice) => void;
	/** the usual send button, when there's text */
	sendButton: React.ReactNode;
	/** the usual row: attach buttons and the text field */
	children: React.ReactNode;
}) {
	const { phase, mode, hint, notice } = rec.state;
	const holding = phase === 'recording' && mode === 'hold';
	const locked = (phase === 'recording' || phase === 'paused') && mode === 'locked';
	const busy = phase !== 'idle';
	const [binned, setBinned] = useState(false);
	const [denied, setDenied] = useState(false);

	const rowWidth = useSharedValue(300);
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	const pressing = useSharedValue(false);
	/** 0 nothing yet, 1 cancelled, 2 locked: once decided the finger only lifts */
	const decided = useSharedValue(0);

	const onPress = () => {
		setDenied(false);
		if (rec.state.permission === 'denied') {
			setDenied(true);
			return;
		}
		rec.press();
	};
	const onRelease = async (canceled: boolean) => {
		// taken away by the system (a call, the notification shade): never sent, kept in review
		if (canceled) {
			rec.stop();
			return;
		}
		const voice = await rec.release();
		if (voice) onSend(voice);
	};
	const onCancel = () => {
		setBinned(true);
		setTimeout(() => setBinned(false), 700);
		rec.cancel();
	};

	const gestureOn = phase === 'idle' || holding;
	const longPress = useLongPressGesture({
		enabled: gestureOn,
		minDuration: 0,
		maxDistance: 10_000,
		onActivate: () => {
			'worklet';
			pressing.value = true;
			decided.value = 0;
			tx.value = 0;
			ty.value = 0;
			scheduleOnRN(onPress);
		},
		onFinalize: (e) => {
			'worklet';
			if (!pressing.value) return;
			pressing.value = false;
			tx.value = withSpring(0, { damping: 18 });
			ty.value = withSpring(0, { damping: 18 });
			if (decided.value === 0) scheduleOnRN(onRelease, e.canceled);
		}
	});
	const pan = usePanGesture({
		enabled: gestureOn,
		minDistance: 0,
		onUpdate: (e) => {
			'worklet';
			if (!pressing.value || decided.value !== 0) return;
			const x = Math.min(0, e.translationX);
			const y = Math.min(0, e.translationY);
			// one direction at a time, like WhatsApp
			if (-x > -y) {
				tx.value = x;
				ty.value = 0;
			} else {
				ty.value = y;
				tx.value = 0;
			}
			if (-tx.value > rowWidth.value * CANCEL_SHARE) {
				decided.value = 1;
				tx.value = withTiming(0, { duration: 200 });
				scheduleOnRN(onCancel);
			} else if (-ty.value > LOCK_DISTANCE) {
				decided.value = 2;
				ty.value = withSpring(0, { damping: 18 });
				scheduleOnRN(rec.lock);
			}
		}
	});
	const gesture = useSimultaneousGestures(longPress, pan);

	const micStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateX: tx.value },
			{ translateY: ty.value },
			{ scale: withTiming(pressing.value && decided.value === 0 ? 1.45 : 1, { duration: 140 }) }
		]
	}));
	const slideStyle = useAnimatedStyle(() => {
		const share = Math.min(1, -tx.value / (rowWidth.value * CANCEL_SHARE));
		return { transform: [{ translateX: tx.value * 0.5 }], opacity: 1 - share * 0.9 };
	});
	const pillStyle = useAnimatedStyle(() => {
		const share = Math.min(1, -ty.value / LOCK_DISTANCE);
		return { transform: [{ translateY: ty.value * 0.35 }], opacity: 0.75 + share * 0.25 };
	});

	const showMic = mic || busy;
	return (
		<View
			onLayout={(e) => {
				rowWidth.value = e.nativeEvent.layout.width;
			}}
			style={{ gap: 8 }}
		>
			{denied ? <MicDenied onClose={() => setDenied(false)} /> : null}
			{notice && phase !== 'recording' ? (
				<Txt size={13} muted accessibilityLiveRegion="polite">
					{notice}
				</Txt>
			) : null}
			<View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
				<View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
					{children}
					{busy || binned ? (
						<View
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								top: 0,
								bottom: 0,
								minHeight: MIC_SIZE,
								flexDirection: 'row',
								alignItems: 'center',
								backgroundColor: colors.background
							}}
						>
							{binned && !busy ? (
								<Animated.View entering={ZoomIn.springify()} exiting={FadeOut.duration(250)}>
									<Trash2 size={24} color={colors.danger} />
								</Animated.View>
							) : phase === 'requesting' ? (
								<Txt size={14} muted>
									Allow the microphone to record voice notes
								</Txt>
							) : phase === 'review' && rec.state.voice ? (
								<View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
									<IconButton label="Delete the recording" onPress={rec.cancel}>
										<Trash2 size={21} color={colors.danger} />
									</IconButton>
									<ReviewPlayer voice={rec.state.voice} />
								</View>
							) : locked ? (
								<LockedControls rec={rec} />
							) : holding ? (
								<View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
									<RecTimer rec={rec} />
									<LiveWaveform levels={rec.levels} scroll={rec.scroll} />
									<Animated.View
										style={[{ flexDirection: 'row', alignItems: 'center' }, slideStyle]}
										accessibilityLabel="Slide left to cancel"
									>
										<ChevronLeft size={16} color={colors.muted} />
										<Txt size={13} muted>
											Slide to cancel
										</Txt>
									</Animated.View>
								</View>
							) : null}
						</View>
					) : null}
				</View>
				{!showMic ? (
					sendButton
				) : locked || phase === 'review' ? (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Send voice note"
						onPress={async () => {
							const voice = await rec.take();
							if (voice) onSend(voice);
						}}
						style={({ pressed }) => [roundStyle(true), { opacity: pressed ? 0.7 : 1 }]}
					>
						<SendHorizontal size={21} color={colors.background} />
					</Pressable>
				) : (
					<View>
						{holding ? (
							<Animated.View
								entering={FadeIn.duration(150)}
								exiting={FadeOut.duration(120)}
								pointerEvents="none"
								style={[
									{
										position: 'absolute',
										left: (MIC_SIZE - 36) / 2,
										bottom: MIC_SIZE + 24,
										width: 36,
										paddingVertical: 10,
										borderRadius: 18,
										borderWidth: 1,
										borderColor: colors.accent,
										backgroundColor: colors.background,
										alignItems: 'center',
										gap: 4
									},
									pillStyle
								]}
							>
								<Lock size={17} color={colors.foreground} />
								<ChevronUp size={15} color={colors.muted} />
							</Animated.View>
						) : null}
						{hint ? <Hint text={hint} onDone={rec.clearHint} /> : null}
						<GestureDetector gesture={gesture}>
							<Animated.View
								accessible
								accessibilityRole="button"
								accessibilityLabel="Record voice note"
								accessibilityHint="Hold to record and release to send, or double tap to record hands-free"
								accessibilityActions={[{ name: 'activate' }]}
								onAccessibilityAction={() => rec.startLocked()}
								style={[roundStyle(holding), micStyle]}
							>
								<Mic size={22} color={holding ? colors.background : colors.accent} />
							</Animated.View>
						</GestureDetector>
					</View>
				)}
			</View>
			{locked ? (
				<Animated.View
					entering={FadeIn.duration(150)}
					style={{ position: 'absolute', right: 0, bottom: MIC_SIZE + 16 }}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Stop and review"
						onPress={rec.stop}
						hitSlop={6}
						style={({ pressed }) => ({
							width: MIC_SIZE,
							height: MIC_SIZE,
							borderRadius: MIC_SIZE / 2,
							borderWidth: 1,
							borderColor: colors.accent,
							backgroundColor: colors.background,
							alignItems: 'center',
							justifyContent: 'center',
							opacity: pressed ? 0.7 : 1
						})}
					>
						<Square size={16} color={colors.danger} fill={colors.danger} />
					</Pressable>
				</Animated.View>
			) : null}
		</View>
	);
}

/**
 * The recorder of a composer (posts, replies, quotes): opened by the mic in the toolbar, recording
 * at once hands-free; then the recording to play back or delete. The caption is the post's text.
 */
export function ComposerRecorder({ rec }: { rec: VoiceRecorder }) {
	const { phase, voice, notice } = rec.state;
	if (phase === 'idle' && !notice) return null;
	return (
		<View
			style={{
				gap: 8,
				padding: 10,
				borderRadius: 5,
				borderWidth: 1,
				borderColor: phase === 'recording' ? colors.danger : colors.accent
			}}
		>
			{notice ? (
				<Txt size={13} muted accessibilityLiveRegion="polite">
					{notice}
				</Txt>
			) : null}
			{phase === 'requesting' ? (
				<Txt size={14} muted>
					Allow the microphone to record voice notes
				</Txt>
			) : phase === 'review' && voice ? (
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
					<ReviewPlayer voice={voice} />
					<IconButton label="Delete the voice note" onPress={rec.cancel}>
						<Trash2 size={20} color={colors.danger} />
					</IconButton>
				</View>
			) : phase === 'recording' || phase === 'paused' ? (
				<LockedControls rec={rec} showStop />
			) : null}
		</View>
	);
}

/**
 * A voice note on its way, in its bubble: the waveform recorded here, the length, how the upload
 * goes, and a retry once it failed.
 */
export function PendingVoice({
	voice,
	upload,
	processing,
	failed,
	onRetry
}: {
	voice: LocalVoice;
	upload: UploadState | null;
	/** sent, the server is still processing it */
	processing?: boolean;
	/** why it didn't go out */
	failed?: string | null;
	onRetry: () => void;
}) {
	const status = failed
		? `${failed} Tap to retry.`
		: processing
		? 'Processing…'
		: upload?.status === 'waiting'
		? 'Waiting for the connection…'
		: upload?.status === 'done'
		? 'Sending…'
		: 'Uploading…';
	return (
		<Pressable
			accessibilityRole={failed ? 'button' : undefined}
			accessibilityLabel={`Voice note, ${duration(voice.duration_ms / 1000)}. ${status}`}
			disabled={!failed}
			onPress={onRetry}
			style={{ width: 230, gap: 4 }}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
				<View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
					{failed ? (
						<Mic size={20} color={colors.danger} />
					) : (
						<UploadProgress progress={processing ? 1 : upload?.progress ?? 0} size={28} />
					)}
				</View>
				<View style={{ flex: 1 }}>
					<Waveform peaks={voice.peaks} height={24} />
				</View>
			</View>
			<Txt
				size={12}
				muted={!failed}
				style={failed ? { color: colors.danger } : { fontVariant: ['tabular-nums'] }}
			>
				{duration(voice.duration_ms / 1000)} · {status}
			</Txt>
		</Pressable>
	);
}
