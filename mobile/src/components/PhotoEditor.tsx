import { Image } from 'expo-image';
import { ImageManipulator, type ImageRef, SaveFormat } from 'expo-image-manipulator';
import * as Sharing from 'expo-sharing';
import { Brush, Crop, Download, RotateCwSquare, Trash, Type, Undo2, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
	ActivityIndicator,
	Alert,
	type GestureResponderEvent,
	Modal,
	type NativeTouchEvent,
	PixelRatio,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { colors, fonts } from '@/lib/theme';
import { Button, Txt } from './ui';

// the web app's photo editor (src/lib/components/PhotoEditor.svelte): crop (with fixed ratios) and
// rotate, draw, and text that can be moved, pinched, rotated and edited. Crops and turns are done
// by expo-image-manipulator; strokes and text stay vectors on top until saving, when the whole
// thing is drawn once at the image's size and captured with react-native-view-shot

export type EditableImage = { uri: string; mimeType?: string | null };

/** the server shrinks post images to this anyway (POST_IMAGE_SIZE), so editing more is waste */
const MAX_SIDE = 2048;
/** smallest crop, in image pixels */
const MIN_CROP = 32;
/** space around the image, so the crop handles on its edges stay grabbable */
const PAD = 16;
/** how far from a crop edge (screen points) a finger still grabs it */
const GRAB = 28;
const HISTORY = 20;
/** caption font size limits, as a share of the image width */
const MIN_TEXT = 0.03;
const MAX_TEXT = 0.4;
/** straight (and sideways) angles are sticky, so text is easy to put back level */
const SNAP = 0.07;

// colours painted into the image, so vivid ones rather than the theme's
const COLORS = [
	'#ffffff',
	'#000000',
	'#ff3b30',
	'#ff9500',
	'#ffcc00',
	'#34c759',
	'#0a84ff',
	'#af52de'
];
/** brush widths, in screen points at the zoom the image is shown at */
const BRUSHES = [4, 9, 18];
const ASPECTS: [string, number | null][] = [
	['Free', null],
	['1:1', 1],
	['4:5', 4 / 5],
	['16:9', 16 / 9]
];

type Tool = 'crop' | 'draw' | null;
type Rect = { x: number; y: number; w: number; h: number };
type Point = [number, number];
type Img = { ref: ImageRef; width: number; height: number };
/** a brush stroke, in image pixels */
type Stroke = { points: Point[]; color: string; width: number };
/**
 * a caption; x and y are its centre as a share of the image, size its font as a share of the
 * width, rot its rotation in radians
 */
type Caption = {
	id: number;
	text: string;
	x: number;
	y: number;
	size: number;
	rot: number;
	color: string;
	bg: boolean;
};
/** everything an edit changes, so undo is putting an older one back */
type Doc = { img: Img; strokes: Stroke[]; captions: Caption[] };
type Typing = { id: number | null; text: string; color: string; bg: boolean; size: number };

/** Formats the editor can open: animations would be flattened and SVGs don't decode to pixels. */
export function canEdit(image: EditableImage) {
	const type = image.mimeType ?? '';
	if (type) return type.startsWith('image/') && type !== 'image/gif' && type !== 'image/svg+xml';
	return !/\.(gif|svg)$/i.test(image.uri.split('?')[0]);
}

// pngs and webps may be transparent; everything else is a photo
const keepsAlpha = (image: EditableImage) =>
	image.mimeType === 'image/png' ||
	image.mimeType === 'image/webp' ||
	(!image.mimeType && /\.(png|webp)$/i.test(image.uri.split('?')[0]));

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** black or white, whichever reads better on `hex` */
function contrast(hex: string) {
	const n = parseInt(hex.slice(1), 16);
	const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
	return lum > 160 ? '#000000' : '#ffffff';
}

const snap = (rot: number) => {
	const right = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
	return Math.abs(rot - right) < SNAP ? right : rot;
};

const round = (n: number) => Math.round(n * 10) / 10;

/** a smoothed path through the points: from midpoint to midpoint, each point the curve's control */
function strokePath(points: Point[]) {
	let d = `M${round(points[0][0])} ${round(points[0][1])}`;
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1];
		const [bx, by] = points[i];
		d += ` Q${round(ax)} ${round(ay)} ${round((ax + bx) / 2)} ${round((ay + by) / 2)}`;
	}
	const [lx, ly] = points[points.length - 1];
	return `${d} L${round(lx)} ${round(ly)}`;
}

/** moves strokes and captions along when the image under them changes; f maps image pixels */
function moveDoc(d: Doc, img: Img, f: (p: Point) => Point, turn = 0): Doc {
	const { width: W, height: H } = d.img;
	return {
		img,
		strokes: d.strokes.map((s) => ({ ...s, points: s.points.map(f) })),
		captions: d.captions.map((c) => {
			const [x, y] = f([c.x * W, c.y * H]);
			return {
				...c,
				x: clamp(x / img.width, 0, 1),
				y: clamp(y / img.height, 0, 1),
				size: (c.size * W) / img.width,
				rot: c.rot + turn
			};
		})
	};
}

const toImg = (ref: ImageRef): Img => ({ ref, width: ref.width, height: ref.height });

async function cropDoc(d: Doc, crop: Rect): Promise<Doc> {
	const x = clamp(Math.round(crop.x), 0, d.img.width - 1);
	const y = clamp(Math.round(crop.y), 0, d.img.height - 1);
	const w = clamp(Math.round(crop.w), 1, d.img.width - x);
	const h = clamp(Math.round(crop.h), 1, d.img.height - y);
	if (x === 0 && y === 0 && w === d.img.width && h === d.img.height) return d;
	const ref = await ImageManipulator.manipulate(d.img.ref)
		.crop({ originX: x, originY: y, width: w, height: h })
		.renderAsync();
	return moveDoc(d, toImg(ref), ([px, py]) => [px - x, py - y]);
}

