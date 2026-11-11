import {
	Manrope_500Medium,
	Manrope_700Bold,
	Manrope_800ExtraBold,
	useFonts
} from '@expo-google-fonts/manrope';
import { DarkTheme, router, ThemeProvider, useSegments } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Overlays } from '@/components/overlays';
import { Button, Txt } from '@/components/ui';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';

const theme = {
	...DarkTheme,
	colors: {
		...DarkTheme.colors,
		primary: colors.accent,
		background: colors.background,
		card: colors.background,
		text: colors.foreground,
		border: colors.line
	}
};

function Navigation() {
	const { ready, me, accounts, reloadMe, signOut } = useSession();
	const segments = useSegments();
	const signedIn = accounts.length > 0;
	const inAuth = segments[0] === 'login' || segments[0] === 'register';
	const [retrying, setRetrying] = useState(false);

	// signed out (or the token was revoked): everything but the auth screens leads to the login
	useEffect(() => {
		if (ready && !signedIn && !inAuth) router.replace('/login');
	}, [ready, signedIn, inAuth]);

	return (
		<>
			<Stack
				screenOptions={{
					headerStyle: { backgroundColor: colors.background },
					headerTintColor: colors.foreground,
					headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18 },
					headerShadowVisible: false,
					headerBackButtonDisplayMode: 'minimal',
					contentStyle: { backgroundColor: colors.background }
				}}
			>
				<Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
				<Stack.Screen name="login" options={{ headerShown: false }} />
				<Stack.Screen name="register" options={{ title: 'Create account' }} />
				<Stack.Screen name="compose" options={{ presentation: 'modal', title: 'New post' }} />
				<Stack.Screen name="share" options={{ presentation: 'modal', title: 'Send via message' }} />
				<Stack.Screen name="report" options={{ presentation: 'modal', title: 'Report' }} />
				<Stack.Screen
					name="admin/action"
					options={{ presentation: 'modal', title: 'Moderation' }}
				/>
			</Stack>
			{!ready || (signedIn && !me && !inAuth) ? (
				<View
					style={{
						position: 'absolute',
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						backgroundColor: colors.background,
						alignItems: 'center',
						justifyContent: 'center',
						gap: 15,
						padding: 40
					}}
				>
					{!ready || retrying ? (
						<ActivityIndicator color={colors.accent} />
					) : (
						<>
							<Txt style={{ textAlign: 'center' }}>Could not reach the server.</Txt>
							<Button
								label="Try again"
								onPress={async () => {
									setRetrying(true);
									await reloadMe().catch(() => {});
									setRetrying(false);
								}}
							/>
							<Button variant="danger" label="Log out" onPress={() => signOut()} />
						</>
					)}
				</View>
			) : null}
		</>
	);
}

export default function RootLayout() {
	const [loaded] = useFonts({ Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold });
	if (!loaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
	return (
		<SafeAreaProvider>
			<ThemeProvider value={theme}>
				<SessionProvider>
					<StatusBar style="light" />
					<Navigation />
					<Overlays />
				</SessionProvider>
			</ThemeProvider>
		</SafeAreaProvider>
	);
}
