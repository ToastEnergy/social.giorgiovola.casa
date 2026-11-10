import * as Clipboard from 'expo-clipboard';
import { Stack } from 'expo-router/stack';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { pickAvatar } from '@/components/attachments';
import { ask, confirm, showMenu, toast } from '@/components/overlays';
import { Avatar, Button, ErrorBanner, Field, Hint, Notice, Section, Txt } from '@/components/ui';
import { api, errorMessage, imageBody } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Bot } from '@/lib/types';

const EXPIRY = [
	{ label: '30 days', days: 30 },
	{ label: '90 days', days: 90 },
	{ label: '1 year', days: 365 },
	{ label: 'Never', days: null }
];

/** Personal access tokens and bots. */
export default function DeveloperSettings() {
	const { server, instance } = useSession();
	const [bots, setBots] = useState<Bot[]>([]);
	const [maxBots, setMaxBots] = useState(0);
	const [error, setError] = useState<string | null>(null);
	// a token is shown once, right after it was made
	const [secret, setSecret] = useState<{ label: string; token: string } | null>(null);
	const [tokenName, setTokenName] = useState('');
	const [tokenPassword, setTokenPassword] = useState('');
	const [expiry, setExpiry] = useState<number | null>(90);
	const [botName, setBotName] = useState('');
	const [botUsername, setBotUsername] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(() => {
		api<{ items: Bot[]; max: number }>('me/bots')
			.then((res) => {
				setBots(res.items);
				setMaxBots(res.max);
			})
			.catch((e) => setError(errorMessage(e)));
	}, []);
	useEffect(load, [load]);

	const run = async (action: () => Promise<unknown>, done?: string) => {
		setError(null);
		setBusy(true);
		try {
			await action();
			if (done) toast(done);
			load();
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const createToken = () =>
		run(async () => {
			const res = await api<{ name: string; token: string }>('auth/tokens', {
				method: 'POST',
				body: { name: tokenName.trim(), current_password: tokenPassword, expires_in_days: expiry }
			});
			setSecret({ label: `Access token “${res.name}”`, token: res.token });
			setTokenName('');
			setTokenPassword('');
		});

	const createBot = () =>
		run(async () => {
			const res = await api<{ username: string; token: string }>('me/bots', {
				method: 'POST',
				body: { name: botName.trim(), username: botUsername.trim() }
			});
			setSecret({ label: `Token of @${res.username}`, token: res.token });
			setBotName('');
			setBotUsername('');
		});

	/** asks for one field of a bot's profile and saves it */
	async function editBot(bot: Bot, field: 'name' | 'username' | 'bio' | 'website') {
		const value = await ask({
			title: `${field[0].toUpperCase()}${field.slice(1)} of @${bot.username}`,
			initial: bot[field],
			maxLength: instance?.limits[field]
		});
		if (value === null) return;
		run(
			() => api(`me/bots/${bot.username}`, { method: 'PATCH', body: { [field]: value.trim() } }),
			'Saved'
		);
	}

	const botMenu = (bot: Bot) =>
		showMenu([
			{ label: 'Edit name', onPress: () => editBot(bot, 'name') },
			{ label: 'Edit username', onPress: () => editBot(bot, 'username') },
			{ label: 'Edit bio', onPress: () => editBot(bot, 'bio') },
			{ label: 'Edit website', onPress: () => editBot(bot, 'website') },
			{
				label: 'Change picture',
				onPress: async () => {
					const image = await pickAvatar();
					if (image)
						run(
							async () =>
								api(`me/bots/${bot.username}/avatar`, {
									method: 'PUT',
									raw: await imageBody(image)
								}),
							'Picture changed'
						);
				}
			},
			!!bot.avatar && {
				label: 'Remove picture',
				onPress: () =>
					run(() => api(`me/bots/${bot.username}/avatar`, { method: 'DELETE' }), 'Picture removed')
			},
			{
				label: 'New token',
				onPress: async () => {
					if (
						await confirm(
							'Make a new token?',
							`The current token of @${bot.username} stops working.`,
							'New token'
						)
					)
						run(async () => {
							const res = await api<{ username: string; token: string }>(
								`me/bots/${bot.username}/token`,
								{ method: 'POST' }
							);
							setSecret({ label: `Token of @${res.username}`, token: res.token });
						});
				}
			},
			{
				label: 'Delete bot',
				danger: true,
				onPress: async () => {
					if (
						await confirm(
							`Delete @${bot.username}?`,
							'The bot and its posts are deleted. This can’t be undone.',
							'Delete',
							true
						)
					)
						run(() => api(`me/bots/${bot.username}`, { method: 'DELETE' }), 'Bot deleted');
				}
			}
		]);

	return (
		<KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={90}>
			<Stack.Screen options={{ title: 'Developers' }} />
			<ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
				<Section>
					<Hint>
						Everything this app does goes through the public API. Read its guide to build your own
						client or bot.
					</Hint>
					<Button
						label="API documentation"
						onPress={() => WebBrowser.openBrowserAsync(`${server}/developers`).catch(() => {})}
					/>
					<ErrorBanner message={error} />
					{secret ? (
						<Notice>
							<Txt bold size={14}>
								{secret.label}
								{'\n'}
							</Txt>
							<Txt size={14} selectable>
								{secret.token}
								{'\n'}
							</Txt>
							<Txt size={13} muted>
								Copy it now: it is never shown again.
							</Txt>
						</Notice>
					) : null}
					{secret ? (
						<View style={{ flexDirection: 'row', gap: 10 }}>
							<Button
								size="sm"
								variant="primary"
								label="Copy token"
								onPress={async () => {
									await Clipboard.setStringAsync(secret.token);
									toast('Token copied');
								}}
							/>
							<Button size="sm" label="Done" onPress={() => setSecret(null)} />
						</View>
					) : null}
				</Section>

				<Section title="Personal access tokens">
					<Hint>
						A token signs a script or app in as you. Existing tokens are listed, and revoked, under
						Security.
					</Hint>
					<Field
						label="Token name"
						value={tokenName}
						onChangeText={setTokenName}
						maxLength={64}
						autoCapitalize="sentences"
					/>
					<Field
						label="Current password"
						value={tokenPassword}
						onChangeText={setTokenPassword}
						secureTextEntry
					/>
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
						{EXPIRY.map((option) => (
							<Button
								key={option.label}
								size="sm"
								variant={expiry === option.days ? 'primary' : 'default'}
								label={option.label}
								onPress={() => setExpiry(option.days)}
							/>
						))}
					</View>
					<Button
						label="Create token"
						disabled={!tokenName.trim() || !tokenPassword || busy}
						onPress={createToken}
					/>
				</Section>

				<Section title="Bots">
					<Hint>
						Bots are profiles driven by a program through the API. You can have {maxBots}.
					</Hint>
					{bots.map((bot) => (
						<View
							key={bot.username}
							style={{
								flexDirection: 'row',
								alignItems: 'center',
								gap: 10,
								borderWidth: 1,
								borderColor: colors.line,
								borderRadius: 6,
								padding: 10
							}}
						>
							<Avatar user={bot} size={40} link />
							<View style={{ flex: 1 }}>
								<Txt bold numberOfLines={1}>
									{bot.name}
								</Txt>
								<Txt size={13} muted numberOfLines={1}>
									@{bot.username} ·{' '}
									{bot.last_used_at ? `used ${shortDate(bot.last_used_at)}` : 'never used'}
								</Txt>
							</View>
							<Button size="sm" label="Manage" onPress={() => botMenu(bot)} />
						</View>
					))}
					{bots.length < maxBots ? (
						<>
							<Field
								label="Bot name"
								value={botName}
								onChangeText={setBotName}
								autoCapitalize="words"
								maxLength={instance?.limits.name}
							/>
							<Field
								label="Bot username"
								value={botUsername}
								onChangeText={setBotUsername}
								autoCorrect={false}
								maxLength={instance?.limits.username}
							/>
							<Button
								label="Create bot"
								disabled={!botName.trim() || !botUsername.trim() || busy}
								onPress={createBot}
							/>
						</>
					) : null}
				</Section>
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
