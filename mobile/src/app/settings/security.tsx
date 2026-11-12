import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { ask, confirm, toast } from '@/components/overlays';
import { Button, ErrorBanner, Field, Hint, Section, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { addPasskey, PasskeyCancelled, passkeysSupported } from '@/lib/passkeys';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Passkey, Session } from '@/lib/types';

const kinds = { cookie: 'Browser', token: 'App', personal: 'Access token' };

const card = {
	borderWidth: 1,
	borderColor: colors.line,
	borderRadius: 6,
	padding: 10,
	flexDirection: 'row',
	alignItems: 'center',
	gap: 10
} as const;

/** The password, passkeys and every place the account is signed in. */
export default function SecuritySettings() {
	const { me } = useSession();
	const [sessions, setSessions] = useState<Session[]>([]);
	const [passkeys, setPasskeys] = useState<Passkey[]>([]);
	const [maxPasskeys, setMaxPasskeys] = useState(0);
	const [passkeyPassword, setPasskeyPassword] = useState('');
	const [passkeyName, setPasskeyName] = useState('');
	const [adding, setAdding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [current, setCurrent] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(() => {
		api<{ items: Session[] }>('auth/sessions')
			.then((res) => setSessions(res.items))
			.catch((e) => setError(errorMessage(e)));
		api<{ items: Passkey[]; max: number }>('me/passkeys')
			.then((res) => {
				setPasskeys(res.items);
				setMaxPasskeys(res.max);
			})
			.catch(() => {});
	}, []);
	useEffect(load, [load]);

	const run = async (action: () => Promise<unknown>, done: string) => {
		setError(null);
		try {
			await action();
			toast(done);
			load();
		} catch (e) {
			setError(errorMessage(e));
		}
	};

	async function changePassword() {
		setBusy(true);
		await run(async () => {
			await api('me/password', {
				method: 'PUT',
				body: { current_password: current, password }
			});
			setCurrent('');
			setPassword('');
		}, 'Password changed');
		setBusy(false);
	}

	async function createPasskey() {
		setAdding(true);
		setError(null);
		try {
			await addPasskey(passkeyPassword, passkeyName.trim());
			setPasskeyPassword('');
			setPasskeyName('');
			toast('Passkey added');
			load();
		} catch (e) {
			if (!(e instanceof PasskeyCancelled)) setError(errorMessage(e));
		} finally {
			setAdding(false);
		}
	}

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen options={{ title: 'Security' }} />
			<ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
				<ErrorBanner message={error} />
				<Section title="Password">
					<Field
						label="Current password"
						value={current}
						onChangeText={setCurrent}
						secureTextEntry
					/>
					<Field label="New password" value={password} onChangeText={setPassword} secureTextEntry />
					<Hint>Changing it signs out every other session and token.</Hint>
					<Button
						label="Change password"
						disabled={!current || !password}
						loading={busy}
						onPress={changePassword}
					/>
				</Section>

				<Section title="Passkeys">
					<Hint>
						Passkeys let you sign in to @{me?.account?.username ?? me?.user.username} with your
						fingerprint, face or screen lock instead of typing your password. They are optional:
						your password keeps working either way.
					</Hint>
					{passkeys.map((passkey) => (
						<View key={passkey.id} style={card}>
							<View style={{ flex: 1 }}>
								<Txt bold numberOfLines={1}>
									{passkey.name}
								</Txt>
								<Txt size={13} muted>
									Added {shortDate(passkey.created_at)}
									{passkey.last_used_at ? ` · used ${shortDate(passkey.last_used_at)}` : ''}
								</Txt>
							</View>
							<Button
								size="sm"
								label="Rename"
								onPress={async () => {
									const name = await ask({
										title: 'Rename passkey',
										initial: passkey.name,
										maxLength: 64
									});
									if (name?.trim())
										run(
											() =>
												api(`me/passkeys/${passkey.id}`, {
													method: 'PATCH',
													body: { name: name.trim() }
												}),
											'Renamed'
										);
								}}
							/>
							<Button
								size="sm"
								variant="danger"
								label="Delete"
								onPress={async () => {
									if (await confirm('Delete passkey?', passkey.name, 'Delete', true))
										run(() => api(`me/passkeys/${passkey.id}`, { method: 'DELETE' }), 'Deleted');
								}}
							/>
						</View>
					))}
					{!passkeys.length ? <Txt muted>No passkeys.</Txt> : null}
					{passkeysSupported() && passkeys.length < maxPasskeys ? (
						<>
							<Field
								label="Name (optional)"
								value={passkeyName}
								onChangeText={setPasskeyName}
								placeholder="Passkey"
								maxLength={64}
							/>
							<Field
								label="Current password"
								value={passkeyPassword}
								onChangeText={setPasskeyPassword}
								secureTextEntry
								hint="A passkey is lasting access to your account, so it needs your password."
							/>
							<Button
								label="Add a passkey"
								disabled={!passkeyPassword}
								loading={adding}
								onPress={createPasskey}
							/>
						</>
					) : null}
				</Section>

				<Section title="Where you’re signed in">
					{sessions.map((session) => (
						<View key={session.id} style={card}>
							<View style={{ flex: 1 }}>
								<Txt bold numberOfLines={1}>
									{session.name || kinds[session.kind]}
									{session.current ? ' · this device' : ''}
								</Txt>
								<Txt size={13} muted numberOfLines={2}>
									{kinds[session.kind]} · since {shortDate(session.created_at)}
									{session.last_used_at ? ` · used ${shortDate(session.last_used_at)}` : ''}
									{session.expires_at ? ` · expires ${shortDate(session.expires_at)}` : ''}
								</Txt>
								{session.user_agent ? (
									<Txt size={12} muted numberOfLines={1}>
										{session.user_agent}
									</Txt>
								) : null}
							</View>
							{session.current ? null : (
								<Button
									size="sm"
									variant="danger"
									label="Revoke"
									onPress={() =>
										run(
											() => api(`auth/sessions/${session.id}`, { method: 'DELETE' }),
											'Signed out'
										)
									}
								/>
							)}
						</View>
					))}
				</Section>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
