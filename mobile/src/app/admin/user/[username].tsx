import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Badge, LogEntryRow, ReportCard, StatTile } from '@/components/moderation';
import { confirm } from '@/components/overlays';
import { refreshColors } from '@/components/PostList';
import { Avatar, Button, ErrorBanner, Field, Loading, TabRow, Txt } from '@/components/ui';
import { api, errorMessage, withQuery } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import { fullDate, shortDate } from '@/lib/format';
import { actionHref, moderate, relative, type ModerationAction } from '@/lib/moderation';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { AdminAccount, LogEntry, Page, Report } from '@/lib/types';

type Tab = 'history' | 'reports' | 'identities';
const PAGE = 20;

const sectionTitle = { letterSpacing: 0.5, textTransform: 'uppercase' } as const;

/** A staff member's view of one account: its state, actions, notes, history and reports. */
export default function AccountCase() {
	const params = useLocalSearchParams<{ username: string }>();
	const username = params.username.replace(/^@/, '').toLowerCase();
	const [account, setAccount] = useState<AdminAccount | null>(null);
	const [log, setLog] = useState<Page<LogEntry> | null>(null);
	const [reports, setReports] = useState<Page<Report> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [flash, setFlash] = useState<{ message: string; failed: boolean } | null>(null);
	const [busy, setBusy] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [tab, setTab] = useState<Tab>('history');
	const [note, setNote] = useState('');
	const { me } = useSession();
	// the invites field, reset to the account's count whenever it loads
	const [invitesValue, setInvitesValue] = useState('');

	const load = useCallback(async () => {
		try {
			const a = await api<AdminAccount>(`admin/users/${encodeURIComponent(username)}`);
			const [l, r] = await Promise.all([
				api<Page<LogEntry>>(withQuery('admin/log', { username: a.username, limit: PAGE })),
				api<Page<Report>>(
					withQuery('admin/reports', { status: 'all', username: a.username, limit: PAGE })
				)
			]);
			setAccount(a);
			setInvitesValue(a.invites ? String(a.invites.invites) : '');
			setLog(l);
			setReports(r);
			setError(null);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setRefreshing(false);
		}
	}, [username]);
	useEffect(() => {
		load();
	}, [load]);
	useBus('moderation_changed', load);

	async function changed(message: string, failed = false) {
		setFlash({ message, failed });
		if (!failed) emit('moderation_changed');
	}

	async function run(action: ModerationAction, fields: { role?: string } = {}, ask?: string) {
		if (!account) return;
		if (ask && !(await confirm('Are you sure?', ask, 'Yes'))) return;
		setBusy(true);
		try {
			changed((await moderate(account.username, action, fields)).message);
		} catch (e) {
			changed(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	async function saveInvites() {
		if (!account?.invites || busy) return;
		const value = invitesValue.trim();
		const count = Number(value);
		if (!/^\d+$/.test(value) || count > 1000) {
			changed('Invites held is a number from 0 to 1000.', true);
			return;
		}
		const out = account.invites.pending;
		if (
			count < out &&
			!(await confirm(
				'Revoke invite links?',
				`@${account.username} has ${out} invite ${
					out === 1 ? 'link' : 'links'
				} out. Going down to ${count} revokes the newest ${out - count}. Continue?`,
				'Continue',
				true
			))
		)
			return;
		setBusy(true);
		try {
			const res = await api<{ message: string }>(
				`admin/users/${encodeURIComponent(account.username)}/invites`,
				{ method: 'PUT', body: { invites: count } }
			);
			changed(res.message);
		} catch (e) {
			changed(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	async function addNote() {
		if (!account || !note.trim() || busy) return;
		setBusy(true);
		try {
			const res = await api<{ message: string }>(
				`admin/users/${encodeURIComponent(account.username)}/notes`,
				{ method: 'POST', body: { note: note.trim() } }
			);
			setNote('');
			changed(res.message);
		} catch (e) {
			changed(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	if (!account)
		return (
			<View style={{ flex: 1, padding: 20 }}>
				<Stack.Screen options={{ title: `@${username}` }} />
				{error ? <ErrorBanner message={error} /> : <Loading />}
			</View>
		);

	const a = account;
	const states = [
		a.banned_at && {
			label: 'Banned',
			since: a.banned_at,
			until: a.banned_until,
			reason: a.ban_reason,
			hint: 'Signed out everywhere and can’t sign in.'
		},
		a.muted_at && {
			label: 'Muted',
			since: a.muted_at,
			until: a.muted_until,
			reason: a.mute_reason,
			hint: 'Can read, but can’t post, reply or send messages.'
		}
	].filter((s) => !!s);

	const tabs: { value: Tab; label: string }[] = [
		{ value: 'history', label: `History${a.stats.log_entries ? ` ${a.stats.log_entries}` : ''}` },
		{ value: 'reports', label: `Reports${a.stats.reports ? ` ${a.stats.reports}` : ''}` },
		{
			value: 'identities',
			label: `Identities${
				a.identities.length + a.shared_with.length
					? ` ${a.identities.length + a.shared_with.length}`
					: ''
			}`
		}
	];

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
			<Stack.Screen options={{ title: `@${a.username}` }} />
			<View style={{ padding: 20, gap: 20 }}>
				<View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
					<Avatar user={a} size={64} />
					<View style={{ flex: 1, gap: 5 }}>
						<Txt extrabold size={20}>
							{a.name}
						</Txt>
						<View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
							<Txt dim={0.8}>@{a.username}</Txt>
							{a.role !== 'user' ? <Badge label={a.role} tone="accent" /> : null}
							{a.banned_at ? <Badge label="banned" tone="danger" /> : null}
							{a.muted_at ? <Badge label="muted" tone="danger" /> : null}
							{a.self ? <Badge label="you" /> : null}
						</View>
						<Txt size={13} muted>
							Joined {shortDate(a.created_at)}
							{a.invites?.invited_by ? (
								<>
									{' · invited by '}
									<Txt
										size={13}
										accent
										onPress={() => router.push(`/admin/user/${a.invites!.invited_by!.username}`)}
										suppressHighlighting
									>
										@{a.invites.invited_by.username}
									</Txt>
								</>
							) : null}
							{a.email ? ` · ${a.email}` : ''}
						</Txt>
						{a.via ? (
							<Txt size={13} muted>
								You opened @{a.via}, an identity of this account. Moderation applies to the whole
								account.
							</Txt>
						) : null}
					</View>
					<Button size="sm" label="Profile" onPress={() => router.push(`/user/${a.username}`)} />
				</View>

				<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
					<StatTile label="Posts" value={a.stats.posts} />
					<StatTile label="Followers" value={a.stats.followers} />
					<StatTile
						label="Open reports"
						value={a.stats.open_reports}
						alert={a.stats.open_reports > 0}
						onPress={() => setTab('reports')}
					/>
					<StatTile label="Reports made" value={a.stats.reports_made} />
				</View>

				{flash ? (
					<Pressable
						onPress={() => setFlash(null)}
						style={{
							borderRadius: 5,
							padding: 5,
							backgroundColor: flash.failed ? colors.danger : colors.accent
						}}
					>
						<Txt style={{ color: flash.failed ? '#fff' : colors.background }}>{flash.message}</Txt>
					</Pressable>
				) : null}

				{states.map((s) => (
					<View
						key={s.label}
						style={{
							borderWidth: 1,
							borderColor: colors.danger,
							borderRadius: 10,
							padding: 10,
							gap: 5
						}}
					>
						<Txt>
							<Txt bold style={{ color: colors.danger }}>
								{s.label}
							</Txt>
							<Txt size={14} muted>
								{' '}
								since {fullDate(s.since)} ·{' '}
								{s.until ? `ends ${relative(s.until)} (${fullDate(s.until)})` : 'permanent'}
							</Txt>
						</Txt>
						{s.reason ? <Txt size={14}>“{s.reason}”</Txt> : null}
						<Txt size={13} muted>
							{s.hint}
						</Txt>
					</View>
				))}

				{a.can_moderate ? (
					<View style={{ gap: 10 }}>
						<Txt bold size={13} muted style={sectionTitle}>
							Actions
						</Txt>
						<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
							{a.banned_at ? (
								<>
									<Button size="sm" label="Unban" disabled={busy} onPress={() => run('unban')} />
									<Button
										size="sm"
										label="Change ban"
										onPress={() =>
											router.push(
												actionHref(a.username, 'ban', {
													reason: a.ban_reason,
													until: a.banned_until
												})
											)
										}
									/>
								</>
							) : (
								<Button
									size="sm"
									variant="danger"
									label="Ban…"
									onPress={() => router.push(actionHref(a.username, 'ban'))}
								/>
							)}
							{a.muted_at ? (
								<>
									<Button size="sm" label="Unmute" disabled={busy} onPress={() => run('unmute')} />
									<Button
										size="sm"
										label="Change mute"
										onPress={() =>
											router.push(
												actionHref(a.username, 'mute', {
													reason: a.mute_reason,
													until: a.muted_until
												})
											)
										}
									/>
								</>
							) : (
								<Button
									size="sm"
									label="Mute…"
									onPress={() => router.push(actionHref(a.username, 'mute'))}
								/>
							)}
						</View>
						{a.can_manage ? (
							<>
								<Txt bold size={13} muted style={[sectionTitle, { marginTop: 10 }]}>
									Admin
								</Txt>
								<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
									<Button
										size="sm"
										disabled={busy}
										label={a.role === 'mod' ? 'Remove mod' : 'Make mod'}
										onPress={() =>
											run(
												'role',
												{ role: a.role === 'mod' ? 'user' : 'mod' },
												a.role === 'mod'
													? `Remove @${a.username} from the mods?`
													: `Make @${a.username} a mod? They can ban, mute and delete posts of regular users.`
											)
										}
									/>
									<Button
										size="sm"
										variant="danger"
										label="Reset password…"
										onPress={() => router.push(actionHref(a.username, 'password'))}
									/>
								</View>
							</>
						) : null}
					</View>
				) : (
					<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 }}>
						<Txt size={14} muted>
							{a.self
								? 'This is your account: you can’t moderate yourself, but you can leave notes.'
								: `@${a.username} is ${
										a.role === 'admin' ? 'an admin' : 'a mod'
								  }: only someone ranked higher can act on them.`}
						</Txt>
					</View>
				)}

				{me?.role === 'admin' && a.invites ? (
					<View style={{ gap: 10 }}>
						<Txt bold size={13} muted style={sectionTitle}>
							Invites
						</Txt>
						<Txt size={14}>
							{a.invites.invites === 0 ? (
								'No invites to give.'
							) : (
								<>
									<Txt bold size={14}>
										{a.invites.available}
									</Txt>{' '}
									to give
									{a.invites.pending > 0
										? `, ${a.invites.pending} out as ${
												a.invites.pending === 1 ? 'a link' : 'links'
										  }`
										: ''}
									.
								</>
							)}
							{a.invites.used > 0 ? (
								<>
									{' '}
									<Txt
										size={14}
										accent
										suppressHighlighting
										onPress={() =>
											router.push(`/admin?tab=invites&status=used&username=${a.username}`)
										}
									>
										{a.invites.used} {a.invites.used === 1 ? 'person' : 'people'} joined with their
										invites
									</Txt>
									.
								</>
							) : null}
						</Txt>
						<View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
							<View style={{ width: 110 }}>
								<Field
									label="Invites held"
									value={invitesValue}
									onChangeText={setInvitesValue}
									keyboardType="number-pad"
									maxLength={4}
									onSubmitEditing={saveInvites}
								/>
							</View>
							<Button
								size="sm"
								label="Save"
								disabled={busy || invitesValue.trim() === String(a.invites.invites)}
								onPress={saveInvites}
							/>
						</View>
					</View>
				) : null}
			</View>

			<TabRow tabs={tabs} value={tab} onChange={setTab} />

			{tab === 'history' ? (
				<View>
					<View style={{ padding: 20, gap: 10 }}>
						<Field
							label="Add a note for the staff"
							placeholder="What happened, what you told them, what to watch for…"
							value={note}
							onChangeText={setNote}
							maxLength={1000}
							multiline
							autoCapitalize="sentences"
							style={{ minHeight: 64, textAlignVertical: 'top' }}
						/>
						<Button
							size="sm"
							label="Add note"
							style={{ alignSelf: 'flex-end' }}
							disabled={busy || !note.trim()}
							onPress={addNote}
						/>
					</View>
					{log?.items.length ? (
						log.items.map((entry) => <LogEntryRow key={entry.id} entry={entry} compact />)
					) : (
						<Txt muted style={{ textAlign: 'center', padding: 40 }}>
							No history yet.
						</Txt>
					)}
				</View>
			) : tab === 'reports' ? (
				<View style={{ padding: 20, gap: 10 }}>
					{reports?.items.length ? (
						reports.items.map((report) => (
							<ReportCard key={report.id} report={report} compact onChange={changed} />
						))
					) : (
						<Txt muted style={{ textAlign: 'center', padding: 20 }}>
							Nobody reported this account.
						</Txt>
					)}
					{reports?.next_cursor ? (
						<Button
							label="All reports"
							style={{ alignSelf: 'flex-start' }}
							onPress={() => router.push(`/admin?tab=reports&username=${a.username}`)}
						/>
					) : null}
				</View>
			) : (
				<View>
					{a.identities.map((i) => (
						<IdentityRow
							key={i.username}
							user={i}
							subtitle={`${i.bot ? 'Bot' : 'Identity'} owned by this account${
								i.members.length ? `, shared with ${i.members.map((m) => `@${m}`).join(', ')}` : ''
							}`}
							onPress={() => router.push(`/user/${i.username}`)}
						/>
					))}
					{a.shared_with.map((i) => (
						<IdentityRow
							key={i.username}
							user={i}
							subtitle={`Shared with this account by @${i.owner_username}`}
							onPress={() => router.push(`/admin/user/${i.owner_username}`)}
						/>
					))}
					{!a.identities.length && !a.shared_with.length ? (
						<Txt muted style={{ textAlign: 'center', padding: 40 }}>
							No identities or bots.
						</Txt>
					) : null}
				</View>
			)}
		</ScrollView>
	);
}

function IdentityRow({
	user,
	subtitle,
	onPress
}: {
	user: { username: string; name: string; avatar: string | null };
	subtitle: string;
	onPress: () => void;
}) {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: 'row',
				alignItems: 'center',
				gap: 10,
				paddingVertical: 10,
				paddingHorizontal: 20,
				borderBottomWidth: 1,
				borderBottomColor: colors.line,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			<Avatar user={user} size={32} />
			<View style={{ flex: 1 }}>
				<Txt bold numberOfLines={1}>
					{user.name}{' '}
					<Txt size={14} dim={0.7}>
						@{user.username}
					</Txt>
				</Txt>
				<Txt size={13} muted>
					{subtitle}
				</Txt>
			</View>
		</Pressable>
	);
}
