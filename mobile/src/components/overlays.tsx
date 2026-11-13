import type { ImageSource } from 'expo-image';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { ImageViewer } from './ImageViewer';
import { Button, Input, Txt } from './ui';

// the overlays every screen shares, mounted once in the root layout and driven from anywhere:
// a menu sheet, a text prompt, the image viewer and a toast

export type MenuItem = {
	label: string;
	icon?: React.ReactNode;
	danger?: boolean;
	onPress: () => void;
};

/** Where an element is on screen (window coordinates): a menu opens next to it, like on the web. */
export type MenuAnchor = { x: number; y: number; width: number; height: number; mine?: boolean };

type MenuState = {
	items: MenuItem[];
	emojis?: { list: string[]; selected?: string | null; onPick: (emoji: string) => void };
	anchor?: MenuAnchor;
};

type PromptOptions = {
	title: string;
	message?: string;
	placeholder?: string;
	initial?: string;
	secure?: boolean;
	confirm?: string;
	maxLength?: number;
};

type State = {
	menu: MenuState | null;
	prompt: (PromptOptions & { resolve: (value: string | null) => void }) | null;
	/** `key` is new on every open, so the viewer starts over */
	images: { sources: ImageSource[]; index: number; key: number } | null;
	toast: string | null;
};

let state: State = { menu: null, prompt: null, images: null, toast: null };
let listener: ((state: State) => void) | null = null;
const set = (patch: Partial<State>) => {
	state = { ...state, ...patch };
	listener?.(state);
};

export const showMenu = (
	items: (MenuItem | false | null | undefined)[],
	emojis?: MenuState['emojis'],
	anchor?: MenuAnchor
) => set({ menu: { items: items.filter((i): i is MenuItem => !!i), emojis, anchor } });

/** Asks for a line of text; null when cancelled. */
export const ask = (options: PromptOptions) =>
	new Promise<string | null>((resolve) => set({ prompt: { ...options, resolve } }));

let viewerKey = 0;
export const viewImages = (sources: ImageSource[], index = 0) =>
	set({ images: { sources, index, key: viewerKey++ } });

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
	clearTimeout(toastTimer);
	set({ toast: text });
	toastTimer = setTimeout(() => set({ toast: null }), 2500);
}

export const confirm = (title: string, message: string, label = 'OK', danger = false) =>
	new Promise<boolean>((resolve) =>
		Alert.alert(
			title,
			message,
			[
				{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
				{ text: label, style: danger ? 'destructive' : 'default', onPress: () => resolve(true) }
			],
			{ cancelable: true, onDismiss: () => resolve(false) }
		)
	);

export function Overlays() {
	const [current, setCurrent] = useState(state);
	const insets = useSafeAreaInsets();
	useEffect(() => {
		listener = setCurrent;
		return () => {
			listener = null;
		};
	}, []);
	const { menu, prompt, images, toast: toastText } = current;

	return (
		<>
			<Modal
				visible={!!menu}
				transparent
				animationType="fade"
				statusBarTranslucent
				navigationBarTranslucent
				onRequestClose={() => set({ menu: null })}
			>
				{menu?.anchor ? (
					<Popover menu={menu} anchor={menu.anchor} />
				) : (
					<Pressable
						style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
						onPress={() => set({ menu: null })}
					>
						<Pressable
							style={{
								backgroundColor: colors.background,
								borderTopWidth: 1,
								borderColor: colors.accent,
								borderTopLeftRadius: 10,
								borderTopRightRadius: 10,
								padding: 10,
								paddingBottom: insets.bottom + 10
							}}
						>
							{menu?.emojis ? (
								<View
									style={{
										flexDirection: 'row',
										justifyContent: 'space-around',
										paddingBottom: 10
									}}
								>
									{menu.emojis.list.map((emoji) => (
										<EmojiButton key={emoji} menu={menu} emoji={emoji} size={44} fontSize={24} />
									))}
								</View>
							) : null}
							<ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.6 }}>
								{menu?.items.map((item) => (
									<MenuRow key={item.label} item={item} padding={12} />
								))}
							</ScrollView>
						</Pressable>
					</Pressable>
				)}
			</Modal>

			{prompt ? <Prompt key={prompt.title} {...prompt} /> : null}

			<Modal
				visible={!!images}
				transparent
				animationType="fade"
				statusBarTranslucent
				navigationBarTranslucent
				onRequestClose={() => set({ images: null })}
			>
				{images ? (
					<ImageViewer
						key={images.key}
						sources={images.sources}
						initial={images.index}
						onClose={() => set({ images: null })}
					/>
				) : null}
			</Modal>

			{toastText ? (
				<View
					pointerEvents="none"
					style={{
						position: 'absolute',
						left: 20,
						right: 20,
						bottom: insets.bottom + 90,
						alignItems: 'center'
					}}
				>
					<View
						style={{
							backgroundColor: colors.background,
							borderWidth: 1,
							borderColor: colors.accent,
							borderRadius: 5,
							paddingVertical: 8,
							paddingHorizontal: 12
						}}
					>
						<Txt size={14}>{toastText}</Txt>
					</View>
				</View>
			) : null}
		</>
	);
}

