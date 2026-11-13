import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { ChevronRight } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import { Hint, Txt } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

const sections = [
	{ href: '/settings/profile', label: 'Profile', hint: 'Name, username, bio, picture, email' },
	{
		href: '/settings/accounts',
		label: 'Accounts & identities',
		hint: 'Extra profiles and who shares them'
	},
	{
		href: '/settings/notifications',
		label: 'Notifications',
		hint: 'Push notifications on this phone'
	},
	{
		href: '/settings/security',
		label: 'Security',
		hint: 'Password, passkeys, where you are signed in'
	},
	{ href: '/settings/developers', label: 'Developers', hint: 'Access tokens and bots' }
];

export default function Settings() {
	const { me, server } = useSession();
	return (
		<ScrollView contentContainerStyle={{ paddingVertical: 10 }}>
			<Stack.Screen options={{ title: 'Settings' }} />
			{sections.map((section) => (
				<Pressable
					key={section.href}
					onPress={() => router.push(section.href)}
					style={({ pressed }) => ({
						flexDirection: 'row',
						alignItems: 'center',
						paddingVertical: 14,
						paddingHorizontal: 20,
						backgroundColor: pressed ? colors.hover : 'transparent'
					})}
				>
					<View style={{ flex: 1 }}>
						<Txt bold>{section.label}</Txt>
						<Hint>{section.hint}</Hint>
					</View>
					<ChevronRight size={20} color={colors.muted} />
				</Pressable>
			))}
			<View style={{ padding: 20 }}>
				<Hint>
					Signed in to {server.replace(/^https?:\/\//, '')} as @
					{me?.account?.username ?? me?.user.username}.
				</Hint>
			</View>
		</ScrollView>
	);
}
