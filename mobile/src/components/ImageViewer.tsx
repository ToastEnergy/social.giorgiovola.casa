import { Directory, File, Paths } from 'expo-file-system';
import { Image, type ImageSource } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Check, Download, Share2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, useWindowDimensions, View } from 'react-native';
import {
	GestureDetector,
	GestureHandlerRootView,
	useExclusiveGestures,
	usePanGesture,
	usePinchGesture,
	useSimultaneousGestures,
	useTapGesture
} from 'react-native-gesture-handler';
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
	type SharedValue
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from '@/lib/theme';
import { Txt } from './ui';

// like the web's ImageViewer.svelte
const MAX_SCALE = 6;
const DOUBLE_ZOOM = 2.5;
// space between an image and its neighbours while they slide
const GAP = 20;
const SLIDE_MS = 200;
/** dragging an unzoomed image this far down (or flicking it) closes the viewer */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1000;

type Size = { width: number; height: number };

/**
 * The full screen images: pinch and double tap to zoom, pan when zoomed, swipe sideways between
 * images and down to close when not. Shown inside the overlays' modal.
 */
export function ImageViewer({
	sources,
	initial,
	onClose
}: {
	sources: ImageSource[];
	initial: number;
	onClose: () => void;
}) {
	const { width: W, height: H } = useWindowDimensions();
	const insets = useSafeAreaInsets();
	const [index, setIndex] = useState(initial);
	const [sizes, setSizes] = useState<Record<number, Size>>({});
	const [sharing, setSharing] = useState(false);
	const [saving, setSaving] = useState<'idle' | 'busy' | 'done'>('idle');
	const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(savedTimer.current), []);
	const last = sources.length - 1;

	// the page shown, fractional while sliding; the active image's zoom and pan (from the centre)
	const page = useSharedValue(initial);
	const active = useSharedValue(initial);
	const scale = useSharedValue(1);
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	// dragging an unzoomed image down to close
	const sy = useSharedValue(0);
	// the active image as shown unzoomed (contain), to keep it covering the screen when zoomed
	const shownW = useSharedValue(W);
	const shownH = useSharedValue(H);

	const size = sizes[index];
	useEffect(() => {
		const fit = size ? Math.min(W / size.width, H / size.height) : 1;
		shownW.value = size ? size.width * fit : W;
		shownH.value = size ? size.height * fit : H;
	}, [size, W, H, shownW, shownH]);

	// gesture state
	const startScale = useSharedValue(1);
	const anchorX = useSharedValue(0);
	const anchorY = useSharedValue(0);
	const pinching = useSharedValue(false);
	/** what a one finger drag does: 0 not decided, 1 pan the zoomed image, 2 page, 3 dismiss */
	const mode = useSharedValue(0);

	const pinch = usePinchGesture({
		onActivate: (e) => {
			'worklet';
			pinching.value = true;
			startScale.value = scale.value;
			// the image point under the fingers, in unscaled image coordinates
			anchorX.value = (e.focalX - W / 2 - tx.value) / scale.value;
			anchorY.value = (e.focalY - H / 2 - ty.value) / scale.value;
		},
		onUpdate: (e) => {
			'worklet';
			const next = Math.min(MAX_SCALE, Math.max(1, startScale.value * e.scale));
			scale.value = next;
			tx.value = clamp(e.focalX - W / 2 - anchorX.value * next, maxPan(shownW.value, next, W));
			ty.value = clamp(e.focalY - H / 2 - anchorY.value * next, maxPan(shownH.value, next, H));
		},
		onFinalize: () => {
			'worklet';
			pinching.value = false;
			if (scale.value < 1.01) {
				scale.value = withTiming(1);
				tx.value = withTiming(0);
				ty.value = withTiming(0);
			}
		}
	});

	const pan = usePanGesture({
		maxPointers: 2,
		onUpdate: (e) => {
			'worklet';
			if (pinching.value) return;
			// decided on the first move: a pinch may have zoomed in since the finger went down
			if (mode.value === 0)
				mode.value =
					scale.value > 1.01 ? 1 : Math.abs(e.translationX) > Math.abs(e.translationY) ? 2 : 3;
			if (mode.value === 1) {
				tx.value = clamp(tx.value + e.changeX, maxPan(shownW.value, scale.value, W));
				ty.value = clamp(ty.value + e.changeY, maxPan(shownH.value, scale.value, H));
			} else if (mode.value === 2) {
				let next = active.value - e.translationX / (W + GAP);
				// nothing past the first and last image: it resists
				if (next < 0) next = next / 3;
				if (next > last) next = last + (next - last) / 3;
				page.value = next;
			} else sy.value = e.translationY;
		},
		onDeactivate: (e) => {
			'worklet';
			if (mode.value === 2) {
				const from = active.value;
				let to = from;
				if ((e.velocityX < -500 || e.translationX < -W / 3) && from < last) to = from + 1;
				else if ((e.velocityX > 500 || e.translationX > W / 3) && from > 0) to = from - 1;
				page.value = withTiming(to, { duration: SLIDE_MS }, (done) => {
					if (!done || to === from) return;
					active.value = to;
					scale.value = 1;
					tx.value = 0;
					ty.value = 0;
					scheduleOnRN(setIndex, to);
				});
			} else if (mode.value === 3) {
				if (sy.value > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
					sy.value = withTiming(H, { duration: SLIDE_MS }, () => scheduleOnRN(onClose));
				} else sy.value = withTiming(0);
			}
		},
		onFinalize: () => {
			'worklet';
			mode.value = 0;
		}
	});

	const doubleTap = useTapGesture({
		numberOfTaps: 2,
		onActivate: (e) => {
			'worklet';
			if (scale.value > 1.01) {
				scale.value = withTiming(1);
				tx.value = withTiming(0);
				ty.value = withTiming(0);
				return;
			}
			// zoom in keeping the tapped point in place
			const px = e.x - W / 2;
			const py = e.y - H / 2;
			scale.value = withTiming(DOUBLE_ZOOM);
			tx.value = withTiming(clamp(px - px * DOUBLE_ZOOM, maxPan(shownW.value, DOUBLE_ZOOM, W)));
			ty.value = withTiming(clamp(py - py * DOUBLE_ZOOM, maxPan(shownH.value, DOUBLE_ZOOM, H)));
		}
	});
	// a tap on an unzoomed image closes it, like before
	const tap = useTapGesture({
		onActivate: () => {
			'worklet';
			if (scale.value <= 1.01) scheduleOnRN(onClose);
		}
	});
	const taps = useExclusiveGestures(doubleTap, tap);
	const gesture = useSimultaneousGestures(pinch, pan, taps);

	const backdrop = useAnimatedStyle(() => ({
		opacity: 1 - Math.min(1, Math.abs(sy.value) / (H / 2)) * 0.7
	}));

	async function share() {
		const source = sources[index];
		if (!source?.uri || sharing) return;
		setSharing(true);
		try {
			await Sharing.shareAsync(await localCopy(source), { dialogTitle: 'Share image' });
		} catch {
			// cancelled, or the image couldn't be downloaded: nothing to do
		} finally {
			setSharing(false);
		}
	}

	async function save() {
		const source = sources[index];
		if (!source?.uri || saving === 'busy') return;
		setSaving('busy');
		clearTimeout(savedTimer.current);
		try {
			// adding to the library only needs write access, not reading the user's photos
			const { granted, canAskAgain } = await requestPermissionsAsync(true, ['photo']);
			if (!granted) {
				setSaving('idle');
				Alert.alert(
					'Allow access to your photos',
					canAskAgain
						? 'The image can only be saved with access to your photos.'
						: 'Allow access to your photos in the system settings to save images.'
				);
				return;
			}
			await Asset.create(await galleryFile(await localCopy(source)));
			setSaving('done');
			savedTimer.current = setTimeout(() => setSaving('idle'), 2000);
		} catch {
			setSaving('idle');
			Alert.alert("Couldn't save the image", 'Check your connection and try again.');
		}
	}

	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<Animated.View
				style={[
					{
						position: 'absolute',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: 'rgba(0,0,0,0.95)'
					},
					backdrop
				]}
			/>
			<GestureDetector gesture={gesture}>
				<View style={{ flex: 1 }} accessibilityViewIsModal>
					{[index - 1, index, index + 1]
						.filter((i) => i >= 0 && i <= last)
						.map((i) => (
							<Slide
								key={i}
								i={i}
								source={sources[i]}
								page={page}
								active={active}
								scale={scale}
								tx={tx}
								ty={ty}
								sy={sy}
								width={W}
								height={H}
								onSize={(s) => setSizes((now) => (now[i] ? now : { ...now, [i]: s }))}
							/>
						))}
				</View>
			</GestureDetector>
			<View
				style={{
					position: 'absolute',
					top: insets.top + 10,
					left: 15,
					right: 15,
					flexDirection: 'row',
					alignItems: 'center',
					gap: 20
				}}
			>
				{sources.length > 1 ? (
					<Txt size={14} style={{ flex: 1 }}>
						{index + 1} / {sources.length}
					</Txt>
				) : (
					<View style={{ flex: 1 }} />
				)}
				<Pressable accessibilityLabel="Save image" onPress={save} hitSlop={10}>
					{saving === 'busy' ? (
						<ActivityIndicator color={colors.foreground} />
					) : saving === 'done' ? (
						<Check color={colors.accent} size={24} />
					) : (
						<Download color={colors.foreground} size={24} />
					)}
				</Pressable>
				<Pressable accessibilityLabel="Share image" onPress={share} hitSlop={10}>
					{sharing ? (
						<ActivityIndicator color={colors.foreground} />
					) : (
						<Share2 color={colors.foreground} size={24} />
					)}
				</Pressable>
				<Pressable accessibilityLabel="Close" onPress={onClose} hitSlop={10}>
					<X color={colors.foreground} size={28} />
				</Pressable>
			</View>
		</GestureHandlerRootView>
	);
}

