import * as Haptics from 'expo-haptics';
import { Heart } from 'lucide-react-native';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent, View } from 'react-native';
import Animated, {
	Easing,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withDelay,
	withSequence,
	withTiming
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { like } from '@/lib/posts';
import { colors } from '@/lib/theme';
import type { Post } from '@/lib/types';

// like the web's Post.svelte: how quick the second tap must be, and how far from the first (px)
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_SLOP = 40;
const HEART = 80;

type Burst = { id: number; x: number; y: number; tilt: number };

/**
 * Double tap a post to like it, like the web app. A single tap still does its thing (opens the
 * post, or the image), just after the double tap window has passed. Pass the returned `tap` the
 * press event and what a single tap does; put `ref` on the post and `hearts` inside it.
 */
export function useDoubleTapLike(post: Post, enabled: boolean) {
	const ref = useRef<ComponentRef<typeof View>>(null);
	const [bursts, setBursts] = useState<Burst[]>([]);
	const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
	const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const nextId = useRef(0);
	// the latest copy, so a quick third tap sees the like the second one made
	const postRef = useRef(post);
	postRef.current = post;

	useEffect(() => () => clearTimeout(pending.current), []);

	const tap = useCallback(
		(e: GestureResponderEvent, single?: () => void) => {
			if (!enabled) return single?.();
			const { pageX: x, pageY: y } = e.nativeEvent;
			const now = Date.now();
			const last = lastTap.current;
			const isDouble =
				!!last &&
				now - last.t < DOUBLE_TAP_MS &&
				Math.hypot(x - last.x, y - last.y) < DOUBLE_TAP_SLOP;
			// a third quick tap is another double tap: more hearts, never a navigation
			lastTap.current = { t: now, x, y };
			clearTimeout(pending.current);
			pending.current = undefined;
			if (isDouble) {
				// the heart lands where the finger did, in the post's own coordinates
				ref.current?.measure((_x, _y, _w, _h, left, top) =>
					setBursts((b) => [
						...b,
						{ id: ++nextId.current, x: x - left, y: y - top, tilt: Math.random() * 30 - 15 }
					])
				);
				// a double tap only ever likes, like everywhere else
				if (!postRef.current.liked) {
					Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
					like(postRef.current);
				}
				return;
			}
			pending.current = setTimeout(() => {
				pending.current = undefined;
				lastTap.current = null;
				single?.();
			}, DOUBLE_TAP_MS);
		},
		[enabled]
	);

	const done = useCallback((id: number) => setBursts((b) => b.filter((h) => h.id !== id)), []);
	const hearts = bursts.map((b) => <HeartBurst key={b.id} burst={b} onDone={done} />);

	return { ref, tap, hearts };
}

const ease = Easing.bezier(0.2, 0.9, 0.3, 1);
const step = (to: number, duration: number) => withTiming(to, { duration, easing: ease });

/** The heart a double tap leaves where it landed: pops in, settles, then floats away. */
function HeartBurst({ burst, onDone }: { burst: Burst; onDone: (id: number) => void }) {
	const reduceMotion = useReducedMotion();
	const scale = useSharedValue(reduceMotion ? 1 : 0.2);
	const opacity = useSharedValue(reduceMotion ? 1 : 0);
	const rise = useSharedValue(0);

	useEffect(() => {
		const finish = (finished?: boolean) => {
			'worklet';
			if (finished) scheduleOnRN(onDone, burst.id);
		};
		if (reduceMotion) {
			opacity.value = withDelay(420, withTiming(0, { duration: 280 }, finish));
			return;
		}
		// the web's keyframes over 850ms: 1.2 at 15%, 0.92 at 28%, 1 from 40% to 65%, then away
		scale.value = withSequence(
			step(1.2, 128),
			step(0.92, 110),
			step(1, 102),
			withDelay(212, step(0.75, 298))
		);
		opacity.value = withSequence(
			step(1, 128),
			withDelay(424, step(0, 298)),
			withTiming(0, { duration: 0 }, finish)
		);
		rise.value = withDelay(552, step(-HEART * 0.9, 298));
	}, []);

	const style = useAnimatedStyle(() => ({
		opacity: opacity.value,
		transform: [{ translateY: rise.value }, { rotate: `${burst.tilt}deg` }, { scale: scale.value }]
	}));

	return (
		<Animated.View
			pointerEvents="none"
			style={[
				{
					position: 'absolute',
					left: burst.x - HEART / 2,
					top: burst.y - HEART / 2,
					width: HEART,
					height: HEART,
					zIndex: 10
				},
				style
			]}
		>
			<Heart size={HEART} color={colors.danger} fill={colors.danger} strokeWidth={1.5} />
		</Animated.View>
	);
}
