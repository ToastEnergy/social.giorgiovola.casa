import { Image } from 'expo-image';
import { router } from 'expo-router';
import {
	ActivityIndicator,
	Pressable,
	Text,
	TextInput,
	View,
	type StyleProp,
	type TextInputProps,
	type TextProps,
	type TextStyle,
	type ViewStyle
} from 'react-native';
import { avatarImage } from '@/lib/api';
import { colors, fonts } from '@/lib/theme';
import type { User } from '@/lib/types';

type TxtProps = TextProps & {
	bold?: boolean;
	extrabold?: boolean;
	muted?: boolean;
	accent?: boolean;
	size?: number;
	dim?: number;
};

/** Text in the app's font and colour. Sizes follow the web app: 16 base, 14 secondary, 13 hints. */
export function Txt({ bold, extrabold, muted, accent, size = 16, dim, style, ...props }: TxtProps) {
	return (
		<Text
			{...props}
			style={[
				{
					fontFamily: extrabold ? fonts.extrabold : bold ? fonts.bold : fonts.medium,
					color: accent ? colors.accent : muted ? colors.muted : colors.foreground,
					fontSize: size,
					opacity: dim
				},
				style
			]}
		/>
	);
}

type ButtonProps = {
	label?: string;
	onPress?: () => void;
	variant?: 'default' | 'primary' | 'danger';
	size?: 'sm' | 'md' | 'lg';
	disabled?: boolean;
	loading?: boolean;
	style?: StyleProp<ViewStyle>;
	children?: React.ReactNode;
};

/** The web app's Button: green outline, filled for the main action, red for destructive ones. */
export function Button({
	label,
	onPress,
	variant = 'default',
	size = 'md',
	disabled,
	loading,
	style,
	children
}: ButtonProps) {
	const color = variant === 'danger' ? colors.danger : colors.accent;
	const filled = variant === 'primary';
	const height = size === 'sm' ? 32 : size === 'lg' ? 46 : 38;
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			disabled={disabled || loading}
			style={({ pressed }) => [
				{
					height,
					paddingHorizontal: size === 'sm' ? 10 : 15,
					borderRadius: 5,
					borderWidth: 1,
					borderColor: color,
					backgroundColor: filled || pressed ? color : 'transparent',
					alignItems: 'center',
					justifyContent: 'center',
					flexDirection: 'row',
					gap: 5,
					opacity: disabled ? 0.5 : 1
				},
				style
			]}
		>
			{({ pressed }) =>
				loading ? (
					<ActivityIndicator size="small" color={filled ? colors.background : color} />
				) : (
					children ?? (
						<Txt
							bold
							size={size === 'sm' ? 14 : 16}
							style={{
								color: filled || pressed ? colors.background : colors.foreground
							}}
						>
							{label}
						</Txt>
					)
				)
			}
		</Pressable>
	);
}

/** A field with only a bottom border, like the web app's `.input`. */
export function Input({ style, ...props }: React.ComponentProps<typeof TextInput>) {
	return (
		<TextInput
			placeholderTextColor={colors.muted}
			selectionColor={colors.accent}
			autoCapitalize="none"
			{...props}
			style={[
				{
					fontFamily: fonts.medium,
					fontSize: 16,
					color: colors.foreground,
					borderBottomWidth: 1,
					borderBottomColor: colors.line,
					paddingVertical: 8,
					paddingHorizontal: 0
				},
				style as StyleProp<TextStyle>
			]}
		/>
	);
}

/** A labelled form field. */
export function Field({
	label,
	hint,
	...props
}: TextInputProps & { label: string; hint?: string }) {
	return (
		<View>
			<Txt size={13} dim={0.8}>
				{label}
			</Txt>
			<Input {...props} />
			{hint ? (
				<Txt size={13} muted style={{ marginTop: 5 }}>
					{hint}
				</Txt>
			) : null}
		</View>
	);
}

export function ErrorBanner({ message }: { message: string | null | undefined }) {
	if (!message) return null;
	return (
		<View style={{ backgroundColor: colors.danger, borderRadius: 5, padding: 5 }}>
			<Txt style={{ color: '#fff' }}>{message}</Txt>
		</View>
	);
}

