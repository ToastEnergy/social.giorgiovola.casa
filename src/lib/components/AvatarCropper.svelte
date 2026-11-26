<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import RotateCwSquare from '@lucide/svelte/icons/rotate-cw-square';
	import { afterPageChange, overlayEntry } from '#lib/history.svelte.js';
	import { avatarCropper, closeCropper } from '#lib/avatarCropper.svelte.js';
	import Button from './Button.svelte';

	/** the server stores avatars at this size (AVATAR_SIZE), so a bigger crop is waste */
	const OUT = 512;
	/** longest side kept of the picked image: enough to zoom in a long way */
	const MAX_SIDE = 2048;
	const MAX_ZOOM = 8;
	/** space around the crop circle */
	const PAD = 20;
	/** how far the arrow keys move the image, in screen pixels */
	const STEP = 10;

	let canvas: HTMLCanvasElement | null = $state.raw(null);
	/** 1 is the image just covering the circle */
	let zoom = $state(1);
	/** the image point at the centre of the circle, in image pixels */
	let cx = $state(0);
	let cy = $state(0);
	let error: string | null = $state(null);
	let saving = $state(false);

	let stageW = $state(0);
	let stageH = $state(0);
	let stage: HTMLDivElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();

	const open = $derived(avatarCropper.file !== null);

	// the crop square (the circle's bounds) on the stage, and screen px per image px
	const view = $derived.by(() => {
		if (!canvas || !stageW || !stageH) return null;
		const side = Math.max(Math.min(stageW, stageH) - 2 * PAD, 1);
		const k = (side / Math.min(canvas.width, canvas.height)) * zoom;
		return { side, left: (stageW - side) / 2, top: (stageH - side) / 2, k };
	});

	afterPageChange(() => {
		if (open) closeCropper(null);
	});
	overlayEntry(
		'avatar-cropper',
		() => open,
		() => closeCropper(null)
	);

	// a new image: start over, centred
	$effect(() => {
		const file = avatarCropper.file;
		if (!file) return;
		let cancelled = false;
		canvas = null;
		error = null;
		saving = false;
		load(file)
			.then((c) => {
				if (cancelled) return;
				zoom = 1;
				cx = c.width / 2;
				cy = c.height / 2;
				canvas = c;
			})
			.catch(() => {
				if (!cancelled) error = 'Could not open this image.';
			});
		return () => {
			cancelled = true;
		};
	});

	// the page behind doesn't scroll under the cropper
	$effect(() => {
		if (!open) return;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = overflow;
		};
	});

	// rotating swaps the canvas; the element shown is the current one
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

	/** keeps the circle covered by the image */
	function settle(z: number, x: number, y: number) {
		if (!canvas || !view) return;
		zoom = clamp(z, 1, MAX_ZOOM);
		const half = view.side / 2 / kAt(zoom);
		cx = clamp(x, half, canvas.width - half);
		cy = clamp(y, half, canvas.height - half);
	}

	/** screen px per image px at zoom z */
	const kAt = (z: number) => (view!.side / Math.min(canvas!.width, canvas!.height)) * z;

	/**
	 * moves and zooms so the image point under `from` (stage px) ends up under `to` at zoom `z`:
	 * a drag is a move at the same zoom, a pinch or a scroll also changes it
	 */
	function moveTo(from: [number, number], to: [number, number], z: number) {
		if (!view) return;
		const midX = view.left + view.side / 2;
		const midY = view.top + view.side / 2;
		const ix = cx + (from[0] - midX) / view.k;
		const iy = cy + (from[1] - midY) / view.k;
		const k = kAt(clamp(z, 1, MAX_ZOOM));
		settle(z, ix - (to[0] - midX) / k, iy - (to[1] - midY) / k);
	}

	function rotate() {
		if (!canvas) return;
		const old = canvas;
		const next = blank(old.height, old.width);
		const ctx = next.getContext('2d')!;
		ctx.translate(next.width, 0);
		ctx.rotate(Math.PI / 2);
		ctx.drawImage(old, 0, 0);
		const x = old.height - cy;
		const y = cx;
		canvas = next;
		settle(zoom, x, y);
	}

	// gestures: one pointer drags, two pinch

	const pointers = new Map<number, [number, number]>();

	function point(e: { clientX: number; clientY: number }): [number, number] {
		const r = stage!.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	}

	function down(e: PointerEvent) {
		if (!view || pointers.size >= 2) return;
		try {
			stage?.setPointerCapture(e.pointerId);
		} catch {
			// the gesture still works inside the stage
		}
		pointers.set(e.pointerId, point(e));
	}

	function move(e: PointerEvent) {
		const last = pointers.get(e.pointerId);
		if (!last) return;
		const p = point(e);
		if (pointers.size === 1) {
			pointers.set(e.pointerId, p);
			moveTo(last, p, zoom);
			return;
		}
		const [a, b] = [...pointers.values()];
		pointers.set(e.pointerId, p);
		const [a2, b2] = [...pointers.values()];
		const d0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
		const d1 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
		if (!d0) return;
		moveTo(
			[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
			[(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2],
			(zoom * d1) / d0
		);
	}

	function up(e: PointerEvent) {
		pointers.delete(e.pointerId);
	}

	function wheel(e: WheelEvent) {
		if (!view) return;
		e.preventDefault();
		// trackpad pinches arrive as wheel events with ctrlKey and small deltas
		const speed = e.ctrlKey ? 0.01 : 0.002;
		const p = point(e);
		moveTo(p, p, zoom * Math.exp(-e.deltaY * speed));
	}

	function cancel() {
		closeCropper(null);
	}

	async function save() {
		const file = avatarCropper.file;
		if (!canvas || !view || !file || saving) return;
		saving = true;
		const span = view.side / view.k;
		// no upscaling: a small crop stays small, the server doesn't enlarge it either
		const side = Math.max(1, Math.min(OUT, Math.round(span)));
		const out = blank(side, side);
		const ctx = out.getContext('2d')!;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(canvas, cx - span / 2, cy - span / 2, span, span, 0, 0, side, side);
		// pngs and webps may be transparent; everything else is a photo
		const png = file.type === 'image/png' || file.type === 'image/webp';
		const type = png ? 'image/png' : 'image/jpeg';
		const blob = await new Promise<Blob | null>((r) => out.toBlob(r, type, 0.92));
		saving = false;
		if (!blob) {
			error = 'Could not save the image.';
			return;
		}
		const name = (file.name.replace(/\.[^.]*$/, '') || 'avatar') + (png ? '.png' : '.jpg');
		closeCropper(new File([blob], name, { type }));
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
		} else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
			e.preventDefault();
			save();
		} else if (view && e.target instanceof HTMLElement && e.target.closest('[data-crop-stage]')) {
			const moves: Record<string, [number, number]> = {
				ArrowLeft: [-STEP, 0],
				ArrowRight: [STEP, 0],
				ArrowUp: [0, -STEP],
				ArrowDown: [0, STEP]
			};
			const m = moves[e.key];
			// the image follows the arrow
			if (m) settle(zoom, cx - m[0] / view.k, cy - m[1] / view.k);
			else if (e.key === '+' || e.key === '=') settle(zoom * 1.1, cx, cy);
			else if (e.key === '-') settle(zoom / 1.1, cx, cy);
			else return;
			e.preventDefault();
		}
	}

	const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
