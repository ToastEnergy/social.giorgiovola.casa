import { Stack } from 'expo-router/stack';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { copyLink, InviteRow, shareLink } from '@/components/InviteRow';
import { refreshColors } from '@/components/PostList';
import { Button, ErrorBanner, Field, Hint, Loading, Section, Txt } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { expiresIn, linkOf } from '@/lib/invites';
import { useSession } from '@/lib/session';
import { colors, fonts } from '@/lib/theme';
import type { Invite, InviteBalance, Page } from '@/lib/types';

type Flash = { message: string; failed: boolean };

/** The web app's Settings → Invites: turn your invites into links, and see what became of them. */
export default function InviteSettings() {
	const { reloadMe } = useSession();
	const [balance, setBalance] = useState<InviteBalance | null>(null);
	const [invites, setInvites] = useState<Invite[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<Flash | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState('');
	const [showPast, setShowPast] = useState(false);
	// the code just made, shown with its link until dismissed; gone once it's revoked
	const [freshId, setFreshId] = useState<number | null>(null);
	const [freshCopied, setFreshCopied] = useState(false);
	// the form comes back after "Invite someone else" ready to type the next name
	const [focusNote, setFocusNote] = useState(false);

	const load = useCallback(async () => {
		try {
			const res = await api<Page<Invite> & InviteBalance>('me/invites?limit=100');
			setBalance({ invites: res.invites, pending: res.pending, available: res.available });
			setInvites(res.items);
			setError(null);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setRefreshing(false);
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	// the counts in /me (the settings list) follow
	const reload = () => Promise.all([load(), reloadMe().catch(() => {})]);

	async function changed(message: string, failed = false) {
		setFlash({ message, failed });
		if (!failed) await reload();
	}

	async function create() {
		setBusy(true);
		setFlash(null);
		try {
			const invite = await api<Invite>('me/invites', {
				method: 'POST',
				body: { note: note.trim() }
			});
			setNote('');
			await reload();
			setFreshId(invite.id);
			// sending it is the next thing to do
			setFreshCopied(await copyLink(invite));
		} catch (e) {
			setFlash({ message: errorMessage(e), failed: true });
		} finally {
			setBusy(false);
		}
	}

	async function copyFresh(invite: Invite) {
		const ok = await copyLink(invite);
		setFreshCopied(ok);
		if (!ok) setFlash({ message: 'Could not copy the link.', failed: true });
	}

	if (!balance)
		return (
			<View style={{ flex: 1, padding: 20 }}>
				<Stack.Screen options={{ title: 'Invites' }} />
				{error ? <ErrorBanner message={error} /> : <Loading />}
			</View>
		);

	const b = balance;
	const pending = invites.filter((i) => i.status === 'pending');
	const past = invites.filter((i) => i.status !== 'pending');
	const fresh = pending.find((i) => i.id === freshId) ?? null;
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			keyboardDismissMode="on-drag"
			contentContainerStyle={{ paddingBottom: 40 }}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					onRefresh={() => {
						setRefreshing(true);
						load();
					}}
					{...refreshColors}
				/>
			}
		>
			<Stack.Screen options={{ title: 'Invites' }} />
			<View style={{ padding: 20, paddingBottom: 0 }}>
				<Section title="Invite someone">
					{b.invites === 0 ? (
						<Hint>
							You don’t have any invites. People join this instance by invitation only, and the
							admins hand invites out.
						</Hint>
					) : (
						<>
							<Txt>
								{b.available > 0 ? (
									<>
										You have <Txt bold>{b.available}</Txt>{' '}
										{plural(b.available, 'invite', 'invites')} left.
									</>
								) : (
									'You have no invites left.'
								)}
								{b.pending > 0 ? (
									<Txt muted>
										{' '}
										{b.pending} {plural(b.pending, 'link is', 'links are')} waiting to be used.
									</Txt>
								) : null}
							</Txt>
							<Hint>
								Each invite is a link that works once and expires after two weeks. If nobody signs
								up with it, you get the invite back.
							</Hint>
						</>
					)}

					{flash ? (
						<Pressable
							onPress={() => setFlash(null)}
							style={{
								borderRadius: 5,
								padding: 5,
								backgroundColor: flash.failed ? colors.danger : 'rgba(0,0,0,0.7)'
							}}
						>
							<Txt style={flash.failed ? { color: '#fff' } : undefined}>{flash.message}</Txt>
						</Pressable>
					) : null}

					{fresh ? (
						<View
							style={{
								borderWidth: 1,
								borderColor: colors.accent,
								borderRadius: 10,
								backgroundColor: 'rgba(0,0,0,0.7)',
								padding: 10,
								gap: 10
							}}
						>
							<Txt bold>
								{fresh.note ? `Your invite for ${fresh.note} is ready` : 'Your invite is ready'}
							</Txt>
							<Txt
								selectable
								size={14}
								accessibilityLabel="Invite link"
								style={{
									fontFamily: fonts.mono,
									borderBottomWidth: 1,
									borderBottomColor: colors.line,
									paddingVertical: 5
								}}
							>
								{linkOf(fresh)}
							</Txt>
							<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
								<Button
									variant="primary"
									label={freshCopied ? 'Link copied!' : 'Copy link'}
									onPress={() => copyFresh(fresh)}
								/>
								<Button label="Share…" onPress={() => shareLink(fresh)} />
								{b.available > 0 ? (
									<Button
										label="Invite someone else"
										style={{ marginLeft: 'auto' }}
										onPress={() => {
											setFreshId(null);
											setFocusNote(true);
										}}
									/>
								) : (
									<Button
										label="Done"
										style={{ marginLeft: 'auto' }}
										onPress={() => {
											setFreshId(null);
											setFocusNote(false);
										}}
									/>
								)}
							</View>
							<Hint>
								Send it to them however you like. It works once
								{fresh.expires_at ? ` and expires ${expiresIn(fresh.expires_at)}` : ''}.
								{b.available > 0
									? ` You have ${b.available} more ${plural(
											b.available,
											'invite',
											'invites'
									  )} to give.`
									: ''}
							</Hint>
						</View>
					) : b.available > 0 ? (
						<>
							<Field
								autoFocus={focusNote}
								label="Who is it for?"
								placeholder="A name, so you remember (optional, only you see it)"
								value={note}
								onChangeText={setNote}
								maxLength={100}
								autoCapitalize="words"
								autoCorrect={false}
								returnKeyType="done"
								onSubmitEditing={create}
							/>
							<Button
								variant="primary"
								label={busy ? 'Creating…' : 'Create invite link'}
								disabled={busy}
								style={{ alignSelf: 'flex-start' }}
								onPress={create}
							/>
						</>
					) : null}
				</Section>
			</View>

			{pending.length > 0 ? (
				<View style={{ marginBottom: 40 }}>
					<Txt bold size={20} style={{ paddingHorizontal: 20, marginBottom: 2 }}>
						Waiting to be used
					</Txt>
					{pending.map((invite) => (
						<InviteRow key={invite.id} invite={invite} showStatus={false} onChange={changed} />
					))}
				</View>
			) : null}

			{past.length > 0 ? (
				<View>
					<Pressable
						onPress={() => setShowPast((v) => !v)}
						accessibilityRole="button"
						accessibilityState={{ expanded: showPast }}
						style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20 }}
					>
						{showPast ? (
							<ChevronDown size={18} color={colors.muted} />
						) : (
							<ChevronRight size={18} color={colors.muted} />
						)}
						<Txt muted>Past invites ({past.length})</Txt>
					</Pressable>
					{showPast
						? past.map((invite) => <InviteRow key={invite.id} invite={invite} onChange={changed} />)
						: null}
				</View>
			) : null}
		</ScrollView>
	);
}