/** The strokes and captions over an image shown `width` points wide. */
function Overlay({
	doc,
	width,
	height,
	live,
	hidden,
	dim,
	onCaptionSize
}: {
	doc: Doc;
	width: number;
	height: number;
	live?: Stroke | null;
	hidden?: number | null;
	dim?: number | null;
	onCaptionSize?: (id: number, size: { width: number; height: number }) => void;
}) {
	const strokes = live ? [...doc.strokes, live] : doc.strokes;
	return (
		<>
			{strokes.length ? (
				<Svg
					pointerEvents="none"
					width={width}
					height={height}
					viewBox={`0 0 ${doc.img.width} ${doc.img.height}`}
					style={{ position: 'absolute', left: 0, top: 0 }}
				>
					{strokes.map((s, i) =>
						s.points.length === 1 ? (
							<Circle
								key={i}
								cx={s.points[0][0]}
								cy={s.points[0][1]}
								r={s.width / 2}
								fill={s.color}
							/>
						) : (
							<Path
								key={i}
								d={strokePath(s.points)}
								stroke={s.color}
								strokeWidth={s.width}
								strokeLinecap="round"
								strokeLinejoin="round"
								fill="none"
							/>
						)
					)}
				</Svg>
			) : null}
			{doc.captions.map((c) =>
				c.id === hidden ? null : (
					<CaptionView
						key={c.id}
						caption={c}
						width={width}
						height={height}
						dim={dim === c.id}
						onSize={onCaptionSize}
					/>
				)
			)}
		</>
	);
}

/** A caption centred on its point: the box is as wide as the text, padded .15em .3em. */
function CaptionView({
	caption: c,
	width,
	height,
	dim,
	onSize
}: {
	caption: Caption;
	width: number;
	height: number;
	dim?: boolean;
	onSize?: (id: number, size: { width: number; height: number }) => void;
}) {
	const px = c.size * width;
	// a wide, flat anchor around the point, so the text centres on it without wrapping
	const span = width * 4;
	return (
		<View
			pointerEvents="none"
			style={{
				position: 'absolute',
				left: c.x * width - span / 2,
				top: c.y * height,
				width: span,
				height: 0,
				alignItems: 'center',
				justifyContent: 'center',
				transform: [{ rotate: `${c.rot}rad` }],
				opacity: dim ? 0.5 : 1
			}}
		>
			<View
				onLayout={(e) => onSize?.(c.id, e.nativeEvent.layout)}
				style={{
					paddingHorizontal: 0.3 * px,
					paddingVertical: 0.15 * px,
					borderRadius: 0.2 * px,
					backgroundColor: c.bg ? c.color : 'transparent'
				}}
			>
				<Text
					style={{
						fontFamily: fonts.extrabold,
						fontSize: px,
						lineHeight: px * 1.2,
						color: c.bg ? contrast(c.color) : c.color,
						textAlign: 'center',
						includeFontPadding: false
					}}
				>
					{c.text}
				</Text>
			</View>
		</View>
	);
}

function Swatches({ active, onPick }: { active: string; onPick: (color: string) => void }) {
	return (
		<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
			{COLORS.map((c) => (
				<Pressable
					key={c}
					accessibilityLabel={`Colour ${c}`}
					accessibilityState={{ selected: active === c }}
					onPress={() => onPick(c)}
					style={{
						width: 32,
						height: 32,
						borderRadius: 16,
						borderWidth: 2,
						borderColor: active === c ? colors.foreground : 'transparent',
						alignItems: 'center',
						justifyContent: 'center'
					}}
				>
					<View
						style={{
							width: 20,
							height: 20,
							borderRadius: 10,
							borderWidth: 1,
							borderColor: colors.line,
							backgroundColor: c
						}}
					/>
				</Pressable>
			))}
		</View>
	);
}

/** A plain range slider: the core library has none. */
function Slider({
	value,
	min,
	max,
	onChange,
	label
}: {
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
	label: string;
}) {
	const [width, setWidth] = useState(0);
	const set = (e: GestureResponderEvent) => {
		if (width) onChange(min + clamp(e.nativeEvent.locationX / width, 0, 1) * (max - min));
	};
	const at = ((value - min) / (max - min)) * width;
	return (
		<View
			accessibilityRole="adjustable"
			accessibilityLabel={label}
			onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
			onStartShouldSetResponder={() => true}
			onResponderTerminationRequest={() => false}
			onResponderGrant={set}
			onResponderMove={set}
			style={{ flex: 1, height: 32, justifyContent: 'center' }}
		>
			<View pointerEvents="none" style={{ height: 2, backgroundColor: colors.line }}>
				<View style={{ width: at, height: 2, backgroundColor: colors.accent }} />
			</View>
			<View
				pointerEvents="none"
				style={{
					position: 'absolute',
					left: at - 9,
					width: 18,
					height: 18,
					borderRadius: 9,
					backgroundColor: colors.accent
				}}
			/>
		</View>
	);
}

/** A round icon button for the bars, like the web editor's. */
function Tap({
	label,
	onPress,
	disabled,
	children
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => ({
				width: 44,
				height: 44,
				alignItems: 'center',
				justifyContent: 'center',
				opacity: disabled ? 0.3 : pressed ? 0.6 : 1
			})}
		>
			{children}
		</Pressable>
	);
}