</script>

<svelte:window {onkeydown} />

{#if open}
	<div
		data-modal-above
		role="dialog"
		aria-modal="true"
		aria-label="Crop picture"
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
			<span class="flex-1 text-center font-bold">Move and scale</span>
			<Button variant="primary" size="sm" class="px-5" disabled={!canvas || saving} onclick={save}
				>Done</Button
			>
		</div>

		{#if error}
			<p class="mx-2.5 rounded-[5px] bg-danger p-[5px] text-center">{error}</p>
		{/if}

		<!-- focusable so the arrow keys and + / - move and zoom the picture -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div
			bind:this={stage}
			data-crop-stage
			role="application"
			aria-label="Picture: drag to move, pinch or scroll to zoom, arrow keys to move, + and - to zoom"
			tabindex="0"
			bind:clientWidth={stageW}
			bind:clientHeight={stageH}
			class="relative min-h-0 flex-1 cursor-move overflow-hidden outline-none"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			onwheel={wheel}
		>
			{#if canvas && view}
				<div
					bind:this={host}
					class="pointer-events-none absolute"
					style:left="{view.left + view.side / 2 - cx * view.k}px"
					style:top="{view.top + view.side / 2 - cy * view.k}px"
					style:width="{canvas.width * view.k}px"
					style:height="{canvas.height * view.k}px"
				></div>
				<!-- what stays: the circle, the rest dimmed -->
				<div
					class="pointer-events-none absolute rounded-full border border-foreground"
					style:outline="100vmax solid rgb(0 0 0 / 0.6)"
					style:left="{view.left}px"
					style:top="{view.top}px"
					style:width="{view.side}px"
					style:height="{view.side}px"
				></div>
			{:else if !error}
				<p class="absolute inset-0 flex items-center justify-center text-muted">Loading…</p>
			{/if}
		</div>

		<div class="flex h-16 shrink-0 items-center justify-center gap-2.5 border-t border-line px-2.5">
			<label class="flex w-full max-w-80 items-center gap-2.5">
				<ZoomOut size={20} strokeWidth={1.8} aria-hidden="true" />
				<input
					type="range"
					class="flex-1 accent-accent"
					aria-label="Zoom"
					min="1"
					max={MAX_ZOOM}
					step="0.01"
					disabled={!canvas}
					value={zoom}
					oninput={(e) => settle(e.currentTarget.valueAsNumber, cx, cy)}
				/>
				<ZoomIn size={20} strokeWidth={1.8} aria-hidden="true" />
			</label>
			<span class="h-6 border-l border-line"></span>
			<button
				type="button"
				class="flex size-11 shrink-0 cursor-pointer items-center justify-center outline-none focus-visible:text-accent disabled:cursor-default disabled:opacity-30"
				aria-label="Rotate"
				title="Rotate"
				disabled={!canvas}
				onclick={rotate}><RotateCwSquare size={22} strokeWidth={1.8} /></button
			>
		</div>
	</div>
{/if}
