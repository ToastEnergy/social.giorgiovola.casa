import { Image, type ImageSource } from 'expo-image';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, FlatList, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { Button, Input, Txt } from './ui';

// the overlays every screen shares, mounted once in the root layout and driven from anywhere:
// a menu sheet, a text prompt, the image viewer and a toast

export type MenuItem = {
	label: string;
	icon?: React.ReactNode;
	danger?: boolean;
	onPress: () => void;
};

type MenuState = {
	items: MenuItem[];
	emojis?: { list: string[]; selected?: string | null; onPick: (emoji: string) => void };
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
	images: { sources: ImageSource[]; index: number } | null;
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
	emojis?: MenuState['emojis']
) => set({ menu: { items: items.filter((i): i is MenuItem => !!i), emojis } });

/** Asks for a line of text; null when cancelled. */
export const ask = (options: PromptOptions) =>
	new Promise<string | null>((resolve) => set({ prompt: { ...options, resolve } }));

export const viewImages = (sources: ImageSource[], index = 0) =>
	set({ images: { sources, index } });

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
									<Pressable
										key={emoji}
										accessibilityLabel={`React with ${emoji}`}
										onPress={() => {
											set({ menu: null });
											menu.emojis?.onPick(emoji);
										}}
										style={{
											width: 44,
											height: 44,
											alignItems: 'center',
											justifyContent: 'center',
											borderRadius: 5,
											backgroundColor:
												menu.emojis?.selected === emoji ? 'rgba(255,255,255,0.15)' : 'transparent'
										}}
									>
										<Txt size={24}>{emoji}</Txt>
									</Pressable>
								))}
							</View>
						) : null}
						<ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.6 }}>
							{menu?.items.map((item) => (
								<Pressable
									key={item.label}
									accessibilityRole="menuitem"
									onPress={() => {
										set({ menu: null });
										item.onPress();
									}}
									style={({ pressed }) => ({
										flexDirection: 'row',
										alignItems: 'center',
										gap: 10,
										padding: 12,
										borderRadius: 5,
										backgroundColor: pressed ? colors.hover : 'transparent'
									})}
								>
									{item.icon}
									<Txt style={item.danger ? { color: colors.danger } : undefined}>{item.label}</Txt>
								</Pressable>
							))}
						</ScrollView>
					</Pressable>
				</Pressable>
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
				<View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
					{images ? (
						<FlatList
							data={images.sources}
							horizontal
							pagingEnabled
							initialScrollIndex={images.index}
							getItemLayout={(_, index) => {
								const width = Dimensions.get('window').width;
								return { length: width, offset: width * index, index };
							}}
							keyExtractor={(_, index) => String(index)}
							showsHorizontalScrollIndicator={false}
							renderItem={({ item }) => (
								<Pressable
									onPress={() => set({ images: null })}
									style={{ width: Dimensions.get('window').width }}
								>
									<Image source={item} style={{ flex: 1 }} contentFit="contain" />
								</Pressable>
							)}
						/>
					) : null}
					<Pressable
						accessibilityLabel="Close"
						onPress={() => set({ images: null })}
						hitSlop={10}
						style={{ position: 'absolute', top: insets.top + 10, right: 15 }}
					>
						<X color={colors.foreground} size={28} />
					</Pressable>
				</View>
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