/**
 * The full screen editor. `onClose` gets the edited copy, or null when it was cancelled or left
 * unchanged.
 */
export function PhotoEditor({
	image,
	onClose
}: {
	image: EditableImage;
	onClose: (edited: EditableImage | null) => void;
}) {
	return (
		<Modal
			visible
			animationType="slide"
			presentationStyle="fullScreen"
			statusBarTranslucent
			onRequestClose={() => editorBack.current?.()}
		>
			<SafeAreaProvider>
				<Editor image={image} onClose={onClose} />
			</SafeAreaProvider>
		</Modal>
	);
}

// Android's back button reaches the modal, not the editor inside it
const editorBack: { current: (() => void) | null } = { current: null };

function Editor({
	image,
	onClose
}: {
	image: EditableImage;
	onClose: (edited: EditableImage | null) => void;
}) {
	const insets = useSafeAreaInsets();
	const [doc, setDoc] = useState<Doc | null>(null);
	const [history, setHistory] = useState<Doc[]>([]);
	/** edits not undone; can outgrow history, which keeps only the last ones */
	const [edits, setEdits] = useState(0);
	const [tool, setTool] = useState<Tool>(null);
	const [color, setColor] = useState(COLORS[0]);
	const [brush, setBrush] = useState(1);
	const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
	const [aspect, setAspect] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [typing, setTyping] = useState<Typing | null>(null);
	const [stage, setStage] = useState({ w: 0, h: 0 });
	/** the caption being dragged, while the bin shows */
	const [dragging, setDragging] = useState<number | null>(null);
	const [overBin, setOverBin] = useState(false);
	/** the stroke being drawn; a state too, for the redraw */
	const [live, setLive] = useState<Stroke | null>(null);
	/** what's drawn at the image's size to be captured when saving */
	const [flat, setFlat] = useState<Doc | null>(null);
	const flatView = useRef<React.ComponentRef<typeof View>>(null);
	const flatLoaded = useRef<(() => void) | null>(null);
	const nextId = useRef(1);
	const captionSizes = useRef(new Map<number, { width: number; height: number }>());
	const origin = useRef<Point>([0, 0]);

	useEffect(() => {
		let cancelled = false;
		// decoded no bigger than needed; the loader applies the EXIF orientation
		ImageManipulator.manipulate(image.uri, { maxWidth: MAX_SIDE, maxHeight: MAX_SIDE })
			.renderAsync()
			.then(async (ref) => {
				// in case the decoder only honoured one of the limits
				const k = MAX_SIDE / Math.max(ref.width, ref.height);
				if (k < 1)
					ref = await ImageManipulator.manipulate(ref)
						.resize({ width: Math.round(ref.width * k), height: Math.round(ref.height * k) })
						.renderAsync();
				if (!cancelled) setDoc({ img: toImg(ref), strokes: [], captions: [] });
			})
			.catch(() => {
				if (!cancelled) setError('Could not open this image.');
			});
		return () => {
			cancelled = true;
		};
	}, [image.uri]);

	// the image fitted into the stage: position and size on screen, k = points per image pixel
	const box = (() => {
		if (!doc || !stage.w || !stage.h) return null;
		const k = Math.min(
			Math.max(stage.w - 2 * PAD, 1) / doc.img.width,
			Math.max(stage.h - 2 * PAD, 1) / doc.img.height
		);
		const w = doc.img.width * k;
		const h = doc.img.height * k;
		return { left: (stage.w - w) / 2, top: (stage.h - h) / 2, w, h, k };
	})();

	/** puts `next` in place, keeping what was there for undo */
	function commit(next: Doc, before = doc) {
		if (!before || next === before) return;
		setHistory((h) => [...h, before].slice(-HISTORY));
		setEdits((e) => e + 1);
		setDoc(next);
	}

	function undo() {
		const entry = history.at(-1);
		if (!entry || busy) return;
		setHistory(history.slice(0, -1));
		setEdits((e) => e - 1);
		setDoc(entry);
		if (tool === 'crop') resetCrop(entry.img, aspect);
	}

	/** runs an image operation, one at a time */
	async function run<T>(f: () => Promise<T>): Promise<T | null> {
		if (busy) return null;
		setBusy(true);
		try {
			return await f();
		} catch {
			setError('Could not edit the image.');
			return null;
		} finally {
			setBusy(false);
		}
	}

	/** applies the crop being set, if the crop tool is open */
	async function settledDoc(): Promise<Doc | null> {
		if (!doc) return null;
		if (tool !== 'crop') return doc;
		const next = await cropDoc(doc, crop);
		commit(next);
		return next;
	}

	async function pick(next: Tool) {
		const d = await run(settledDoc);
		if (!d) return;
		const t = tool === next ? null : next;
		setTool(t);
		if (t === 'crop') resetCrop(d.img, aspect);
	}

	// crop

	function resetCrop(img: Img, a: number | null) {
		setCrop(fitAspect({ x: 0, y: 0, w: img.width, h: img.height }, a));
	}

	function fitAspect(c: Rect, a: number | null): Rect {
		if (!a) return c;
		const w = Math.min(c.w, c.h * a);
		const h = w / a;
		return { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
	}

	async function rotate() {
		await run(async () => {
			const d = await cropDoc(doc!, tool === 'crop' ? crop : full(doc!.img));
			const ref = await ImageManipulator.manipulate(d.img.ref).rotate(90).renderAsync();
			const H = d.img.height;
			const next = moveDoc(d, toImg(ref), ([px, py]) => [H - py, px], Math.PI / 2);
			commit(next);
			resetCrop(next.img, aspect);
		});
	}

	const full = (img: Img): Rect => ({ x: 0, y: 0, w: img.width, h: img.height });

	// gestures: the stage is the only touch target (everything on it ignores touches), so
	// positions come from the page coordinates less where the stage is

	type CropDrag = {
		id: string;
		start: Rect;
		p: Point;
		l: boolean;
		r: boolean;
		t: boolean;
		b: boolean;
	};
	type Gesture = {
		id: number;
		pointers: Map<string, Point>;
		/** where the current single finger drag or pinch started */
		from: Point;
		x: number;
		y: number;
		size: number;
		rot: number;
		dist: number;
		/** angle between the two fingers when the pinch started */
		angle: number;
		moved: boolean;
	};
	const cropDrag = useRef<CropDrag | null>(null);
	const stroke = useRef<{ id: string; stroke: Stroke } | null>(null);
	const gesture = useRef<Gesture | null>(null);

	const at = (t: NativeTouchEvent): Point => [
		t.pageX - origin.current[0],
		t.pageY - origin.current[1]
	];
	const toImage = ([x, y]: Point): Point => [(x - box!.left) / box!.k, (y - box!.top) / box!.k];

	function down(t: NativeTouchEvent) {
		if (!doc || !box) return;
		const id = String(t.identifier);
		const p = at(t);
		if (tool === 'draw') {
			if (stroke.current) return;
			const s: Stroke = { points: [toImage(p)], color, width: BRUSHES[brush] / box.k };
			stroke.current = { id, stroke: s };
			setLive(s);
		} else if (tool === 'crop') cropDown(id, toImage(p));
		else captionDown(id, p);
	}

	function move(touches: readonly NativeTouchEvent[]) {
		if (tool === 'draw') {
			const s = stroke.current;
			const t = s && touches.find((t) => String(t.identifier) === s.id);
			if (!s || !t || !box) return;
			const p = toImage(at(t));
			const last = s.stroke.points[s.stroke.points.length - 1];
			if (Math.hypot(p[0] - last[0], p[1] - last[1]) * box.k < 1) return;
			s.stroke = { ...s.stroke, points: [...s.stroke.points, p] };
			setLive(s.stroke);
		} else if (tool === 'crop') {
			const d = cropDrag.current;
			const t = d && touches.find((t) => String(t.identifier) === d.id);
			if (t) cropMove(toImage(at(t)));
		} else captionMove(touches);
	}

	function up(id: string) {
		if (stroke.current?.id === id) {
			const s = stroke.current.stroke;
			stroke.current = null;
			setLive(null);
			if (doc) commit({ ...doc, strokes: [...doc.strokes, s] });
		}
		if (cropDrag.current?.id === id) cropDrag.current = null;
		captionUp(id);
	}

	function cropDown(id: string, [px, py]: Point) {
		if (cropDrag.current || !box) return;
		const g = GRAB / box.k;
		const c = crop;
		const inY = py > c.y - g && py < c.y + c.h + g;
		const inX = px > c.x - g && px < c.x + c.w + g;
		let l = inY && Math.abs(px - c.x) < g;
		let r = inY && !l && Math.abs(px - (c.x + c.w)) < g;
		let t = inX && Math.abs(py - c.y) < g;
		let b = inX && !t && Math.abs(py - (c.y + c.h)) < g;
		// a fixed ratio is only resized from the corners
		if (aspect && !((l || r) && (t || b))) l = r = t = b = false;
		const inside = px > c.x && px < c.x + c.w && py > c.y && py < c.y + c.h;
		if (!l && !r && !t && !b && !inside) return;
		cropDrag.current = { id, start: { ...c }, p: [px, py], l, r, t, b };
	}

	function cropMove([px, py]: Point) {
		const d = cropDrag.current;
		if (!d || !doc) return;
		const dx = px - d.p[0];
		const dy = py - d.p[1];
		const s = d.start;
		const W = doc.img.width;
		const H = doc.img.height;
		if (!d.l && !d.r && !d.t && !d.b) {
			setCrop({ ...s, x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - s.h) });
			return;
		}
		if (aspect) {
			// the opposite corner stays put; the ratio follows whichever way the finger went further
			const ax = d.l ? s.x + s.w : s.x;
			const ay = d.t ? s.y + s.h : s.y;
			const wantW = d.l ? s.w - dx : s.w + dx;
			const wantH = d.t ? s.h - dy : s.h + dy;
			let w = Math.max(wantW, wantH * aspect);
			w = Math.min(w, d.l ? ax : W - ax, (d.t ? ay : H - ay) * aspect);
			w = Math.max(w, MIN_CROP * Math.max(1, aspect));
			const h = w / aspect;
			setCrop({ x: d.l ? ax - w : ax, y: d.t ? ay - h : ay, w, h });
			return;
		}
		let { x, y, w, h } = s;
		if (d.l) {
			x = clamp(s.x + dx, 0, s.x + s.w - MIN_CROP);
			w = s.x + s.w - x;
		} else if (d.r) w = clamp(s.w + dx, MIN_CROP, W - s.x);
		if (d.t) {
			y = clamp(s.y + dy, 0, s.y + s.h - MIN_CROP);
			h = s.y + s.h - y;
		} else if (d.b) h = clamp(s.h + dy, MIN_CROP, H - s.y);
		setCrop({ x, y, w, h });
	}

	// captions: drag to move, pinch to resize and rotate, tap to edit, drop on the bin to delete

	/** the caption under a point on the stage, the top one first */
	function captionAt([x, y]: Point) {
		if (!doc || !box) return null;
		for (const c of [...doc.captions].reverse()) {
			const size = captionSizes.current.get(c.id);
			if (!size) continue;
			const dx = x - (box.left + c.x * box.w);
			const dy = y - (box.top + c.y * box.h);
			// into the caption's own (unrotated) frame
			const u = dx * Math.cos(-c.rot) - dy * Math.sin(-c.rot);
			const v = dx * Math.sin(-c.rot) + dy * Math.cos(-c.rot);
			if (Math.abs(u) < size.width / 2 + 10 && Math.abs(v) < size.height / 2 + 10) return c;
		}
		return null;
	}

	const centre = (g: Gesture): Point => {
		const ps = [...g.pointers.values()];
		return [
			ps.reduce((s, p) => s + p[0], 0) / ps.length,
			ps.reduce((s, p) => s + p[1], 0) / ps.length
		];
	};
	const spread = (g: Gesture) => {
		const [a, b] = [...g.pointers.values()];
		return b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
	};
	const angle = (g: Gesture) => {
		const [a, b] = [...g.pointers.values()];
		return b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
	};
	// a finger was added or lifted: carry on from where things are now
	const restart = (g: Gesture, c: Caption) => {
		g.from = centre(g);
		g.x = c.x;
		g.y = c.y;
		g.size = c.size;
		g.rot = c.rot;
		g.dist = spread(g);
		g.angle = angle(g);
	};

	function captionDown(id: string, p: Point) {
		const g = gesture.current;
		// captions are small: the second finger of a pinch usually lands next to the text
		const c = g ? doc?.captions.find((c) => c.id === g.id) : captionAt(p);
		if (!c) return;
		const next: Gesture = g ?? {
			id: c.id,
			pointers: new Map(),
			from: [0, 0],
			x: 0,
			y: 0,
			size: 0,
			rot: 0,
			dist: 0,
			angle: 0,
			moved: false
		};
		if (next.pointers.size >= 2) return;
		next.pointers.set(id, p);
		restart(next, c);
		gesture.current = next;
	}

	function captionMove(touches: readonly NativeTouchEvent[]) {
		const g = gesture.current;
		if (!g || !box || !doc) return;
		for (const t of touches) {
			const id = String(t.identifier);
			if (g.pointers.has(id)) g.pointers.set(id, at(t));
		}
		const [cx, cy] = centre(g);
		if (!g.moved && Math.hypot(cx - g.from[0], cy - g.from[1]) < 6 && g.pointers.size < 2) return;
		if (!g.moved) {
			g.moved = true;
			commit({ ...doc });
		}
		const pinch = g.pointers.size === 2 && g.dist > 0;
		const x = clamp(g.x + (cx - g.from[0]) / box.w, 0, 1);
		const y = clamp(g.y + (cy - g.from[1]) / box.h, 0, 1);
		const size = pinch ? clamp((g.size * spread(g)) / g.dist, MIN_TEXT, MAX_TEXT) : null;
		const rot = pinch ? snap(g.rot + angle(g) - g.angle) : null;
		setDoc(
			(d) =>
				d && {
					...d,
					captions: d.captions.map((c) =>
						c.id === g.id ? { ...c, x, y, size: size ?? c.size, rot: rot ?? c.rot } : c
					)
				}
		);
		const single = g.pointers.size === 1;
		setDragging(single ? g.id : null);
		setOverBin(single && cy > stage.h - 70 && Math.abs(cx - stage.w / 2) < 50);
	}

	function captionUp(id: string) {
		const g = gesture.current;
		if (!g || !g.pointers.delete(id)) return;
		if (g.pointers.size) {
			const c = doc?.captions.find((c) => c.id === g.id);
			if (c) restart(g, c);
			return;
		}
		gesture.current = null;
		setDragging(null);
		setOverBin(false);
		const c = doc?.captions.find((c) => c.id === g.id);
		if (!c) return;
		// the move already saved the state before it for undo
		if (overBin) setDoc((d) => d && { ...d, captions: d.captions.filter((x) => x.id !== g.id) });
		else if (!g.moved)
			setTyping({ id: c.id, text: c.text, color: c.color, bg: c.bg, size: c.size });
	}

	async function addCaption() {
		const d = await run(settledDoc);
		if (!d) return;
		setTool(null);
		setTyping({ id: null, text: '', color, bg: false, size: 0.08 });
	}

	function finishTyping(): Doc | null {
		const t = typing;
		if (!t || !doc) return doc;
		setTyping(null);
		const text = t.text.replace(/\s+$/, '').replace(/^\n+/, '');
		const old = doc.captions.find((c) => c.id === t.id);
		let next = doc;
		if (!old) {
			if (!text.trim()) return doc;
			const caption = {
				id: nextId.current++,
				text,
				x: 0.5,
				y: 0.5,
				size: t.size,
				rot: 0,
				color: t.color,
				bg: t.bg
			};
			next = { ...doc, captions: [...doc.captions, caption] };
		} else if (!text.trim())
			next = { ...doc, captions: doc.captions.filter((c) => c.id !== old.id) };
		else if (old.text !== text || old.color !== t.color || old.bg !== t.bg || old.size !== t.size)
			next = {
				...doc,
				captions: doc.captions.map((c) =>
					c.id === old.id ? { ...c, text, color: t.color, bg: t.bg, size: t.size } : c
				)
			};
		commit(next);
		return next;
	}

	function deleteCaption(id: number) {
		setTyping(null);
		if (doc) commit({ ...doc, captions: doc.captions.filter((c) => c.id !== id) });
	}

	function pickColor(c: string) {
		setColor(c);
		if (typing) setTyping({ ...typing, color: c });
	}

	function cancel() {
		if (typing) return void finishTyping();
		if (!edits) return onClose(null);
		Alert.alert('Discard your edits?', undefined, [
			{ text: 'Keep editing', style: 'cancel' },
			{ text: 'Discard', style: 'destructive', onPress: () => onClose(null) }
		]);
	}
	useEffect(() => {
		editorBack.current = cancel;
		return () => {
			editorBack.current = null;
		};
	});

	/** finishes what's in progress (the caption being typed, a pending crop) */
	async function settle(): Promise<Doc | null> {
		const typed = finishTyping();
		if (!typed) return null;
		const next = tool === 'crop' ? await cropDoc(typed, crop) : typed;
		if (next !== typed) commit(next, typed);
		setTool(null);
		return next;
	}

	/** the edited image as a file; strokes and captions are drawn in by capturing them */
	async function render(d: Doc): Promise<EditableImage> {
		const png = keepsAlpha(image);
		if (!d.strokes.length && !d.captions.length) {
			const out = await d.img.ref.saveAsync({
				format: png ? SaveFormat.PNG : SaveFormat.JPEG,
				compress: 0.92
			});
			return { uri: out.uri, mimeType: png ? 'image/png' : 'image/jpeg' };
		}
		// drawn once at the image's own size, behind the editor, and captured when the image shows
		const loaded = new Promise<void>((resolve) => {
			flatLoaded.current = resolve;
			setTimeout(resolve, 3000);
		});
		setFlat(d);
		try {
			await loaded;
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			const ratio = PixelRatio.get();
			const uri = await captureRef(flatView, {
				format: png ? 'png' : 'jpg',
				quality: 0.92,
				result: 'tmpfile',
				width: d.img.width / ratio,
				height: d.img.height / ratio
			});
			return {
				uri: uri.startsWith('file://') ? uri : `file://${uri}`,
				mimeType: png ? 'image/png' : 'image/jpeg'
			};
		} finally {
			flatLoaded.current = null;
			setFlat(null);
		}
	}

	async function save() {
		const out = await run(async () => {
			const d = await settle();
			if (!d) return null;
			// nothing changed: the original stays
			return { file: edits || d !== doc ? await render(d) : null };
		});
		if (out) onClose(out.file);
	}

	/** saves the image to the device through the share sheet, without attaching it */
	async function download() {
		const out = await run(async () => {
			const d = await settle();
			if (!d) return null;
			// nothing changed: the original, at full size
			return edits || d !== doc ? await render(d) : image;
		});
		if (!out) return;
		await Sharing.shareAsync(out.uri, { mimeType: out.mimeType ?? undefined }).catch(() =>
			setError('Could not save the image.')
		);
	}

	const onTouch = (f: (t: NativeTouchEvent) => void) => (e: GestureResponderEvent) => {
		for (const t of e.nativeEvent.changedTouches) f(t);
	};

	const flatW = flat ? flat.img.width / PixelRatio.get() : 0;
	const flatH = flat ? flat.img.height / PixelRatio.get() : 0;

	return (
		<View style={{ flex: 1, backgroundColor: colors.background }}>
			{flat ? (
				<View
					ref={flatView}
					collapsable={false}
					pointerEvents="none"
					style={{ position: 'absolute', left: 0, top: 0, width: flatW, height: flatH }}
				>
					<Image
						source={flat.img.ref}
						style={{ width: flatW, height: flatH }}
						onLoad={() => flatLoaded.current?.()}
						onError={() => flatLoaded.current?.()}
					/>
					<Overlay doc={flat} width={flatW} height={flatH} />
				</View>
			) : null}
			<View
				style={{
					position: 'absolute',
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					backgroundColor: colors.background,
					paddingTop: insets.top,
					paddingBottom: insets.bottom
				}}
			>
				<View
					style={{
						height: 56,
						flexDirection: 'row',
						alignItems: 'center',
						gap: 10,
						paddingHorizontal: 10
					}}
				>
					<Tap label="Cancel" onPress={cancel}>
						<X size={24} strokeWidth={1.8} color={colors.foreground} />
					</Tap>
					<View style={{ flex: 1 }} />
					{busy ? <ActivityIndicator color={colors.accent} /> : null}
					<Tap label="Undo" onPress={undo} disabled={!history.length || busy}>
						<Undo2 size={22} strokeWidth={1.8} color={colors.foreground} />
					</Tap>
					<Tap label="Download" onPress={download} disabled={!doc || busy}>
						<Download size={22} strokeWidth={1.8} color={colors.foreground} />
					</Tap>
					<Button
						variant="primary"
						size="sm"
						label="Done"
						style={{ paddingHorizontal: 20 }}
						disabled={!doc || busy}
						onPress={save}
					/>
				</View>

				{error ? (
					<View
						style={{
							marginHorizontal: 10,
							borderRadius: 5,
							backgroundColor: colors.danger,
							padding: 5
						}}
					>
						<Txt style={{ textAlign: 'center' }}>{error}</Txt>
					</View>
				) : null}

				<View
					accessibilityLabel="Image"
					onLayout={(e) =>
						setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
					}
					style={{ flex: 1, overflow: 'hidden' }}
					onStartShouldSetResponder={() => !!doc && !busy && !typing}
					onResponderTerminationRequest={() => false}
					onResponderGrant={(e) => {
						// the first touch lands on the stage itself, so its location is relative to it
						const n = e.nativeEvent;
						origin.current = [n.pageX - n.locationX, n.pageY - n.locationY];
					}}
					onResponderStart={onTouch(down)}
					onResponderMove={(e) => move(e.nativeEvent.touches)}
					onResponderEnd={onTouch((t) => up(String(t.identifier)))}
					onResponderTerminate={onTouch((t) => up(String(t.identifier)))}
				>
					{doc && box ? (
						<View
							pointerEvents="none"
							style={{
								position: 'absolute',
								left: box.left,
								top: box.top,
								width: box.w,
								height: box.h
							}}
						>
							<Image source={doc.img.ref} style={{ width: box.w, height: box.h }} />
							{tool === 'crop' ? null : (
								<Overlay
									doc={doc}
									width={box.w}
									height={box.h}
									live={live}
									hidden={typing?.id}
									dim={overBin ? dragging : null}
									onCaptionSize={(id, size) => captionSizes.current.set(id, size)}
								/>
							)}
							{tool === 'crop' ? <CropFrame crop={crop} k={box.k} w={box.w} h={box.h} /> : null}
						</View>
					) : !error ? (
						<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
							<Txt muted>Loading…</Txt>
						</View>
					) : null}
					{dragging !== null ? (
						<View
							pointerEvents="none"
							style={{
								position: 'absolute',
								bottom: 10,
								left: stage.w / 2 - 24,
								width: 48,
								height: 48,
								borderRadius: 24,
								borderWidth: 1,
								alignItems: 'center',
								justifyContent: 'center',
								borderColor: overBin ? colors.danger : colors.line,
								backgroundColor: overBin ? colors.danger : 'rgba(0,0,0,0.7)'
							}}
						>
							<Trash
								size={20}
								strokeWidth={1.8}
								color={overBin ? colors.background : colors.foreground}
							/>
						</View>
					) : null}
				</View>

				{/* what the chosen tool offers */}
				<ScrollView
					horizontal
					showsHorizontalScrollIndicator={false}
					style={{ height: 56, flexGrow: 0 }}
					contentContainerStyle={{
						flexGrow: 1,
						alignItems: 'center',
						justifyContent: 'center',
						gap: 10,
						paddingHorizontal: 10
					}}
				>
					{tool === 'draw' ? (
						<>
							<Swatches active={color} onPick={pickColor} />
							<View style={{ height: 24, borderLeftWidth: 1, borderColor: colors.line }} />
							{BRUSHES.map((size, i) => (
								<Pressable
									key={size}
									accessibilityLabel={`Brush size ${i + 1}`}
									accessibilityState={{ selected: brush === i }}
									onPress={() => setBrush(i)}
									style={{
										width: 32,
										height: 32,
										borderRadius: 5,
										borderWidth: 1,
										borderColor: brush === i ? colors.accent : 'transparent',
										alignItems: 'center',
										justifyContent: 'center'
									}}
								>
									<View
										style={{
											width: size,
											height: size,
											borderRadius: size / 2,
											backgroundColor: colors.foreground
										}}
									/>
								</Pressable>
							))}
						</>
					) : tool === 'crop' ? (
						<>
							{ASPECTS.map(([label, a]) => (
								<Pressable
									key={label}
									accessibilityState={{ selected: aspect === a }}
									onPress={() => {
										if (!doc) return;
										setAspect(a);
										resetCrop(doc.img, a);
									}}
									style={{
										height: 32,
										paddingHorizontal: 10,
										borderRadius: 5,
										borderWidth: 1,
										borderColor: aspect === a ? colors.accent : 'transparent',
										justifyContent: 'center'
									}}
								>
									<Txt size={14} style={aspect === a ? { color: colors.accent } : undefined}>
										{label}
									</Txt>
								</Pressable>
							))}
							<View style={{ height: 24, borderLeftWidth: 1, borderColor: colors.line }} />
							<Tap label="Rotate" onPress={rotate} disabled={busy}>
								<RotateCwSquare size={20} strokeWidth={1.8} color={colors.foreground} />
							</Tap>
						</>
					) : doc?.captions.length ? (
						<Txt size={14} muted>
							Drag text to move it, pinch to resize and rotate, tap to edit
						</Txt>
					) : null}
				</ScrollView>

				<View
					style={{ height: 64, flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line }}
				>
					{(
						[
							['crop', 'Crop', Crop],
							['draw', 'Draw', Brush]
						] as const
					).map(([id, label, Icon]) => (
						<Pressable
							key={id}
							accessibilityRole="button"
							accessibilityState={{ selected: tool === id, disabled: !doc }}
							disabled={!doc || busy}
							onPress={() => pick(id)}
							style={{
								flex: 1,
								alignItems: 'center',
								justifyContent: 'center',
								gap: 4,
								opacity: doc ? 1 : 0.3
							}}
						>
							<Icon
								size={22}
								strokeWidth={1.8}
								color={tool === id ? colors.accent : colors.foreground}
							/>
							<Txt size={12} style={tool === id ? { color: colors.accent } : undefined}>
								{label}
							</Txt>
						</Pressable>
					))}
					<Pressable
						accessibilityRole="button"
						disabled={!doc || busy}
						onPress={addCaption}
						style={{
							flex: 1,
							alignItems: 'center',
							justifyContent: 'center',
							gap: 4,
							opacity: doc ? 1 : 0.3
						}}
					>
						<Type size={22} strokeWidth={1.8} color={colors.foreground} />
						<Txt size={12}>Text</Txt>
					</Pressable>
				</View>
			</View>

			{typing ? (
				// typing a caption: the controls sit on top, clear of the on-screen keyboard
				<View
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: 0,
						bottom: 0,
						backgroundColor: 'rgba(0,0,0,0.8)',
						paddingTop: insets.top,
						paddingHorizontal: 10,
						gap: 10
					}}
				>
					<View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
						{typing.id !== null ? (
							<Tap label="Delete text" onPress={() => deleteCaption(typing.id!)}>
								<Trash size={22} strokeWidth={1.8} color={colors.foreground} />
							</Tap>
						) : null}
						<View style={{ flex: 1 }} />
						<Pressable
							accessibilityRole="button"
							accessibilityLabel="Background"
							accessibilityState={{ selected: typing.bg }}
							onPress={() => setTyping({ ...typing, bg: !typing.bg })}
							style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
						>
							<View
								style={{
									width: 28,
									height: 28,
									borderRadius: 5,
									borderWidth: 2,
									borderColor: colors.foreground,
									backgroundColor: typing.bg ? colors.foreground : 'transparent',
									alignItems: 'center',
									justifyContent: 'center'
								}}
							>
								<Txt extrabold style={{ color: typing.bg ? colors.background : colors.foreground }}>
									A
								</Txt>
							</View>
						</Pressable>
						<Button
							variant="primary"
							size="sm"
							label="Done"
							style={{ paddingHorizontal: 20 }}
							onPress={finishTyping}
						/>
					</View>
					<ScrollView
						horizontal
						showsHorizontalScrollIndicator={false}
						style={{ flexGrow: 0 }}
						contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
					>
						<Swatches active={typing.color} onPick={pickColor} />
					</ScrollView>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							gap: 10,
							alignSelf: 'center',
							width: '100%',
							maxWidth: 320
						}}
					>
						<Txt extrabold size={13}>
							A
						</Txt>
						<Slider
							label="Text size"
							value={typing.size}
							min={MIN_TEXT}
							max={MAX_TEXT}
							onChange={(size) => setTyping((t) => t && { ...t, size })}
						/>
						<Txt extrabold size={22}>
							A
						</Txt>
					</View>
					<ScrollView
						keyboardShouldPersistTaps="handled"
						contentContainerStyle={{ alignItems: 'center', paddingTop: 40 }}
					>
						<TextInput
							autoFocus
							multiline
							value={typing.text}
							onChangeText={(text) => setTyping((t) => t && { ...t, text })}
							placeholder="Type something"
							placeholderTextColor="rgba(217,217,217,0.4)"
							accessibilityLabel="Text"
							selectionColor={colors.accent}
							style={{
								maxWidth: '100%',
								minWidth: 40,
								fontFamily: fonts.extrabold,
								fontSize: Math.max(16, typing.size * (box?.w ?? 360)),
								textAlign: 'center',
								color: typing.bg ? contrast(typing.color) : typing.color,
								backgroundColor: typing.bg ? typing.color : 'transparent',
								borderRadius: 5,
								paddingHorizontal: 8,
								paddingVertical: 4
							}}
						/>
					</ScrollView>
				</View>
			) : null}
		</View>
	);
}

