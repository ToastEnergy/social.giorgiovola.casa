<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Crop from '@lucide/svelte/icons/crop';
	import Brush from '@lucide/svelte/icons/brush';
	import Type from '@lucide/svelte/icons/type';
	import RotateCwSquare from '@lucide/svelte/icons/rotate-cw-square';
	import Trash from '@lucide/svelte/icons/trash';
	import Download from '@lucide/svelte/icons/download';
	import { flushSync } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { photoEditor, closeEditor } from '#lib/photoEditor.svelte.js';
	import Button from './Button.svelte';

	/** the server shrinks post images to this anyway (POST_IMAGE_SIZE), so editing more is waste */
	const MAX_SIDE = 2048;
	/** smallest crop, in image pixels */
	const MIN_CROP = 32;
	/** space around the image, so the crop handles on its edges stay grabbable */
	const PAD = 16;
	/** how far from a crop edge (screen pixels) a finger still grabs it */
	const GRAB = 28;
	const HISTORY = 20;
	/** caption font size limits, as a share of the image width */
	const MIN_TEXT = 0.03;
	const MAX_TEXT = 0.4;

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
	/** brush widths, in screen pixels at the zoom the image is shown at */
	const BRUSHES = [4, 9, 18];
	const ASPECTS: [string, number | null][] = [
		['Free', null],
		['1:1', 1],
		['4:5', 4 / 5],
		['16:9', 16 / 9]
	];

	type Tool = 'crop' | 'draw' | null;
	type Rect = { x: number; y: number; w: number; h: number };
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
	/** the state before an edit; canvas is only kept when the edit changed the pixels */
	type Entry = { canvas?: HTMLCanvasElement; captions: Caption[] };

	let canvas: HTMLCanvasElement | null = $state.raw(null);
	let captions: Caption[] = $state([]);
	let history: Entry[] = $state.raw([]);
	/** edits not undone; can outgrow history, which keeps only the last ones */
	let edits = $state(0);
	let tool: Tool = $state(null);
	let color = $state(COLORS[0]);
	let brush = $state(1);
	let crop: Rect = $state({ x: 0, y: 0, w: 0, h: 0 });
	let aspect: number | null = $state(null);
	let error: string | null = $state(null);
	let saving = $state(false);
	/** the caption being typed; id is null for a new one */
	let typing: { id: number | null; text: string; color: string; bg: boolean; size: number } | null =
		$state(null);
	let field: HTMLTextAreaElement | undefined = $state();
	let nextId = 1;

	let stageW = $state(0);
	let stageH = $state(0);
	let stage: HTMLDivElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();

	const open = $derived(photoEditor.file !== null);

	// the image fitted into the stage: position and size on screen, k = screen px per image px
	const box = $derived.by(() => {
		if (!canvas || !stageW || !stageH) return null;
		const k = Math.min(
			Math.max(stageW - 2 * PAD, 1) / canvas.width,
			Math.max(stageH - 2 * PAD, 1) / canvas.height
		);
		const w = canvas.width * k;
		const h = canvas.height * k;
		return { left: (stageW - w) / 2, top: (stageH - h) / 2, w, h, k };
	});

	afterNavigate(() => {
		if (open) closeEditor(null);
	});

	// a new image: start over
	$effect(() => {
		const file = photoEditor.file;
		if (!file) return;
		let cancelled = false;
		canvas = null;
		captions = [];
		history = [];
		edits = 0;
		tool = null;
		typing = null;
		error = null;
		saving = false;
		load(file)
			.then((c) => {
				if (!cancelled) canvas = c;
			})
			.catch(() => {
				if (!cancelled) error = 'Could not open this image.';
			});
		return () => {
			cancelled = true;
		};
	});

	// the page behind doesn't scroll under the editor
	$effect(() => {
		if (!open) return;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = overflow;
		};
	});

	// canvases are swapped on crop, rotate and undo; the element shown is the current one
	$effect(() => {
		// eslint-disable-next-line svelte/no-dom-manipulating -- host has no svelte-managed children
		if (host && canvas) host.replaceChildren(canvas);
	});

	async function load(file: File) {
		// an <img> applies the EXIF orientation, which phone photos rely on
		const url = URL.createObjectURL(file);
		try {
			const img = new Image();
			img.src = url;
			await img.decode();
			const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
			const c = blank(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
			c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
			return c;
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	function blank(w: number, h: number) {
		const c = document.createElement('canvas');
		c.width = Math.max(1, w);
		c.height = Math.max(1, h);
		c.className = 'block size-full';
		return c;
	}

	function copy(c: HTMLCanvasElement) {
		const out = blank(c.width, c.height);
		out.getContext('2d')!.drawImage(c, 0, 0);
		return out;
	}

	/** saves the state before an edit; pass the canvas when the edit replaces or paints over it */
	function remember(old?: HTMLCanvasElement) {
		history = [...history, { canvas: old, captions: $state.snapshot(captions) }].slice(-HISTORY);
		edits++;
	}

	function undo() {
		const entry = history.at(-1);
		if (!entry) return;
		history = history.slice(0, -1);
		edits--;
		if (entry.canvas) canvas = entry.canvas;
		captions = entry.captions;
		if (tool === 'crop') resetCrop();
	}

	function pick(next: Tool) {
		if (tool === 'crop') applyCrop();
		tool = tool === next ? null : next;
		if (tool === 'crop') resetCrop();
	}

	// moves captions along when the image under them changes; f maps a point in image pixels
	function moveCaptions(
		oldW: number,
		oldH: number,
		newW: number,
		newH: number,
		f: (x: number, y: number) => [number, number],
		turn = 0
	) {
		captions = captions.map((c) => {
			const [x, y] = f(c.x * oldW, c.y * oldH);
			return {
				...c,
				x: clamp(x / newW, 0, 1),
				y: clamp(y / newH, 0, 1),
				size: (c.size * oldW) / newW,
				rot: c.rot + turn
			};
		});
	}

	// crop

	function resetCrop() {
		if (!canvas) return;
		crop = { x: 0, y: 0, w: canvas.width, h: canvas.height };
		if (aspect) fitAspect(aspect);
	}

	function fitAspect(a: number | null) {
		aspect = a;
		if (!a) return;
		const w = Math.min(crop.w, crop.h * a);
		const h = w / a;
		crop = { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h };
	}

	function applyCrop() {
		if (!canvas) return;
		const x = Math.round(crop.x);
		const y = Math.round(crop.y);
		const w = Math.round(crop.w);
		const h = Math.round(crop.h);
		if (x === 0 && y === 0 && w === canvas.width && h === canvas.height) return;
		const old = canvas;
		const next = blank(w, h);
		next.getContext('2d')!.drawImage(old, x, y, w, h, 0, 0, w, h);
		remember(old);
		moveCaptions(old.width, old.height, w, h, (px, py) => [px - x, py - y]);
		canvas = next;
	}

	function rotate() {
		if (!canvas) return;
		applyCrop();
		const old = canvas!;
		const next = blank(old.height, old.width);
		const ctx = next.getContext('2d')!;
		ctx.translate(next.width, 0);
		ctx.rotate(Math.PI / 2);
		ctx.drawImage(old, 0, 0);
		remember(old);
		moveCaptions(
			old.width,
			old.height,
			next.width,
			next.height,
			(px, py) => [old.height - py, px],
			Math.PI / 2
		);
		canvas = next;
		resetCrop();
	}

	type CropDrag = {
		id: number;
		start: Rect;
		px: number;
		py: number;
		l: boolean;
		r: boolean;
		t: boolean;
		b: boolean;
	};
	let cropDrag: CropDrag | null = null;

	function cropDown(e: PointerEvent) {
		if (cropDrag || !box || !canvas) return;
		const [px, py] = toImage(e);
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
		capture(e);
		cropDrag = { id: e.pointerId, start: { ...c }, px, py, l, r, t, b };
	}

	function cropMove(e: PointerEvent) {
		const d = cropDrag;
		if (!d || e.pointerId !== d.id || !canvas) return;
		const [px, py] = toImage(e);
		const dx = px - d.px;
		const dy = py - d.py;
		const s = d.start;
		const W = canvas.width;
		const H = canvas.height;
		if (!d.l && !d.r && !d.t && !d.b) {
			crop = { ...s, x: clamp(s.x + dx, 0, W - s.w), y: clamp(s.y + dy, 0, H - s.h) };
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
			crop = { x: d.l ? ax - w : ax, y: d.t ? ay - h : ay, w, h };
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
		crop = { x, y, w, h };
	}

	function cropUp(e: PointerEvent) {
		if (cropDrag?.id === e.pointerId) cropDrag = null;
	}

	// brush

	type Stroke = { id: number; ctx: CanvasRenderingContext2D; last: [number, number]; mid: [number, number] };
	let stroke: Stroke | null = null;

	function drawDown(e: PointerEvent) {
		if (stroke || !canvas || !box) return;
		capture(e);
		remember(copy(canvas));
		const ctx = canvas.getContext('2d')!;
		ctx.strokeStyle = ctx.fillStyle = color;
		ctx.lineWidth = BRUSHES[brush] / box.k;
		ctx.lineCap = ctx.lineJoin = 'round';
		const p = toImage(e);
		// a tap leaves a dot
		ctx.beginPath();
		ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
		ctx.fill();
		stroke = { id: e.pointerId, ctx, last: p, mid: p };
	}

	function drawMove(e: PointerEvent) {
		const s = stroke;
		if (!s || e.pointerId !== s.id) return;
		// every point the finger passed since the last frame, for smooth fast strokes
		const events = e.getCoalescedEvents?.() ?? [];
		for (const ev of events.length ? events : [e]) {
			const p = toImage(ev);
			const mid: [number, number] = [(s.last[0] + p[0]) / 2, (s.last[1] + p[1]) / 2];
			s.ctx.beginPath();
			s.ctx.moveTo(s.mid[0], s.mid[1]);
			s.ctx.quadraticCurveTo(s.last[0], s.last[1], mid[0], mid[1]);
			s.ctx.stroke();
			s.last = p;
			s.mid = mid;
		}
	}

	function drawUp(e: PointerEvent) {
		const s = stroke;
		if (!s || e.pointerId !== s.id) return;
		s.ctx.beginPath();
		s.ctx.moveTo(s.mid[0], s.mid[1]);
		s.ctx.lineTo(s.last[0], s.last[1]);
		s.ctx.stroke();
		stroke = null;
	}

	function toImage(e: { clientX: number; clientY: number }): [number, number] {
		const r = stage!.getBoundingClientRect();
		return [(e.clientX - r.left - box!.left) / box!.k, (e.clientY - r.top - box!.top) / box!.k];
	}

	function down(e: PointerEvent) {
		if (tool === 'draw') drawDown(e);
		else if (tool === 'crop') cropDown(e);
		// captions are small: the second finger of a pinch usually lands next to the text
		else if (gesture) captionDown(e, gesture.caption);
	}

	function move(e: PointerEvent) {
		if (tool === 'draw') drawMove(e);
		else if (tool === 'crop') cropMove(e);
		else captionMove(e);
	}

	function up(e: PointerEvent) {
		if (tool === 'draw') drawUp(e);
		else if (tool === 'crop') cropUp(e);
		else captionUp(e);
	}

	// captions: drag to move, pinch (or the wheel) to resize, tap to edit, drop on the bin to delete

	type Gesture = {
		caption: Caption;
		pointers: Map<number, [number, number]>;
		/** where the current single finger drag or pinch started */
		from: [number, number];
		x: number;
		y: number;
		size: number;
		rot: number;
		dist: number;
		/** angle between the two fingers when the pinch started */
		angle: number;
		moved: boolean;
	};
	let gesture: Gesture | null = null;
	/** the caption being dragged, while the bin shows */
	let dragging: number | null = $state(null);
	let overBin = $state(false);

	const centre = (g: Gesture): [number, number] => {
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
	/** straight (and sideways) angles are sticky, so text is easy to put back level */
	const SNAP = 0.07;
	const snap = (rot: number) => {
		const right = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
		return Math.abs(rot - right) < SNAP ? right : rot;
	};
	// a finger was added or lifted: carry on from where things are now
	const restart = (g: Gesture) => {
		g.from = centre(g);
		g.x = g.caption.x;
		g.y = g.caption.y;
		g.size = g.caption.size;
		g.rot = g.caption.rot;
		g.dist = spread(g);
		g.angle = angle(g);
	};

	function captionDown(e: PointerEvent, caption: Caption) {
		if (tool) return;
		e.stopPropagation();
		// no mousedown after the tap, which would take the focus off the field a tap opens
		e.preventDefault();
		capture(e);
		const g: Gesture = gesture?.caption === caption
			? gesture
			: {
					caption,
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
		if (g.pointers.size >= 2) return;
		g.pointers.set(e.pointerId, [e.clientX, e.clientY]);
		restart(g);
		gesture = g;
	}

	function captionMove(e: PointerEvent) {
		const g = gesture;
		if (!g || !g.pointers.has(e.pointerId) || !box) return;
		g.pointers.set(e.pointerId, [e.clientX, e.clientY]);
		const [cx, cy] = centre(g);
		if (!g.moved && Math.hypot(cx - g.from[0], cy - g.from[1]) < 6 && g.pointers.size < 2) return;
		if (!g.moved) {
			g.moved = true;
			remember();
		}
		const c = captions.find((c) => c.id === g.caption.id);
		if (!c) return;
		c.x = clamp(g.x + (cx - g.from[0]) / box.w, 0, 1);
		c.y = clamp(g.y + (cy - g.from[1]) / box.h, 0, 1);
		if (g.pointers.size === 2 && g.dist > 0) {
			c.size = clamp((g.size * spread(g)) / g.dist, MIN_TEXT, MAX_TEXT);
			c.rot = snap(g.rot + angle(g) - g.angle);
		}
		const r = stage!.getBoundingClientRect();
		dragging = g.pointers.size === 1 ? c.id : null;
		overBin = !!dragging && cy > r.bottom - 70 && Math.abs(cx - (r.left + r.width / 2)) < 50;
	}

	function captionUp(e: PointerEvent) {
		const g = gesture;
		if (!g || !g.pointers.delete(e.pointerId)) return;
		if (g.pointers.size) return restart(g);
		gesture = null;
		dragging = null;
		if (overBin) captions = captions.filter((c) => c.id !== g.caption.id);
		else if (!g.moved) edit(g.caption);
		overBin = false;
	}

	function captionWheel(e: WheelEvent, caption: Caption) {
		const c = captions.find((c) => c.id === caption.id);
		if (c) c.size = clamp(c.size * Math.exp(-e.deltaY * 0.002), MIN_TEXT, MAX_TEXT);
	}

	function addCaption() {
		pick(null);
		startTyping({ id: null, text: '', color, bg: false, size: 0.08 });
	}

	function edit(c: Caption) {
		startTyping({ id: c.id, text: c.text, color: c.color, bg: c.bg, size: c.size });
	}

	// the field is focused within the tap itself: iOS only opens the keyboard for focus a user
	// gesture asked for, which rules out autofocus once rendering has moved on
	function startTyping(t: NonNullable<typeof typing>) {
		typing = t;
		flushSync();
		field?.focus();
		field?.setSelectionRange(t.text.length, t.text.length);
	}

	function finishTyping() {
		const t = typing;
		if (!t) return;
		typing = null;
		const text = t.text.replace(/\s+$/, '').replace(/^\n+/, '');
		const old = captions.find((c) => c.id === t.id);
		if (!old) {
			if (!text.trim()) return;
			remember();
			captions = [
				...captions,
				{ id: nextId++, text, x: 0.5, y: 0.5, size: t.size, rot: 0, color: t.color, bg: t.bg }
			];
			return;
		}
		if (!text.trim()) return deleteCaption(old.id);
		if (old.text === text && old.color === t.color && old.bg === t.bg && old.size === t.size)
			return;
		remember();
		Object.assign(old, { text, color: t.color, bg: t.bg, size: t.size });
	}

	function deleteCaption(id: number) {
		typing = null;
		remember();
		captions = captions.filter((c) => c.id !== id);
	}

	function setColor(c: string) {
		color = c;
		if (typing) typing.color = c;
	}

	/** black or white, whichever reads better on `hex` */
	function contrast(hex: string) {
		const n = parseInt(hex.slice(1), 16);
		const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
		return lum > 160 ? '#000000' : '#ffffff';
	}

	// the same box as the caption's element on screen: padding .15em .3em, line height 1.2
	function paintCaption(ctx: CanvasRenderingContext2D, c: Caption, W: number, H: number) {
		const px = c.size * W;
		ctx.font = `800 ${px}px "Manrope Variable", sans-serif`;
		const lines = c.text.split('\n');
		const lh = px * 1.2;
		const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 0.6 * px;
		const bh = lines.length * lh + 0.3 * px;
		const top = -bh / 2;
		ctx.save();
		ctx.translate(c.x * W, c.y * H);
		ctx.rotate(c.rot);
		if (c.bg) {
			ctx.fillStyle = c.color;
			ctx.beginPath();
			ctx.roundRect(-bw / 2, top, bw, bh, 0.2 * px);
			ctx.fill();
		}
		ctx.fillStyle = c.bg ? contrast(c.color) : c.color;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		lines.forEach((l, i) => ctx.fillText(l, 0, top + 0.15 * px + lh * (i + 0.5)));
		ctx.restore();
	}

	function cancel() {
		if (edits && !confirm('Discard your edits?')) return;
		closeEditor(null);
	}

	/** the edited image as a file, captions painted in; null when encoding failed */
	async function render(file: File): Promise<File | null> {
		const out = copy(canvas!);
		const ctx = out.getContext('2d')!;
		await document.fonts.load('800 40px "Manrope Variable"').catch(() => {});
		for (const c of captions) paintCaption(ctx, c, out.width, out.height);
		// pngs and webps may be transparent; everything else is a photo
		const png = file.type === 'image/png' || file.type === 'image/webp';
		const type = png ? 'image/png' : 'image/jpeg';
		const blob = await new Promise<Blob | null>((r) => out.toBlob(r, type, 0.92));
		if (!blob) return null;
		const name = (file.name.replace(/\.[^.]*$/, '') || 'image') + (png ? '.png' : '.jpg');
		return new File([blob], name, { type });
	}

	/** finishes what's in progress (the caption being typed, a pending crop) */
	function settle() {
		finishTyping();
		if (tool === 'crop') applyCrop();
		tool = null;
	}

	async function save() {
		const file = photoEditor.file;
		if (!canvas || !file || saving) return;
		settle();
		if (!edits) return closeEditor(null);
		saving = true;
		const out = await render(file);
		saving = false;
		if (!out) {
			error = 'Could not save the image.';
			return;
		}
		closeEditor(out);
	}

	/** saves the image to the device, without attaching it; the editor stays open */
	async function download() {
		const file = photoEditor.file;
		if (!canvas || !file || saving) return;
		settle();
		saving = true;
		// nothing changed: the original, at full size
		const out = edits ? await render(file) : file;
		saving = false;
		if (!out) {
			error = 'Could not save the image.';
			return;
		}
		// on phones the share sheet offers "Save Image" (to the photos), a download only reaches
		// the files app; it needs the tap to still count, so fall back to a download when it doesn't
		if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [out] })) {
			try {
				await navigator.share({ files: [out] });
				return;
			} catch (e) {
				if ((e as Error).name === 'AbortError') return;
			}
		}
		const url = URL.createObjectURL(out);
		const a = document.createElement('a');
		a.href = url;
		a.download = out.name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (typing) finishTyping();
			else cancel();
		} else if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !typing) {
			e.preventDefault();
			undo();
		}
	}

	// keeps a drag going when the finger leaves the stage; fails for a pointer already lifted
	const capture = (e: PointerEvent) => {
		try {
			stage?.setPointerCapture(e.pointerId);
		} catch {
			// the gesture still works inside the stage
		}
	};
	const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
	// grows the caption field with what's typed
	const rows = (text: string) => Math.max(1, text.split('\n').length);
</script>

<svelte:window {onkeydown} />

{#snippet swatches(active: string)}
	<div class="flex items-center gap-1.5">
		{#each COLORS as c}
			<button
				type="button"
				aria-label="Colour {c}"
				aria-pressed={active === c}
				class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 outline-none focus-visible:border-accent {active ===
				c
					? 'border-foreground'
					: 'border-transparent'}"
				onclick={() => setColor(c)}
			>
				<span class="size-5 rounded-full border border-line" style:background={c}></span>
			</button>
		{/each}
	</div>
{/snippet}

{#if open}
	<div
		data-modal-above
		role="dialog"
		aria-modal="true"
		aria-label="Edit image"
		class="fixed inset-0 z-1001 flex touch-none flex-col overscroll-contain bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground select-none"
	>
		<div class="flex h-14 shrink-0 items-center gap-2.5 px-2.5">
			<button
				type="button"
				class="flex size-11 cursor-pointer items-center justify-center outline-none focus-visible:text-accent"
				aria-label="Cancel"
				title="Cancel"
				onclick={cancel}><X size={24} strokeWidth={1.8} /></button
			>
			<span class="flex-1"></span>
			<button
				type="button"
				class="flex size-11 cursor-pointer items-center justify-center outline-none focus-visible:text-accent disabled:cursor-default disabled:opacity-30"
				aria-label="Undo"
				title="Undo"
				disabled={!history.length}
				onclick={undo}><Undo2 size={22} strokeWidth={1.8} /></button
			>
			<button
				type="button"
				class="flex size-11 cursor-pointer items-center justify-center outline-none focus-visible:text-accent disabled:cursor-default disabled:opacity-30"
				aria-label="Download"
				title="Download"
				disabled={!canvas || saving}
				onclick={download}><Download size={22} strokeWidth={1.8} /></button
			>
			<Button variant="primary" size="sm" class="px-5" disabled={!canvas || saving} onclick={save}
				>Done</Button
			>
		</div>

		{#if error}
			<p class="mx-2.5 rounded-[5px] bg-danger p-[5px] text-center">{error}</p>
		{/if}

		<div
			bind:this={stage}
			role="application"
			aria-label="Image"
			bind:clientWidth={stageW}
			bind:clientHeight={stageH}
			class="relative min-h-0 flex-1 overflow-hidden"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		>
			{#if canvas && box}
				<div
					class="absolute"
					style:left="{box.left}px"
					style:top="{box.top}px"
					style:width="{box.w}px"
					style:height="{box.h}px"
					style:cursor={tool === 'draw' ? 'crosshair' : undefined}
				>
					<div bind:this={host} class="absolute inset-0"></div>
					{#if tool !== 'crop'}
						{#each captions as c (c.id)}
							{#if c.id !== typing?.id}
								<div
									role="button"
									tabindex="-1"
									aria-label="Caption: {c.text}"
									class="absolute rounded-[0.2em] px-[0.3em] py-[0.15em] text-center leading-[1.2] font-extrabold whitespace-pre {tool
										? 'pointer-events-none'
										: 'cursor-move'} {dragging === c.id && overBin ? 'opacity-50' : ''}"
									style:left="{c.x * 100}%"
									style:top="{c.y * 100}%"
									style:translate="-50% -50%"
									style:rotate="{c.rot}rad"
									style:font-size="{c.size * box.w}px"
									style:color={c.bg ? contrast(c.color) : c.color}
									style:background={c.bg ? c.color : undefined}
									onpointerdown={(e) => captionDown(e, c)}
									onwheel={(e) => captionWheel(e, c)}
								>
									{c.text}
								</div>
							{/if}
						{/each}
					{/if}
					{#if tool === 'crop'}
						<div
							class="pointer-events-none absolute border border-foreground"
							style:outline="100vmax solid rgb(0 0 0 / 0.6)"
							style:left="{crop.x * box.k}px"
							style:top="{crop.y * box.k}px"
							style:width="{crop.w * box.k}px"
							style:height="{crop.h * box.k}px"
						>
							<!-- rule of thirds -->
							<div class="absolute inset-y-0 left-1/3 w-1/3 border-x border-foreground/40"></div>
							<div class="absolute inset-x-0 top-1/3 h-1/3 border-y border-foreground/40"></div>
							{#each ['-top-[3px] -left-[3px] border-t-4 border-l-4', '-top-[3px] -right-[3px] border-t-4 border-r-4', '-bottom-[3px] -left-[3px] border-b-4 border-l-4', '-right-[3px] -bottom-[3px] border-r-4 border-b-4'] as corner}
								<div class="absolute size-5 border-foreground {corner}"></div>
							{/each}
						</div>
					{/if}
				</div>
			{:else if !error}
				<p class="absolute inset-0 flex items-center justify-center text-muted">Loading…</p>
			{/if}
			{#if dragging !== null}
				<div
					class="pointer-events-none absolute bottom-2.5 left-1/2 flex size-12 -translate-x-1/2 items-center justify-center rounded-full border {overBin
						? 'border-danger bg-danger text-background'
						: 'border-line bg-black/70'}"
				>
					<Trash size={20} strokeWidth={1.8} />
				</div>
			{/if}
		</div>

		<!-- what the chosen tool offers -->
		<div class="flex h-14 shrink-0 items-center justify-center gap-2.5 overflow-x-auto px-2.5">
			{#if tool === 'draw'}
				{@render swatches(color)}
				<span class="h-6 border-l border-line"></span>
				{#each BRUSHES as size, i}
					<button
						type="button"
						aria-label="Brush size {i + 1}"
						aria-pressed={brush === i}
						class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border outline-none focus-visible:border-accent {brush ===
						i
							? 'border-accent'
							: 'border-transparent'}"
						onclick={() => (brush = i)}
					>
						<span class="rounded-full bg-foreground" style:width="{size}px" style:height="{size}px"
						></span>
					</button>
				{/each}
			{:else if tool === 'crop'}
				{#each ASPECTS as [label, a]}
					<button
						type="button"
						aria-pressed={aspect === a}
						class="h-8 shrink-0 cursor-pointer rounded-[5px] border px-2.5 text-[0.85em] outline-none focus-visible:border-accent {aspect ===
						a
							? 'border-accent text-accent'
							: 'border-transparent'}"
						onclick={() => {
							resetCrop();
							fitAspect(a);
						}}>{label}</button
					>
				{/each}
				<span class="h-6 border-l border-line"></span>
				<button
					type="button"
					class="flex size-8 shrink-0 cursor-pointer items-center justify-center outline-none focus-visible:text-accent"
					aria-label="Rotate"
					title="Rotate"
					onclick={rotate}><RotateCwSquare size={20} strokeWidth={1.8} /></button
				>
			{:else if captions.length}
				<p class="text-[0.85em] text-muted">Drag text to move it, pinch to resize and rotate, tap to edit</p>
			{/if}
		</div>

		<div class="flex h-16 shrink-0 items-stretch justify-around border-t border-line">
			{#each [['crop', 'Crop', Crop], ['draw', 'Draw', Brush]] as const as [id, label, Icon]}
				<button
					type="button"
					aria-pressed={tool === id}
					class="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 outline-none focus-visible:underline disabled:opacity-30 {tool ===
					id
						? 'text-accent'
						: ''}"
					disabled={!canvas}
					onclick={() => pick(id)}
				>
					<Icon size={22} strokeWidth={1.8} />
					<span class="text-[0.75em]">{label}</span>
				</button>
			{/each}
			<button
				type="button"
				class="flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 outline-none focus-visible:underline disabled:opacity-30"
				disabled={!canvas}
				onclick={addCaption}
			>
				<Type size={22} strokeWidth={1.8} />
				<span class="text-[0.75em]">Text</span>
			</button>
		</div>

		{#if typing}
			<!-- typing a caption: the controls sit on top, clear of the on-screen keyboard -->
			<div
				class="absolute inset-0 flex touch-auto flex-col gap-2.5 bg-black/80 px-2.5 pt-[env(safe-area-inset-top)]"
			>
				<div class="flex h-14 shrink-0 items-center gap-2.5">
					{#if typing.id !== null}
						{@const id = typing.id}
						<button
							type="button"
							class="flex size-11 cursor-pointer items-center justify-center outline-none hover:text-danger focus-visible:text-danger"
							aria-label="Delete text"
							title="Delete text"
							onclick={() => deleteCaption(id)}><Trash size={22} strokeWidth={1.8} /></button
						>
					{/if}
					<span class="flex-1"></span>
					<button
						type="button"
						aria-pressed={typing.bg}
						aria-label="Background"
						title="Background"
						class="flex size-11 cursor-pointer items-center justify-center outline-none focus-visible:text-accent"
						onclick={() => typing && (typing.bg = !typing.bg)}
					>
						<span
							class="flex size-7 items-center justify-center rounded-[5px] border-2 border-foreground font-extrabold {typing.bg
								? 'bg-foreground text-background'
								: ''}">A</span
						>
					</button>
					<Button variant="primary" size="sm" class="px-5" onclick={finishTyping}>Done</Button>
				</div>
				<div class="flex justify-center overflow-x-auto">{@render swatches(typing.color)}</div>
				<label class="mx-auto flex w-full max-w-80 items-center gap-2.5">
					<span class="text-[0.8em] font-extrabold" aria-hidden="true">A</span>
					<input
						type="range"
						class="flex-1 accent-accent"
						aria-label="Text size"
						min={MIN_TEXT}
						max={MAX_TEXT}
						step="0.005"
						bind:value={
							() => typing?.size ?? 0.08,
							(v) => {
								if (typing) typing.size = v;
							}
						}
					/>
					<span class="text-[1.4em] font-extrabold" aria-hidden="true">A</span>
				</label>
				<div class="flex flex-1 items-start justify-center overflow-y-auto pt-10">
					<textarea
						bind:this={field}
						bind:value={
							() => typing?.text ?? '',
							(v) => {
								if (typing) typing.text = v;
							}
						}
						rows={rows(typing.text)}
						placeholder="Type something"
						aria-label="Text"
						class="max-w-full resize-none rounded-[0.2em] px-[0.3em] py-[0.15em] text-center leading-[1.2] font-extrabold outline-none placeholder:text-foreground/40"
						style:field-sizing="content"
						style:font-size="{Math.max(16, typing.size * (box?.w ?? 360))}px"
						style:color={typing.bg ? contrast(typing.color) : typing.color}
						style:background={typing.bg ? typing.color : 'transparent'}
					></textarea>
				</div>
			</div>
		{/if}
	</div>
{/if}
