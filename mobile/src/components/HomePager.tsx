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
const PAGE_MS = 250;
// a page has stopped moving by then, whether tapped or swiped to: work that re-renders a page
// waits for it, so it can't cost a frame of the slide
export const SETTLE_MS = 350;

/**
 * The feed and the messages side by side: a plain horizontal swipe, the pages follow the finger
 * and the release carries its speed into the slide. Only mostly sideways moves towards the other
 * page count, so the lists still scroll.
 *
 * Everything moving runs on the UI thread. React hears about it once the page has turned (header
 * title, tab bar icons), and `pages` must be elements that don't change (made once), so turning
 * a page never re-renders the feed or the chats while they slide.
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
		onActivate: (e) => {
			'worklet';
			cancelAnimation(x);
			// from where the finger is now, not where it touched down, so the page doesn't jump by the
			// distance it took to tell a swipe from a scroll
			start.value = x.value - e.translationX;
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
			// critically damped (damping = 2√stiffness), so it carries on at the finger's speed and
			// settles in about 200ms without bouncing past the edge
			x.value = withSpring(-to * width, {
				velocity: e.velocityX,
				stiffness: 500,
				damping: 45,
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
