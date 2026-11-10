import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { pickAvatar } from '@/components/attachments';
import { toast } from '@/components/overlays';
import { Avatar, Button, ErrorBanner, Field, Hint, Section } from '@/components/ui';
import { api, errorMessage, imageBody } from '@/lib/api';
import { useSession } from '@/lib/session';

/** PATCH /me and the profile picture, for the profile in use. */
export default function ProfileSettings() {
	const { me, instance, reloadMe } = useSession();
	const limits = instance?.limits ?? {};
	const [form, setForm] = useState({
		name: me?.user.name ?? '',
		username: me?.user.username ?? '',
		bio: me?.user.bio ?? '',
		website: me?.user.website ?? '',
		email: me?.user.email ?? ''
	});
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [avatarBusy, setAvatarBusy] = useState(false);
	const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

	if (!me) return null;
	// identities and bots have no email
	const hasEmail = me.user.email !== null;
	const emailChanged = hasEmail && form.email.trim() !== me.user.email;

	async function save() {
		setBusy(true);
		setError(null);
		try {
			await api('me', {
				method: 'PATCH',
				body: {
					name: form.name,
					username: form.username,
					bio: form.bio,
					website: form.website,
					...(emailChanged ? { email: form.email.trim(), current_password: password } : {})
				}
			});
			await reloadMe();
			setPassword('');
			toast('Profile saved');
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	async function avatar(action: 'change' | 'remove') {
		setError(null);
		try {
			if (action === 'remove') {
				setAvatarBusy(true);
				await api('me/avatar', { method: 'DELETE' });
			} else {
				const image = await pickAvatar();
				if (!image) return;
				setAvatarBusy(true);
				await api('me/avatar', { method: 'PUT', raw: await imageBody(image) });
			}
			await reloadMe();
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setAvatarBusy(false);
		}
	}

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen options={{ title: 'Profile' }} />
			<ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
				<Section>
					<ErrorBanner message={error} />
					<View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
						<Avatar user={me.user} size={64} />
						<View style={{ gap: 8, alignItems: 'flex-start' }}>
							<Button
								size="sm"
								label="Change picture"
								loading={avatarBusy}
								onPress={() => avatar('change')}
							/>
							{me.user.avatar ? (
								<Button
									size="sm"
									variant="danger"
									label="Remove picture"
									onPress={() => avatar('remove')}
								/>
							) : null}
						</View>
					</View>
				</Section>
				<Section>
					<Field
						label="Name"
						value={form.name}
						onChangeText={set('name')}
						autoCapitalize="words"
						maxLength={limits.name}
					/>
					<Field
						label="Username"
						value={form.username}
						onChangeText={set('username')}
						autoCorrect={false}
						maxLength={limits.username}
						hint="Changing it changes the address of your profile."
					/>
					<Field
						label="Bio"
						value={form.bio}
						onChangeText={set('bio')}
						autoCapitalize="sentences"
						multiline
						maxLength={limits.bio}
					/>
					<Field
						label="Website"
						value={form.website}
						onChangeText={set('website')}
						keyboardType="url"
						autoCorrect={false}
						maxLength={limits.website}
					/>
					{hasEmail ? (
						<Field
							label="Email"
							value={form.email}
							onChangeText={set('email')}
							keyboardType="email-address"
							autoCorrect={false}
						/>
					) : (
						<Hint>This profile is an identity: it has no email or password of its own.</Hint>
					)}
					{emailChanged ? (
						<Field
							label="Current password"
							hint="Needed to change the email."
							value={password}
							onChangeText={setPassword}
							secureTextEntry
						/>
					) : null}
					<Button variant="primary" label="Save" loading={busy} onPress={save} />
				</Section>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
