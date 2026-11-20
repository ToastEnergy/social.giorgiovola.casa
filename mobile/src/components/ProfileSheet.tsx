import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import type { User } from '@/lib/types';
import { Avatar, Txt } from './ui';

export type PickerProfile = Pick<User, 'username' | 'name' | 'avatar'>;

export type PickerOptions = {
	/** the question the list answers: "Posting as", "Like as…" */
	title: string;
	profiles: PickerProfile[];
	/** the one in use or shown (ticked) */
	current?: string | null;
	/** what each profile already did ("Liked"), by username; the rows wait for it */
	notes?: Promise<Record<string, string>>;
};

/** The account's profiles as a bottom sheet: pick the one to act as (posting, liking, following). */
export function ProfileSheet({
	title,
	profiles,
	current,
	notes,
	onClose
}: PickerOptions & { onClose: (username: string | null) => void }) {
	const insets = useSafeAreaInsets();
	const [done, setDone] = useState<Record<string, string> | null>(notes ? null : {});
	useEffect(() => {
		let stale = false;
		notes?.then((n) => !stale && setDone(n)).catch(() => !stale && setDone({}));
		return () => {
			stale = true;
		};
	}, [notes]);
	return (
		<Modal
			visible
			transparent
			animationType="fade"
			statusBarTranslucent
			navigationBarTranslucent
			onRequestClose={() => onClose(null)}
		>
			<Pressable
				style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
				onPress={() => onClose(null)}
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
					<Txt bold style={{ padding: 10 }}>
						{title}
					</Txt>
					<ScrollView style={{ maxHeight: Dimensions.get('window').height * 0.6 }}>
						{profiles.map((profile) => {
							const note = done?.[profile.username];
							const selected = profile.username === current;
							return (
								<Pressable
									key={profile.username}
									accessibilityRole="menuitem"
									accessibilityState={{ selected, disabled: !done }}
									disabled={!done}
									onPress={() => onClose(profile.username)}
									style={({ pressed }) => ({
										flexDirection: 'row',
										alignItems: 'center',
										gap: 10,
										padding: 10,
										borderRadius: 5,
										opacity: done ? 1 : 0.6,
										backgroundColor: pressed ? colors.hover : 'transparent'
									})}
								>
									<Avatar user={profile} size={36} />
									<View style={{ flex: 1 }}>
										<Txt bold numberOfLines={1}>
											{profile.name}
										</Txt>
										<Txt size={13} muted numberOfLines={1}>
											@{profile.username}
											{note ? ` · ${note}` : ''}
										</Txt>
									</View>
									{selected ? <Check size={18} color={colors.accent} /> : null}
								</Pressable>
							);
						})}
					</ScrollView>
				</Pressable>
			</Pressable>
		</Modal>
	);
}
