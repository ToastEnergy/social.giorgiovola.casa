import { router } from 'expo-router';
import { Tabs } from 'expo-router/tabs';
import { Bell, House, MessageCircle, Search, UserRound } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toast } from '@/components/overlays';
import { Avatar } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { getHomePage, setHomePage, useHomePage } from '@/lib/homePage';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

// breathing room between the bar's top border and the icons; the bar grows by the same amount so
// the icons don't get pushed into the home indicator area
const TAB_BAR_PADDING_TOP = 8;

// with a profile to switch back to, a first tap on the avatar waits this long for a second one
// before opening the menu
const DOUBLE_TAP_MS = 250;

const badge = (count: number) => (count > 99 ? '99+' : count > 0 ? count : undefined);

export default function TabsLayout() {
	const { me, unread, canSwitchBack, switchBack } = useSession();
	// home and messages share the home tab (HomePager), so their icons follow its page
	const home = useHomePage();
	const homeActive = home.focused && home.page === 0;
	const messagesActive = home.focused && home.page === 1;
	const insets = useSafeAreaInsets();
	const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const switching = useRef(false);
	useEffect(() => () => clearTimeout(tapTimer.current ?? undefined), []);

	// one tap opens the profile menu, two switch straight back to the profile used before
	function onAvatarTap() {
		if (switching.current) return;
		if (!canSwitchBack) {
			router.push('/menu');
			return;
		}
		if (tapTimer.current) {
			clearTimeout(tapTimer.current);
			tapTimer.current = null;
			switching.current = true;
			switchBack()
				.then((username) => username && toast(`Switched to @${username}`))
				.catch((e) => toast(errorMessage(e)))
				.finally(() => (switching.current = false));
			return;
		}
		tapTimer.current = setTimeout(() => {
			tapTimer.current = null;
			router.push('/menu');
		}, DOUBLE_TAP_MS);
	}
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
				sceneStyle: { backgroundColor: colors.background },
				// tabs slide in from the side they sit on. native driven, like the default
				animation: 'shift',
				transitionSpec: {
					animation: 'timing',
					config: { duration: 200, easing: Easing.out(Easing.cubic) }
				}
			}}
		>
			<Tabs.Screen
				name="index"
				listeners={{
					// on the messages page, home slides back to the feed (instead of scrolling it to the top)
					tabPress: (e) => {
						const { page, focused } = getHomePage();
						if (page === 0) return;
						if (focused) e.preventDefault();
						setHomePage(0, focused);
					}
				}}
				options={{
					title: 'Home',
					tabBarAccessibilityLabel: 'Home',
					tabBarIcon: () => (
						<House
							size={24}
							color={homeActive ? colors.accent : colors.foreground}
							strokeWidth={homeActive ? 2.5 : 2}
						/>
					)
				}}
			/>
			<Tabs.Screen
				name="messages"
				// the messages are the home tab's second page: this tab only opens it
				listeners={{
					tabPress: (e) => {
						e.preventDefault();
						const { focused } = getHomePage();
						setHomePage(1, focused);
						if (!focused) router.navigate('/');
					}
				}}
				options={{
					title: 'Messages',
					// only ever shown for a moment, on the way to the home tab
					animation: 'none',
					tabBarAccessibilityLabel: 'Messages',
					tabBarBadge: badge(unread.messages),
					tabBarIcon: () => (
						<MessageCircle
							size={24}
							color={messagesActive ? colors.accent : colors.foreground}
							strokeWidth={messagesActive ? 2.5 : 2}
						/>
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
				// like the website's avatar menu: a sheet with the profile switcher, not a page. a double
				// tap switches back to the profile used before
				listeners={{
					tabPress: (e) => {
						e.preventDefault();
						onAvatarTap();
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
