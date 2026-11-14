import { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { setHomePage, useHomePage, type HomePage } from '@/lib/homePage';

// a swipe that ends past this share of the screen, or is flicked this fast, turns the page
const TURN_SHARE = 0.5;
const FLICK_VELOCITY = 500;
// a tap on the tab bar slides over in this long
export const PAGE_MS = 250;

/**
 * The feed and the messages side by side: a plain horizontal swipe, the pages follow the finger
 * and the release carries its speed into the slide. Only mostly sideways moves towards the other
 * page count, so the lists still scroll.
 *
 * Everything moving runs on the UI thread; React only hears about it once the page has turned
 * (header title, tab bar icons).
 */
export function HomePager({ pages }: { pages: [React.ReactNode, React.ReactNode] }) {
	const { width } = useWindowDimensions();
	const { page, animate } = useHomePage();
	const x = useSharedValue(-page * width);
	const start = useSharedValue(0);
	// the page the pager is on, or heading to
	const target = useSharedValue<HomePage>(page);

	// a page chosen elsewhere (tab bar, /messages): slide over to it, or just be there
	useEffect(() => {
		if (target.value === page) return;
		target.value = page;
		cancelAnimation(x);
		x.value = animate
			? withTiming(-page * width, { duration: PAGE_MS, easing: Easing.out(Easing.cubic) })
			: -page * width;
	}, [page, animate, width, target, x]);
	// rotated or resized: stay on the page
	useEffect(() => {
		cancelAnimation(x);
		x.value = -target.value * width;
	}, [width, target, x]);

	const pan = usePanGesture({
		// only towards the other page, and mostly sideways: anything else is scrolling
		activeOffsetX: page === 0 ? -15 : 15,
		failOffsetY: [-15, 15],
		onActivate: () => {
			'worklet';
			cancelAnimation(x);
			start.value = x.value;
		},
		onUpdate: (e) => {
			'worklet';
			x.value = Math.min(0, Math.max(-width, start.value + e.translationX));
		},
		onDeactivate: (e) => {
			'worklet';
			let to: HomePage = -x.value > width * TURN_SHARE ? 1 : 0;
			if (!e.canceled && e.velocityX < -FLICK_VELOCITY) to = 1;
			else if (!e.canceled && e.velocityX > FLICK_VELOCITY) to = 0;
			// critically damped, so it eases in at the finger's speed without bouncing past the edge
			x.value = withSpring(-to * width, {
				velocity: e.velocityX,
				stiffness: 400,
				damping: 40,
				mass: 1,
				overshootClamping: true
			});
			if (to !== target.value) {
				target.value = to;
				scheduleOnRN(setHomePage, to, false);
			}
		}
	});

	const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

	return (
		<GestureDetector gesture={pan}>
			<View style={{ flex: 1, overflow: 'hidden' }}>
				<Animated.View style={[{ flex: 1, flexDirection: 'row', width: width * 2 }, style]}>
					<View style={{ width }}>{pages[0]}</View>
					<View style={{ width }}>{pages[1]}</View>
				</Animated.View>
			</View>
		</GestureDetector>
	);
}
