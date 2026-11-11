import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { Choice } from '@/components/Choice';
import { toast } from '@/components/overlays';
import { Button, ErrorBanner, Field, Hint, Txt } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { emit } from '@/lib/bus';
import { DURATIONS, moderate } from '@/lib/moderation';

/**
 * Banning, muting (or changing a ban or mute) and resetting a password, for the account behind
 * ?username=. ?current=1 with ?reason= and ?until= is the ban or mute the account already has.
 */
export default function ModerationAction() {
	const params = useLocalSearchParams<{
		username: string;
		action: 'ban' | 'mute' | 'password';
		current?: string;
		reason?: string;
		until?: string;
	}>();
	const { username, action } = params;
	const current = params.current === '1';
	const [reason, setReason] = useState(current ? params.reason ?? '' : '');
	// a ban for good stays for good, a new one starts at a day
	const [duration, setDuration] = useState<number | null>(
		current && !params.until ? null : DURATIONS[1].seconds
	);
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const copy = {
		ban: {
			title: current ? 'Change ban' : 'Ban',
			heading: current ? `Change the ban of @${username}` : `Ban @${username}`,
			hint: 'They are signed out everywhere and can’t sign in until the ban ends. Their identities and bots stop too.',
			submit: current ? 'Update ban' : 'Ban'
		},
		mute: {
			title: current ? 'Change mute' : 'Mute',
			heading: current ? `Change the mute of @${username}` : `Mute @${username}`,
			hint: 'They can still read, but can’t post, reply or send messages, from any of their profiles.',
			submit: current ? 'Update mute' : 'Mute'
		},
		password: {
			title: 'Reset password',
			heading: `Reset the password of @${username}`,
			hint: 'They are signed out everywhere. Tell them the new password some other way.',
			submit: 'Reset password'
		}
	}[action];

	async function submit() {
		if (busy) return;
		if (action === 'password' && password.length < 8) {
			setError('The password needs at least 8 characters.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const { message } = await moderate(
				username,
				action,
				action === 'password' ? { password } : { reason: reason.trim(), duration }
			);
			emit('moderation_changed');
			toast(message);
			router.back();
		} catch (e) {
			setError(errorMessage(e));
			setBusy(false);
		}
	}

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen options={{ title: copy.title }} />
			<ScrollView
				contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }}
				keyboardShouldPersistTaps="handled"
			>
				<View style={{ gap: 5 }}>
					<Txt extrabold size={18}>
						{copy.heading}
					</Txt>
					<Hint>{copy.hint}</Hint>
				</View>
				<ErrorBanner message={error} />
				{action === 'password' ? (
					<Field
						label="New password"
						value={password}
						onChangeText={setPassword}
						secureTextEntry
						autoComplete="new-password"
						maxLength={256}
					/>
				) : (
					<>
						<View style={{ gap: 5 }}>
							<Txt size={13} dim={0.8} style={{ marginBottom: 5 }}>
								How long
							</Txt>
							{[DURATIONS.slice(0, 3), DURATIONS.slice(3)].map((row, index) => (
								<View key={index} style={{ flexDirection: 'row', gap: 5 }}>
									{row.map((d) => (
										<View key={d.label} style={{ flex: 1 }}>
											<Choice
												compact
												filled
												label={d.label}
												selected={duration === d.seconds}
												onPress={() => setDuration(d.seconds)}
											/>
										</View>
									))}
								</View>
							))}
							{current && params.until && duration !== null ? (
								<Hint>The new length counts from now.</Hint>
							) : null}
						</View>
						<Field
							label="Reason (they see it)"
							placeholder="Optional"
							value={reason}
							onChangeText={setReason}
							maxLength={200}
							autoCapitalize="sentences"
						/>
					</>
				)}
				<View style={{ flexDirection: 'row', gap: 10 }}>
					<Button label="Cancel" style={{ flex: 1 }} onPress={router.back} />
					<Button
						label={copy.submit}
						variant={action === 'mute' ? 'primary' : 'danger'}
						style={{ flex: 1 }}
						loading={busy}
						onPress={submit}
					/>
				</View>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
