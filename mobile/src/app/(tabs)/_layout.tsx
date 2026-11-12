import { router } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Bell, House, MessageCircle, Search, UserRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

// breathing room between the bar's top border and the icons; the bar grows by the same amount so
// the icons don't get pushed into the home indicator area
const TAB_BAR_PADDING_TOP = 8;

const badge = (count: number) => (count > 99 ? '99+' : count > 0 ? count : undefined);

export default function TabsLayout() {
	const { me, unread } = useSession();
	const insets = useSafeAreaInsets();
	return (
		<Tabs
			screenOptions={{
				headerStyle: { backgroundColor: colors.background },
				headerTintColor: colors.foreground,
				headerTitleStyle: { fontFamily: fonts.bold, fontSize: 20 },
				headerShadowVisible: false,
				tabBarStyle: {
					backgroundColor: colors.background,
					borderTopColor: colors.line,
					paddingTop: TAB_BAR_PADDING_TOP,
					height: 49 + TAB_BAR_PADDING_TOP + insets.bottom
				},
				tabBarActiveTintColor: colors.accent,
				tabBarInactiveTintColor: colors.foreground,
				tabBarShowLabel: false,
				tabBarBadgeStyle: {
					backgroundColor: colors.accent,
					color: colors.background,
					fontFamily: fonts.bold,
					fontSize: 11
				},
				sceneStyle: { backgroundColor: colors.background }
			}}
		>
			<Tabs.Screen
				name="index"
				options={{
					title: 'Home',
					tabBarAccessibilityLabel: 'Home',
					tabBarIcon: ({ color, focused }) => (
						<House size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
					)
				}}
			/>
			<Tabs.Screen
				name="search"
				options={{
					title: 'Search',
					tabBarAccessibilityLabel: 'Search',
					tabBarIcon: ({ color, focused }) => (
						<Search size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
					)
				}}
			/>
			<Tabs.Screen
				name="messages"
				options={{
					title: 'Messages',
					tabBarAccessibilityLabel: 'Messages',
					tabBarBadge: badge(unread.messages),
					tabBarIcon: ({ color, focused }) => (
						<MessageCircle size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
					)
				}}
			/>
			<Tabs.Screen
				name="notifications"
				options={{
					title: 'Notifications',
					tabBarAccessibilityLabel: 'Notifications',
					tabBarBadge: badge(unread.notifications),
					tabBarIcon: ({ color, focused }) => (
						<Bell size={24} color={color} strokeWidth={focused ? 2.5 : 2} />
					)
				}}
			/>
			<Tabs.Screen
				name="me"
				// like the website's avatar menu: a sheet with the profile switcher, not a page
				listeners={{
					tabPress: (e) => {
						e.preventDefault();
						router.push('/menu');
					}
				}}
				options={{
					title: 'You',
					tabBarAccessibilityLabel: 'Profile menu',
					tabBarIcon: ({ color }) =>
						me ? <Avatar user={me.user} size={28} /> : <UserRound size={24} color={color} />
				}}
			/>
		</Tabs>
	);
}