/** The crop box over the image: dimmed outside, thirds inside, marked corners. */
function CropFrame({ crop, k, w, h }: { crop: Rect; k: number; w: number; h: number }) {
	const x = crop.x * k;
	const y = crop.y * k;
	const cw = crop.w * k;
	const ch = crop.h * k;
	const shade = 'rgba(0,0,0,0.6)';
	const corner = {
		position: 'absolute',
		width: 20,
		height: 20,
		borderColor: colors.foreground
	} as const;
	return (
		<View
			pointerEvents="none"
			style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}
		>
			<View
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: w,
					height: y,
					backgroundColor: shade
				}}
			/>
			<View
				style={{
					position: 'absolute',
					left: 0,
					top: y + ch,
					width: w,
					height: h - y - ch,
					backgroundColor: shade
				}}
			/>
			<View
				style={{
					position: 'absolute',
					left: 0,
					top: y,
					width: x,
					height: ch,
					backgroundColor: shade
				}}
			/>
			<View
				style={{
					position: 'absolute',
					left: x + cw,
					top: y,
					width: w - x - cw,
					height: ch,
					backgroundColor: shade
				}}
			/>
			<View
				style={{
					position: 'absolute',
					left: x,
					top: y,
					width: cw,
					height: ch,
					borderWidth: 1,
					borderColor: colors.foreground
				}}
			>
				{/* rule of thirds */}
				<View
					style={{
						position: 'absolute',
						top: 0,
						bottom: 0,
						left: '33.33%',
						width: '33.34%',
						borderLeftWidth: 1,
						borderRightWidth: 1,
						borderColor: 'rgba(217,217,217,0.4)'
					}}
				/>
				<View
					style={{
						position: 'absolute',
						left: 0,
						right: 0,
						top: '33.33%',
						height: '33.34%',
						borderTopWidth: 1,
						borderBottomWidth: 1,
						borderColor: 'rgba(217,217,217,0.4)'
					}}
				/>
				<View style={[corner, { top: -3, left: -3, borderTopWidth: 4, borderLeftWidth: 4 }]} />
				<View style={[corner, { top: -3, right: -3, borderTopWidth: 4, borderRightWidth: 4 }]} />
				<View
					style={[corner, { bottom: -3, left: -3, borderBottomWidth: 4, borderLeftWidth: 4 }]}
				/>
				<View
					style={[corner, { bottom: -3, right: -3, borderBottomWidth: 4, borderRightWidth: 4 }]}
				/>
			</View>
		</View>
	);
}
