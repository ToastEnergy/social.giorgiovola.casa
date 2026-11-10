import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView } from 'react-native';
import { Button, ErrorBanner, Field, Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { DEFAULT_SERVER, useSession } from '@/lib/session';
import type { Instance, LoginResult } from '@/lib/types';
import { CLIENT_NAME } from './login';

export default function Register() {
	const { server = DEFAULT_SERVER } = useLocalSearchParams<{ server?: string }>();
	const session = useSession();
	const [instance, setInstance] = useState<Instance | null>(null);
	const [form, setForm] = useState({
		signup_password: '',
		email: '',
		name: '',
		username: '',
		password: ''
	});
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

	useEffect(() => {
		api<Instance>('instance', { server, token: null })
			.then(setInstance)
			.catch((e) => setError(errorMessage(e)));
	}, [server]);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			const result = await api<LoginResult>('auth/register', {
				method: 'POST',
				server,
				token: null,
				body: { ...form, client_name: CLIENT_NAME }
			});
			await session.signIn(server, result);
			if (router.canDismiss()) router.dismissAll();
			router.replace('/');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	const limits = instance?.limits;
	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={{ padding: 20, gap: 20 }}
			>
				{instance && !instance.registration_open ? (
					<Notice>Registration is closed on {server.replace(/^https?:\/\//, '')}.</Notice>
				) : null}
				<ErrorBanner message={error} />
				<Field
					label="Signup password"
					hint="The invite password of this instance."
					value={form.signup_password}
					onChangeText={set('signup_password')}
					secureTextEntry
				/>
				<Field
					label="Email"
					value={form.email}
					onChangeText={set('email')}
					keyboardType="email-address"
					autoComplete="email"
				/>
				<Field
					label="Name"
					value={form.name}
					onChangeText={set('name')}
					autoCapitalize="words"
					maxLength={limits?.name}
				/>
				<Field
					label="Username"
					hint="Letters a-z, digits and _."
					value={form.username}
					onChangeText={set('username')}
					autoCorrect={false}
					maxLength={limits?.username}
				/>
				<Field
					label="Password"
					value={form.password}
					onChangeText={set('password')}
					secureTextEntry
					autoComplete="new-password"
				/>
				<Button
					variant="primary"
					size="lg"
					label="Create account"
					onPress={submit}
					loading={busy}
				/>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