function EmojiButton({
	menu,
	emoji,
	size,
	fontSize
}: {
	menu: MenuState;
	emoji: string;
	size: number;
	fontSize: number;
}) {
	return (
		<Pressable
			accessibilityLabel={`React with ${emoji}`}
			onPress={() => {
				set({ menu: null });
				menu.emojis?.onPick(emoji);
			}}
			style={{
				width: size,
				height: size,
				alignItems: 'center',
				justifyContent: 'center',
				borderRadius: 5,
				backgroundColor: menu.emojis?.selected === emoji ? 'rgba(121,154,116,0.3)' : 'transparent'
			}}
		>
			<Txt size={fontSize}>{emoji}</Txt>
		</Pressable>
	);
}

function MenuRow({
	item,
	padding,
	compact
}: {
	item: MenuItem;
	padding: number;
	compact?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="menuitem"
			onPress={() => {
				set({ menu: null });
				item.onPress();
			}}
			style={({ pressed }) => ({
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				padding,
				paddingVertical: compact ? 9 : padding,
				borderRadius: 5,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			{item.icon}
			<Txt
				size={compact ? 15 : undefined}
				style={item.danger ? { color: colors.danger } : undefined}
			>
				{item.label}
			</Txt>
		</Pressable>
	);
}

/**
 * The menu as a small box next to the element it belongs to, above it when there is room and
 * below it otherwise, lined up with the side the element hangs on (like the web chat).
 */
function Popover({ menu, anchor }: { menu: MenuState; anchor: MenuAnchor }) {
	const { width, height } = Dimensions.get('window');
	const above = anchor.y > 240;
	return (
		<Pressable style={{ flex: 1 }} onPress={() => set({ menu: null })}>
			<Pressable
				style={{
					position: 'absolute',
					top: above ? undefined : anchor.y + anchor.height + 5,
					bottom: above ? height - anchor.y + 5 : undefined,
					left: anchor.mine ? undefined : Math.max(10, anchor.x),
					right: anchor.mine ? Math.max(10, width - anchor.x - anchor.width) : undefined,
					maxWidth: width - 20,
					minWidth: 176,
					gap: 5,
					padding: 5,
					borderRadius: 5,
					borderWidth: 1,
					borderColor: colors.accent,
					backgroundColor: colors.background
				}}
			>
				{menu.emojis ? (
					<View
						style={{
							flexDirection: 'row',
							gap: 2,
							paddingBottom: 5,
							borderBottomWidth: 1,
							borderBottomColor: colors.line
						}}
					>
						{menu.emojis.list.map((emoji) => (
							<EmojiButton key={emoji} menu={menu} emoji={emoji} size={36} fontSize={21} />
						))}
					</View>
				) : null}
				{menu.items.map((item) => (
					<MenuRow key={item.label} item={item} padding={10} compact />
				))}
			</Pressable>
		</Pressable>
	);
}

function Prompt({
	title,
	message,
	placeholder,
	initial,
	secure,
	confirm: confirmLabel,
	maxLength,
	resolve
}: NonNullable<State['prompt']>) {
	const [value, setValue] = useState(initial ?? '');
	const done = (result: string | null) => {
		set({ prompt: null });
		resolve(result);
	};
	return (
		<Modal
			visible
			transparent
			animationType="fade"
			statusBarTranslucent
			navigationBarTranslucent
			onRequestClose={() => done(null)}
		>
			<Pressable
				style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: 120, padding: 20 }}
				onPress={() => done(null)}
			>
				<Pressable
					style={{
						backgroundColor: colors.background,
						borderWidth: 1,
						borderColor: colors.accent,
						borderRadius: 6,
						padding: 20,
						gap: 10
					}}
				>
					<Txt bold size={18}>
						{title}
					</Txt>
					{message ? (
						<Txt size={14} muted>
							{message}
						</Txt>
					) : null}
					<Input
						autoFocus
						value={value}
						onChangeText={setValue}
						placeholder={placeholder}
						secureTextEntry={secure}
						maxLength={maxLength}
						onSubmitEditing={() => done(value)}
					/>
					<View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
						<Button label="Cancel" onPress={() => done(null)} />
						<Button variant="primary" label={confirmLabel ?? 'OK'} onPress={() => done(value)} />
					</View>
				</Pressable>
			</Pressable>
		</Modal>
	);
}