/** a file on the device for an image, downloading it (with the session's headers) when remote */
async function localCopy(source: ImageSource): Promise<string> {
	const uri = source.uri!;
	if (!/^https?:\/\//.test(uri)) return uri;
	const dir = new Directory(Paths.cache, 'shared-images');
	dir.create({ idempotent: true, intermediates: true });
	const file = await File.downloadFileAsync(uri, dir, {
		headers: source.headers,
		idempotent: true
	});
	return file.uri;
}

/**
 * The image in a format the photo library takes everywhere: uploads are WebP, which the iOS
 * library doesn't accept, so anything but JPEG, PNG, GIF and HEIC is saved as a JPEG.
 */
async function galleryFile(uri: string): Promise<string> {
	if (/\.(jpe?g|png|gif|heic)$/i.test(uri.split(/[?#]/)[0])) return uri;
	const ref = await ImageManipulator.manipulate(uri).renderAsync();
	const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
	return out.uri;
}

function clamp(value: number, max: number) {
	'worklet';
	return Math.min(max, Math.max(-max, value));
}

/** how far a zoomed image can move from the centre and still cover the screen */
function maxPan(shown: number, scale: number, screen: number) {
	'worklet';
	return Math.max(0, (shown * scale - screen) / 2);
}

function Slide({
	i,
	source,
	page,
	active,
	scale,
	tx,
	ty,
	sy,
	width,
	height,
	onSize
}: {
	i: number;
	source: ImageSource;
	page: SharedValue<number>;
	active: SharedValue<number>;
	scale: SharedValue<number>;
	tx: SharedValue<number>;
	ty: SharedValue<number>;
	sy: SharedValue<number>;
	width: number;
	height: number;
	onSize: (size: Size) => void;
}) {
	const style = useAnimatedStyle(() => {
		const current = active.value === i;
		return {
			transform: [
				{ translateX: (i - page.value) * (width + GAP) + (current ? tx.value : 0) },
				{ translateY: current ? ty.value + sy.value : 0 },
				{ scale: current ? scale.value : 1 }
			]
		};
	});
	return (
		<Animated.View style={[{ position: 'absolute', top: 0, left: 0, width, height }, style]}>
			<Image
				source={source}
				style={{ flex: 1 }}
				contentFit="contain"
				onLoad={(e) => onSize({ width: e.source.width, height: e.source.height })}
				accessibilityLabel={`Image ${i + 1}`}
			/>
		</Animated.View>
	);
}
