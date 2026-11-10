import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { ask, confirm, toast } from '@/components/overlays';
import { Avatar, Button, ErrorBanner, Field, Hint, Loading, Section, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { Identities, User } from '@/lib/types';

/** Identities: extra profiles of the account, and the accounts they are shared with. */
export default function AccountSettings() {
	const session = useSession();
	const { me, instance } = session;
	const [data, setData] = useState<Identities | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [username, setUsername] = useState('');
	const [busy, setBusy] = useState(false);

	const load = useCallback(() => {
		api<Identities>('me/identities')
			.then(setData)
			.catch((e) => setError(errorMessage(e)));
	}, []);
	useEffect(load, [load]);

	const run = async (action: () => Promise<unknown>, done?: string) => {
		setError(null);
		try {
			await action();
			if (done) toast(done);
			load();
		} catch (e) {
			setError(errorMessage(e));
		}
	};

	async function create() {
		setBusy(true);
		await run(async () => {
			await api('me/identities', {
				method: 'POST',
				body: { name: name.trim(), username: username.trim() }
			});
			setName('');
			setUsername('');
		}, 'Identity created');
		setBusy(false);
	}

	async function use(profile: string) {
		try {
			await session.switchProfile(profile);
			router.dismissTo('/');
		} catch (e) {
			setError(errorMessage(e));
		}
	}

	const row = (
		user: User,
		detail: string,
		actions: React.ReactNode,
		children?: React.ReactNode
	) => (
		<View
			key={user.username}
			style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 10, gap: 10 }}
		>
			<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
				<Avatar user={user} size={40} link />
				<View style={{ flex: 1 }}>
					<Txt bold numberOfLines={1}>
						{user.name}
					</Txt>
					<Txt size={13} muted numberOfLines={1}>
						@{user.username} · {detail}
					</Txt>
				</View>
			</View>
			{children}
			<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{actions}</View>
		</View>
	);

	return (
		<ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
			<Stack.Screen options={{ title: 'Accounts & identities' }} />
			<ErrorBanner message={error} />
			{!data && !error ? <Loading /> : null}
			{data ? (
				<>
					<Section title="Your identities">
						<Hint>
							An identity is another profile of your account, with its own name, posts, follows and
							messages. You can have {data.max_identities}, and share each with up to{' '}
							{data.max_members} accounts.
						</Hint>
						{data.owned.map((identity) =>
							row(
								identity,
								identity.members.length
									? `shared with ${identity.members.map((m) => `@${m.username}`).join(', ')}`
									: 'only you',
								<>
									{me?.user.username !== identity.username ? (
										<Button size="sm" label="Use" onPress={() => use(identity.username)} />
									) : null}
									<Button
										size="sm"
										label="Share"
										onPress={async () => {
											const member = await ask({
												title: `Share @${identity.username}`,
												message: 'The account you name can post and message as this identity.',
												placeholder: 'Username of an account',
												confirm: 'Share'
											});
											if (member?.trim())
												run(
													() =>
														api(`me/identities/${identity.username}/members`, {
															method: 'POST',
															body: { username: member.trim().replace(/^@/, '') }
														}),
													'Shared'
												);
										}}
									/>
									<Button
										size="sm"
										variant="danger"
										label="Delete"
										onPress={async () => {
											if (
												await confirm(
													`Delete @${identity.username}?`,
													'Its posts are deleted with it. This can’t be undone.',
													'Delete',
													true
												)
											)
												run(async () => {
													await api(`me/identities/${identity.username}`, { method: 'DELETE' });
													await session.reloadMe();
												}, 'Identity deleted');
										}}
									/>
								</>,
								identity.members.length ? (
									<View style={{ gap: 6 }}>
										{identity.members.map((member) => (
											<View
												key={member.username}
												style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
											>
												<Avatar user={member} size={24} />
												<Txt size={14} style={{ flex: 1 }} numberOfLines={1}>
													{member.name}{' '}
													<Txt size={13} muted>
														@{member.username}
													</Txt>
												</Txt>
												<Button
													size="sm"
													variant="danger"
													label="Remove"
													onPress={() =>
														run(
															() =>
																api(
																	`me/identities/${identity.username}/members/${member.username}`,
																	{ method: 'DELETE' }
																),
															'Removed'
														)
													}
												/>
											</View>
										))}
									</View>
								) : null
							)
						)}
						{data.owned.length < data.max_identities ? (
							<>
								<Field
									label="Name"
									value={name}
									onChangeText={setName}
									autoCapitalize="words"
									maxLength={instance?.limits.name}
								/>
								<Field
									label="Username"
									value={username}
									onChangeText={setUsername}
									autoCorrect={false}
									maxLength={instance?.limits.username}
								/>
								<Button
									label="Create identity"
									disabled={!name.trim() || !username.trim()}
									loading={busy}
									onPress={create}
								/>
							</>
						) : null}
					</Section>
					{data.shared_with_me.length ? (
						<Section title="Shared with you">
							{data.shared_with_me.map((identity) =>
								row(
									identity,
									`shared by @${identity.owner}`,
									<>
										{me?.user.username !== identity.username ? (
											<Button size="sm" label="Use" onPress={() => use(identity.username)} />
										) : null}
										<Button
											size="sm"
											variant="danger"
											label="Leave"
											onPress={async () => {
												if (
													await confirm(
														`Leave @${identity.username}?`,
														'You can no longer act as this identity.',
														'Leave',
														true
													)
												)
													run(async () => {
														await api(`me/identities/${identity.username}/leave`, {
															method: 'POST'
														});
														await session.reloadMe();
													}, 'Left');
											}}
										/>
									</>
								)
							)}
						</Section>
					) : null}
					{me?.account && me.user.username !== me.account.username ? (
						<Section>
							<Button
								label={`Back to @${me.account.username}`}
								onPress={() => use(me.account!.username)}
							/>
						</Section>
					) : null}
				</>
			) : null}
		</ScrollView>
	);
}
