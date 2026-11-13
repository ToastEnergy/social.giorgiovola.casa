import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/lib/theme';

const R = 10;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * An image's upload, like the web's UploadProgress.svelte: a ring filling up, spinning once the
 * whole image went out and the server is compressing it.
 */
export function UploadProgress({
	progress,
	size = 28
}: {
	/** share uploaded, 0 to 1; at 1 it spins */
	progress: number;
	size?: number;
}) {
	const processing = progress >= 1;
	// a small visible arc from the start, so a slow connection doesn't look stuck
	const shown = processing ? 0.25 : Math.max(0.05, progress);
	const spin = useRef(new Animated.Value(0)).current;
	useEffect(() => {
		if (!processing) return;
		const loop = Animated.loop(
			Animated.timing(spin, {
				toValue: 1,
				duration: 1000,
				easing: Easing.linear,
				useNativeDriver: true
			})
		);
		loop.start();
		return () => {
			loop.stop();
			spin.setValue(0);
		};
	}, [processing, spin]);
	const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
	return (
		<Animated.View
			accessibilityRole="progressbar"
			accessibilityLabel={processing ? 'Processing image' : 'Uploading image'}
			accessibilityValue={processing ? undefined : { min: 0, max: 100, now: progress * 100 }}
			style={{ width: size, height: size, transform: [{ rotate }] }}
		>
			<Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
				<Circle
					cx={12}
					cy={12}
					r={R}
					stroke={colors.foreground}
					strokeOpacity={0.25}
					strokeWidth={2.5}
				/>
				<Circle
					cx={12}
					cy={12}
					r={R}
					stroke={colors.accent}
					strokeWidth={2.5}
					strokeLinecap="round"
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={CIRCUMFERENCE * (1 - shown)}
					transform="rotate(-90 12 12)"
				/>
			</Svg>
		</Animated.View>
	);
}
