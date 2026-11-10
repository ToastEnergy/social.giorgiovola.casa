import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorBanner, Field, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { DEFAULT_SERVER, useSession } from '@/lib/session';
import type { LoginResult } from '@/lib/types';

/** "social.example.com" → "https://social.example.com", without a trailing slash */
export const normalizeServer = (value: string) => {
	const trimmed = value.trim().replace(/\/+$/, '');
	return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const CLIENT_NAME = `Mobile app (${Platform.OS === 'ios' ? 'iOS' : 'Android'})`;

export default function Login() {
	// add: signing in to one more account while already signed in
	const { add } = useLocalSearchParams<{ add?: string }>();
	const session = useSession();
	const insets = useSafeAreaInsets();
	const [server, setServer] = useState(session.accounts.length ? session.server : DEFAULT_SERVER);
	const [editServer, setEditServer] = useState(false);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit() {
		if (!username.trim() || !password) return setError('Enter your username and password.');
		setBusy(true);
		setError(null);
		const origin = normalizeServer(server);
		try {
			const result = await api<LoginResult>('auth/login', {
				method: 'POST',
				server: origin,
				token: null,
				body: { username: username.trim(), password, client_name: CLIENT_NAME }
			});
			await session.signIn(origin, result);
			if (router.canDismiss()) router.dismissAll();
			router.replace('/');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{
					flexGrow: 1,
					justifyContent: 'center',
					padding: 20,
					paddingTop: insets.top + 20,
					paddingBottom: insets.bottom + 20,
					gap: 20
				}}
			>
				<View style={{ alignItems: 'center', gap: 10 }}>
					<Image
						source={require('../../assets/logo.png')}
						style={{ width: 80, height: 80 }}
						contentFit="contain"
					/>
					<Txt extrabold size={28}>
						{add ? 'Add an account' : 'Log in'}
					</Txt>
				</View>
				<ErrorBanner message={error} />
				<Field
					label="Username or email"
					value={username}
					onChangeText={setUsername}
					autoCorrect={false}
					autoComplete="username"
					textContentType="username"
					returnKeyType="next"
				/>
				<Field
					label="Password"
					value={password}
					onChangeText={setPassword}
					secureTextEntry
					autoComplete="current-password"
					textContentType="password"
					onSubmitEditing={submit}
				/>
				{editServer ? (
					<Field
						label="Server"
						value={server}
						onChangeText={setServer}
						keyboardType="url"
						autoCorrect={false}
						hint="The address of the instance your account is on."
					/>
				) : (
					<Pressable onPress={() => setEditServer(true)}>
						<Txt size={13} muted>
							Server: <Txt size={13}>{server.replace(/^https?:\/\//, '')}</Txt> ·{' '}
							<Txt size={13} accent>
								Change
							</Txt>
						</Txt>
					</Pressable>
				)}
				<Button variant="primary" size="lg" label="Log in" onPress={submit} loading={busy} />
				<Button
					size="lg"
					label="Create an account"
					onPress={() =>
						router.push(`/register?server=${encodeURIComponent(normalizeServer(server))}`)
					}
				/>
				{add ? <Button label="Cancel" onPress={() => router.back()} /> : null}
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
