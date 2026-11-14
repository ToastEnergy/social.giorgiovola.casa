import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withDelay,
	withSequence,
	withSpring,
	withTiming
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// how far, or how fast, a swipe has to go to switch tabs
const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 600;
// the screen follows the finger this much, so it's clear something will happen
const FOLLOW = 0.35;
const FOLLOW_MAX = 50;
// the tabs' "shift" animation (transitionSpec in (tabs)/_layout.tsx): the page leaving moves this far
// over this long, so a swipe hands over to it without a stop or a jump back
const SHIFT_DISTANCE = 50;
export const SHIFT_MS = 200;

/**
 * Swiping sideways on a tab opens its neighbour, like Instagram's feed and messages: `left` is
 * where a swipe to the left (finger moving left) goes, `right` where a swipe to the right goes.
 * Only mostly sideways moves count, so the lists still scroll.
 *
 * Everything moving runs on the UI thread: the drag is a shared value, and once a swipe counts
 * the page keeps sliding out at the speed it had while the tab navigator's own transition (the
 * same one a tap on the tab bar plays, native driven) fades it out and brings in the other tab.
 * Nothing here is React state, so the tab screens don't re-render while a finger is down.
 */
export function TabSwipe({
	left,
	right,
	children
}: {
	left?: Href;
	right?: Href;
	children: React.ReactNode;
}) {
	const dx = useSharedValue(0);
	const hasLeft = !!left;
	const hasRight = !!right;
	const go = useCallback(
		(direction: 'left' | 'right') => {
			const to = direction === 'left' ? left : right;
			if (to) router.navigate(to);
		},
		[left, right]
	);
	// a page swiped away is put back in place while hidden; if the tab comes back sooner than
	// that, it's put back as it starts to fade in
	useFocusEffect(
		useCallback(() => {
			cancelAnimation(dx);
			dx.value = 0;
		}, [dx])
	);

	const pan = usePanGesture({
		enabled: hasLeft || hasRight,
		// only the directions that lead somewhere, and mostly sideways: anything else is scrolling
		activeOffsetX: hasLeft && hasRight ? [-20, 20] : hasLeft ? -20 : 20,
		failOffsetY: [-15, 15],
		onUpdate: (e) => {
			'worklet';
			const x = e.translationX;
			if ((x < 0 && !hasLeft) || (x > 0 && !hasRight)) {
				dx.value = 0;
				return;
			}
			dx.value = Math.sign(x) * Math.min(FOLLOW_MAX, Math.abs(x) * FOLLOW);
		},
		onDeactivate: (e) => {
			'worklet';
			const toLeft =
				!e.canceled &&
				hasLeft &&
				(e.translationX < -SWIPE_DISTANCE || e.velocityX < -SWIPE_VELOCITY);
			const toRight =
				!e.canceled &&
				hasRight &&
				(e.translationX > SWIPE_DISTANCE || e.velocityX > SWIPE_VELOCITY);
			if (!toLeft && !toRight) {
				// not far enough: back into place
				dx.value = withSpring(0, { damping: 20, stiffness: 250 });
				return;
			}
			scheduleOnRN(go, toLeft ? 'left' : 'right');
			// keep going the way it was swiped while the transition fades the page out, then put it
			// back where it belongs once it can't be seen (before the tab comes back)
			const sign = toLeft ? -1 : 1;
			dx.value = withSequence(
				withTiming(dx.value + sign * SHIFT_DISTANCE, {
					duration: SHIFT_MS,
					easing: Easing.out(Easing.cubic)
				}),
				withDelay(2 * SHIFT_MS, withTiming(0, { duration: 0 }))
			);
		}
	});

	const style = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));

	return (
		<GestureDetector gesture={pan}>
			<Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
		</GestureDetector>
	);
}