export function Notice({ children }: { children: React.ReactNode }) {
	return (
		<View style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 10 }}>
			<Txt size={14}>{children}</Txt>
		</View>
	);
}

export function Loading() {
	return (
		<View style={{ padding: 40, alignItems: 'center' }}>
			<ActivityIndicator color={colors.accent} />
		</View>
	);
}

export function Empty({ text }: { text: string }) {
	return (
		<Txt muted style={{ textAlign: 'center', padding: 40 }}>
			{text}
		</Txt>
	);
}

/** What a list shows instead of rows: the spinner, the error or the empty line. */
export function ListState({
	loading,
	error,
	empty
}: {
	loading: boolean;
	error?: string | null;
	empty: string;
}) {
	if (loading) return <Loading />;
	if (error)
		return (
			<View style={{ padding: 20 }}>
				<ErrorBanner message={error} />
			</View>
		);
	return <Empty text={empty} />;
}

export function Avatar({
	user,
	size = 45,
	link
}: {
	user: Pick<User, 'username' | 'avatar'>;
	size?: number;
	/** tapping opens the profile */
	link?: boolean;
}) {
	const image = (
		<Image
			source={avatarImage(user, size * 3)}
			style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#222' }}
			contentFit="cover"
			transition={100}
		/>
	);
	if (!link) return image;
	return (
		<Pressable
			onPress={() => router.push(`/user/${user.username}`)}
			accessibilityLabel={`@${user.username}`}
			// a row would stretch it to its height, and the space under the picture would open the profile
			style={{ alignSelf: 'flex-start' }}
		>
			{image}
		</Pressable>
	);
}

/** An underline tab row. */
export function TabRow<T extends string>({
	tabs,
	value,
	onChange
}: {
	tabs: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<View style={{ flexDirection: 'row' }}>
			{tabs.map((tab) => {
				const active = tab.value === value;
				return (
					<Pressable
						key={tab.value}
						onPress={() => onChange(tab.value)}
						accessibilityRole="tab"
						accessibilityState={{ selected: active }}
						style={{
							flex: 1,
							alignItems: 'center',
							paddingVertical: 10,
							borderBottomWidth: 2,
							borderBottomColor: active ? colors.accent : 'transparent',
							opacity: active ? 1 : 0.6
						}}
					>
						<Txt>{tab.label}</Txt>
					</Pressable>
				);
			})}
		</View>
	);
}

/** A person in a list: avatar, name, @username and whatever goes on the right. */
export function UserRow({
	user,
	subtitle,
	right,
	onPress
}: {
	user: User;
	subtitle?: string | null;
	right?: React.ReactNode;
	onPress?: () => void;
}) {
	return (
		<Pressable
			onPress={onPress ?? (() => router.push(`/user/${user.username}`))}
			style={({ pressed }) => ({
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				paddingVertical: 10,
				paddingHorizontal: 20,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			<Avatar user={user} size={40} />
			<View style={{ flex: 1 }}>
				<Txt bold numberOfLines={1}>
					{user.name}{' '}
					<Txt size={14} dim={0.7}>
						@{user.username}
					</Txt>
				</Txt>
				{subtitle ? (
					<Txt size={14} muted numberOfLines={2}>
						{subtitle}
					</Txt>
				) : null}
			</View>
			{right}
		</Pressable>
	);
}

export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
	return (
		<View style={{ marginBottom: 40, gap: 12 }}>
			{title ? (
				<Txt bold size={20}>
					{title}
				</Txt>
			) : null}
			{children}
		</View>
	);
}

export const Hint = ({ children }: { children: React.ReactNode }) => (
	<Txt size={13} muted>
		{children}
	</Txt>
);

/** An icon-only control. */
export function IconButton({
	label,
	onPress,
	onLongPress,
	children,
	style
}: {
	label: string;
	onPress?: () => void;
	onLongPress?: () => void;
	children: React.ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			hitSlop={8}
			onPress={onPress}
			onLongPress={onLongPress}
			style={({ pressed }) => [
				{ flexDirection: 'row', alignItems: 'center', gap: 5, opacity: pressed ? 0.6 : 1 },
				style
			]}
		>
			{children}
		</Pressable>
	);
}
