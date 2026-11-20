import { router } from 'expo-router';
import { X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useKnownProfiles } from '@/lib/profilesStore';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { pickProfile } from './overlays';
import { Avatar, IconButton, Txt } from './ui';

/**
 * Under the header of a screen shown as another profile of the account (`as`): who, a Change
 * button (the profile picker) and × (back to the profile in use). Nothing when `as` isn't
 * another profile of this account.
 */
export function ViewingAsBar({ as }: { as: string | null }) {
	const { me } = useSession();
	const profiles = useKnownProfiles();
	const profile = as ? profiles.find((p) => p.username === as) : null;
	if (!profile || profile.username === me?.user.username) return null;

	async function change() {
		const picked = await pickProfile({
			title: 'View as',
			profiles,
			current: profile?.username
		});
		if (picked) router.setParams({ as: picked === me?.user.username ? undefined : picked });
	}

	return (
		<View
			style={{
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				paddingHorizontal: 20,
				paddingVertical: 8,
				borderBottomWidth: 1,
				borderBottomColor: colors.line
			}}
		>
			<Avatar user={profile} size={24} />
			<Txt size={14} numberOfLines={1} style={{ flex: 1 }}>
				<Txt size={14} muted>
					Viewing as{' '}
				</Txt>
				<Txt size={14} bold>
					@{profile.username}
				</Txt>
			</Txt>
			{profiles.length > 1 ? (
				<Pressable accessibilityRole="button" hitSlop={8} onPress={change}>
					<Txt size={14} accent>
						Change
					</Txt>
				</Pressable>
			) : null}
			<IconButton label="Back to my profile" onPress={() => router.setParams({ as: undefined })}>
				<X size={18} color={colors.muted} />
			</IconButton>
		</View>
	);
}
