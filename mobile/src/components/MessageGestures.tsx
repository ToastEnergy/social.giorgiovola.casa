import * as Haptics from 'expo-haptics';
import { Reply } from 'lucide-react-native';
import { useCallback, useRef } from 'react';
import {
	GestureDetector,
	usePanGesture,
	useSimultaneousGestures,
	useTapGesture
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '@/lib/theme';

// swiping a message this far to the right replies to it, like the web chat (and WhatsApp)
const SWIPE_REPLY = 60;
const SWIPE_MAX = 90;
const DOUBLE_TAP_MS = 300;

const tick = () => {
	Haptics.selectionAsync().catch(() => {});
};

/**
 * The touch gestures on a chat message, like the web's Chat.svelte: swipe right to reply (with a
 * threshold it resists past, and a tick when crossing it) and double tap to react. Single taps
 * still reach what's inside (links, images), and long presses the bubble's own menu.
 */
export function MessageGestures({
	enabled,
	onReply,
	onDoubleTap,
	children
}: {
	/** false when replying and reacting isn't possible (blocked, muted) */
	enabled: boolean;
	onReply: () => void;
	onDoubleTap: () => void;
	children: React.ReactNode;
}) {
	const dx = useSharedValue(0);
	// the gestures' callbacks are made once: these always call the latest handlers
	const replyRef = useRef(onReply);
	replyRef.current = onReply;
	const doubleTapRef = useRef(onDoubleTap);
	doubleTapRef.current = onDoubleTap;
	const reply = useCallback(() => replyRef.current(), []);
	const doubleTap = useCallback(() => doubleTapRef.current(), []);

	const pan = usePanGesture({
		enabled,
		// only rightwards and mostly sideways: anything else is the list scrolling
		activeOffsetX: 12,
		failOffsetY: [-12, 12],
		onUpdate: (e) => {
			'worklet';
			const pulled = Math.max(0, e.translationX);
			// past the threshold it resists, so it's clear that letting go now replies
			const next = Math.min(
				SWIPE_MAX,
				pulled < SWIPE_REPLY ? pulled : SWIPE_REPLY + (pulled - SWIPE_REPLY) * 0.3
			);
			if (dx.value < SWIPE_REPLY && next >= SWIPE_REPLY) scheduleOnRN(tick);
			dx.value = next;
		},
		onDeactivate: (e) => {
			'worklet';
			if (!e.canceled && dx.value >= SWIPE_REPLY) scheduleOnRN(reply);
		},
		onFinalize: () => {
			'worklet';
			dx.value = withTiming(0, { duration: 150 });
		}
	});
	const tap = useTapGesture({
		enabled,
		numberOfTaps: 2,
		maxDelay: DOUBLE_TAP_MS,
		onActivate: () => {
			'worklet';
			scheduleOnRN(doubleTap);
		}
	});
	const gesture = useSimultaneousGestures(pan, tap);

	const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
	const iconStyle = useAnimatedStyle(() => ({
		opacity: Math.min(1, dx.value / SWIPE_REPLY),
		transform: [{ translateX: Math.min(dx.value, SWIPE_REPLY) / 2 - 11 }]
	}));

	return (
		<GestureDetector gesture={gesture}>
			<Animated.View>
				<Animated.View
					pointerEvents="none"
					style={[
						{ position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' },
						iconStyle
					]}
				>
					<Reply size={22} color={colors.accent} />
				</Animated.View>
				<Animated.View style={rowStyle}>{children}</Animated.View>
			</Animated.View>
		</GestureDetector>
	);
}
