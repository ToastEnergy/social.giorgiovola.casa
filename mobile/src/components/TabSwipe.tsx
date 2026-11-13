import { router, type Href } from 'expo-router';
import { useCallback } from 'react';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// how far, or how fast, a swipe has to go to switch tabs
const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 600;
// the screen follows the finger this much, so it's clear something will happen
const FOLLOW = 0.3;
const FOLLOW_MAX = 40;

/**
 * Swiping sideways on a tab opens its neighbour, like Instagram's feed and messages: `left` is
 * where a swipe to the left (finger moving left) goes, `right` where a swipe to the right goes.
 * Only mostly sideways moves count, so the lists still scroll.
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
			if (e.canceled) return;
			if (hasLeft && (e.translationX < -SWIPE_DISTANCE || e.velocityX < -SWIPE_VELOCITY))
				scheduleOnRN(go, 'left');
			else if (hasRight && (e.translationX > SWIPE_DISTANCE || e.velocityX > SWIPE_VELOCITY))
				scheduleOnRN(go, 'right');
		},
		onFinalize: () => {
			'worklet';
			dx.value = withTiming(0, { duration: 150 });
		}
	});

	const style = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));

	return (
		<GestureDetector gesture={pan}>
			<Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>
		</GestureDetector>
	);
}
