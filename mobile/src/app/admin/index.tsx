import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { ChevronDown, Inbox } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Badge, LogEntryRow, ReportCard, StatTile } from '@/components/moderation';
import { ask, confirm, showMenu, toast } from '@/components/overlays';
import { refreshColors } from '@/components/PostList';
import {
	Avatar,
	Button,
	ErrorBanner,
	Field,
	Hint,
	Input,
	ListState,
	Loading,
	Section,
	TabRow,
	Txt
} from '@/components/ui';
import { api, errorMessage, withQuery } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import { fullDate } from '@/lib/format';
import { LOG_ACTIONS, relative } from '@/lib/moderation';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { AdminGroup, AdminUser, LogEntry, Overview, Report } from '@/lib/types';
import { usePaged } from '@/lib/usePaged';

type Tab = 'reports' | 'accounts' | 'log' | 'settings';
type ReportFilter = 'open' | 'resolved' | 'dismissed' | 'all';
type AccountFilter = 'all' | 'reported' | 'banned' | 'muted' | 'staff';

const reportFilters: { value: ReportFilter; label: string }[] = [
	{ value: 'open', label: 'Open' },
	{ value: 'resolved', label: 'Resolved' },
	{ value: 'dismissed', label: 'Dismissed' },
	{ value: 'all', label: 'All' }
];
const accountFilters: { value: AccountFilter; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'reported', label: 'Reported' },
	{ value: 'banned', label: 'Banned' },
	{ value: 'muted', label: 'Muted' },
	{ value: 'staff', label: 'Staff' }
];

/** A row of filter buttons, the active one filled. */
function Filters<T extends string>({
	options,
	value,
	onChange
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
			{options.map((o) => (
				<Button
					key={o.value}
					size="sm"
					variant={value === o.value ? 'primary' : 'default'}
					label={o.label}
					onPress={() => onChange(o.value)}
				/>
			))}
		</View>
	);
}

/** Text typed in a field, settled 300 ms after the last key. */
function useDebounced(value: string) {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value.trim().replace(/^@/, '')), 300);
		return () => clearTimeout(timer);
	}, [value]);
	return settled;
}

/** Moderation: reports, accounts, the log and (admins) instance settings. */
export default function Admin() {
	const params = useLocalSearchParams<{ tab?: Tab; username?: string }>();
	const { me, reloadMe } = useSession();
	const admin = me?.role === 'admin';
	const [tab, setTab] = useState<Tab>(params.tab ?? 'reports');
	const [overview, setOverview] = useState<Overview | null>(null);
	const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
	const [flash, setFlash] = useState<{ message: string; failed: boolean } | null>(null);

	const loadOverview = useCallback(() => {
		api<Overview>('admin/overview')
			.then(setOverview)
			.catch(() => {});
	}, []);
	useEffect(loadOverview, [loadOverview]);

	// an action anywhere (here, the action screen, a case page) changes the counts
	const changed = useCallback(
		(message?: string, failed = false) => {
			if (message) setFlash({ message, failed });
			if (failed) return;
			loadOverview();
			reloadMe().catch(() => {});
			emit('moderation_reload');
		},
		[loadOverview, reloadMe]
	);
	useBus('moderation_changed', () => changed());

	const tabs: { value: Tab; label: string }[] = [
		{
			value: 'reports',
			label: overview?.open_reports ? `Reports (${overview.open_reports})` : 'Reports'
		},
		{ value: 'accounts', label: 'Accounts' },
		{ value: 'log', label: 'Log' },
		...(admin ? [{ value: 'settings' as const, label: 'Settings' }] : [])
	];

	const showAccounts = (filter: AccountFilter) => {
		setAccountFilter(filter);
		setTab('accounts');
	};

	const header = (
		<View>
			<Stack.Screen options={{ title: 'Moderation' }} />
			<View style={{ padding: 20, paddingBottom: 10, gap: 10 }}>
				<Txt size={13} muted>
					You are {admin ? 'an admin' : 'a mod'}
				</Txt>
				{overview ? (
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
						<StatTile
							label="Open reports"
							value={overview.open_reports}
							alert={overview.open_reports > 0}
							onPress={() => setTab('reports')}
						/>
						<StatTile
							label="Banned"
							value={overview.banned}
							onPress={() => showAccounts('banned')}
						/>
						<StatTile label="Muted" value={overview.muted} onPress={() => showAccounts('muted')} />
						<StatTile
							label="New this week"
							value={overview.new_accounts}
							onPress={() => showAccounts('all')}
						/>
					</View>
				) : null}
			</View>
			<TabRow tabs={tabs} value={tab} onChange={setTab} />
			{flash ? (
				<Pressable
					onPress={() => setFlash(null)}
					style={{
						margin: 20,
						marginBottom: 0,
						borderRadius: 5,
						padding: 5,
						backgroundColor: flash.failed ? colors.danger : colors.accent
					}}
				>
					<Txt style={{ color: flash.failed ? '#fff' : colors.background }}>{flash.message}</Txt>
				</Pressable>
			) : null}
		</View>
	);

	if (tab === 'reports')
		return <ReportsTab header={header} username={params.username} onChange={changed} />;
	if (tab === 'accounts')
		return <AccountsTab header={header} filter={accountFilter} setFilter={setAccountFilter} />;
	if (tab === 'log') return <LogTab header={header} />;
	return <SettingsTab header={header} onStaff={() => showAccounts('staff')} />;
}

function ReportsTab({
	header,
	username,
	onChange
}: {
	header: React.ReactElement;
	username?: string;
	onChange: (message: string, failed?: boolean) => void;
}) {
	const [status, setStatus] = useState<ReportFilter>('open');
	const [account, setAccount] = useState(username ?? '');
	const list = usePaged<Report>(
		withQuery('admin/reports', { status, username: account }),
		(r) => r.id,
		25
	);
	useBus('moderation_reload', () => list.reload(true));

	return (
		<FlatList
			data={list.items}
			keyExtractor={(r) => String(r.id)}
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			keyboardDismissMode="on-drag"
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			ListHeaderComponent={
				<View>
					{header}
					<View style={{ padding: 20, paddingBottom: 10, gap: 10 }}>
						<Filters options={reportFilters} value={status} onChange={setStatus} />
						{account ? (
							<Txt size={14}>
								Reports against @{account}{' '}
								<Txt size={14} muted onPress={() => setAccount('')} suppressHighlighting>
									· Show everyone’s
								</Txt>
							</Txt>
						) : null}
					</View>
				</View>
			}
			ListEmptyComponent={
				list.loading || list.error ? (
					<ListState loading={list.loading} error={list.error} empty="" />
				) : (
					<View style={{ alignItems: 'center', gap: 10, padding: 40 }}>
						<Inbox size={32} color={colors.muted} />
						<Txt muted style={{ textAlign: 'center' }}>
							{status === 'open'
								? 'No open reports. All caught up.'
								: `No ${status === 'all' ? '' : `${status} `}reports.`}
						</Txt>
					</View>
				)
			}
			renderItem={({ item }) => (
				<View style={{ paddingHorizontal: 20, paddingVertical: 5 }}>
					<ReportCard
						report={item}
						onChange={(message, failed) => {
							onChange(message, failed);
						}}
					/>
				</View>
			)}
			ListFooterComponent={<View style={{ height: 40 }} />}
		/>
	);
}

function AccountsTab({
	header,
	filter,
	setFilter
}: {
	header: React.ReactElement;
	filter: AccountFilter;
	setFilter: (filter: AccountFilter) => void;
}) {
	const [query, setQuery] = useState('');
	const search = useDebounced(query);
	const list = usePaged<AdminUser>(
		withQuery('admin/users', { q: search, filter }),
		(u) => u.username,
		25
	);
	useBus('moderation_reload', () => list.reload(true));

	// a search that found the account through one of its identities says which
	const matchedIdentity = (u: AdminUser) => {
		const q = search.toLowerCase();
		if (!q || u.username.includes(q) || u.name.toLowerCase().includes(q)) return null;
		return (
			[...u.identities, ...u.shared_with].find(
				(i) => i.username.includes(q) || i.name.toLowerCase().includes(q)
			) ?? null
		);
	};

	return (
		<FlatList
			data={list.items}
			keyExtractor={(u) => u.username}
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			keyboardDismissMode="on-drag"
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			ListHeaderComponent={
				<View>
					{header}
					<View style={{ padding: 20, paddingBottom: 10, gap: 12 }}>
						<Input
							value={query}
							onChangeText={setQuery}
							placeholder="Search accounts, identities and bots"
							autoCorrect={false}
						/>
						<Filters options={accountFilters} value={filter} onChange={setFilter} />
					</View>
				</View>
			}
			ListEmptyComponent={
				<ListState loading={list.loading} error={list.error} empty="No accounts found." />
			}
			renderItem={({ item }) => {
				const via = matchedIdentity(item);
				const until = item.banned_at ? item.banned_until : item.muted_at ? item.muted_until : null;
				return (
					<Pressable
						onPress={() => router.push(`/admin/user/${item.username}`)}
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
						<Avatar user={item} size={40} />
						<View style={{ flex: 1, gap: 3 }}>
							<Txt bold numberOfLines={1}>
								{item.name}{' '}
								<Txt size={14} dim={0.7}>
									@{item.username}
								</Txt>
							</Txt>
							<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
								{item.role !== 'user' ? <Badge label={item.role} tone="accent" /> : null}
								{item.banned_at ? <Badge label="banned" tone="danger" /> : null}
								{item.muted_at ? <Badge label="muted" tone="danger" /> : null}
								{item.open_reports ? (
									<Badge
										solid
										tone="danger"
										label={`${item.open_reports} ${item.open_reports === 1 ? 'report' : 'reports'}`}
									/>
								) : null}
								{item.self ? <Badge label="you" /> : null}
							</View>
							<Txt size={13} muted numberOfLines={2}>
								{via
									? `found through @${via.username}`
									: item.banned_at || item.muted_at
									? until
										? `ends ${relative(until)}`
										: 'permanent'
									: `joined ${fullDate(item.created_at)}`}
								{item.identities.length
									? ` · ${item.identities.length} ${
											item.identities.length === 1 ? 'identity' : 'identities'
									  }`
									: ''}
							</Txt>
						</View>
					</Pressable>
				);
			}}
			ListFooterComponent={<View style={{ height: 40 }} />}
		/>
	);
}

function LogTab({ header }: { header: React.ReactElement }) {
	const [account, setAccount] = useState('');
	const [actor, setActor] = useState('');
	const [action, setAction] = useState('');
	const username = useDebounced(account);
	const staff = useDebounced(actor);
	const filtered = !!(username || staff || action);
	const list = usePaged<LogEntry>(
		withQuery('admin/log', { username, actor: staff, action }),
		(e) => e.id,
		30
	);
	useBus('moderation_reload', () => list.reload(true));

	const pickAction = () =>
		showMenu([
			{ label: 'Any action', onPress: () => setAction('') },
			...Object.entries(LOG_ACTIONS).map(([value, label]) => ({
				label,
				onPress: () => setAction(value)
			}))
		]);

	return (
		<FlatList
			data={list.items}
			keyExtractor={(e) => String(e.id)}
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			keyboardDismissMode="on-drag"
			onEndReached={list.loadMore}
			onEndReachedThreshold={0.6}
			refreshControl={
				<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} {...refreshColors} />
			}
			ListHeaderComponent={
				<View>
					{header}
					<View style={{ padding: 20, paddingBottom: 10, gap: 12 }}>
						<View style={{ flexDirection: 'row', gap: 10 }}>
							<View style={{ flex: 1 }}>
								<Field
									label="Account"
									placeholder="@username"
									value={account}
									onChangeText={setAccount}
									autoCorrect={false}
								/>
							</View>
							<View style={{ flex: 1 }}>
								<Field
									label="Staff member"
									placeholder="@username"
									value={actor}
									onChangeText={setActor}
									autoCorrect={false}
								/>
							</View>
						</View>
						<View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
							<Pressable
								onPress={pickAction}
								accessibilityRole="button"
								accessibilityLabel="Filter by action"
								style={{
									flex: 1,
									flexDirection: 'row',
									alignItems: 'center',
									borderBottomWidth: 1,
									borderBottomColor: colors.line,
									paddingVertical: 8
								}}
							>
								<Txt style={{ flex: 1 }} muted={!action}>
									{action ? LOG_ACTIONS[action] : 'Any action'}
								</Txt>
								<ChevronDown size={18} color={colors.muted} />
							</Pressable>
							{filtered ? (
								<Button
									size="sm"
									label="Clear"
									onPress={() => {
										setAccount('');
										setActor('');
										setAction('');
									}}
								/>
							) : null}
						</View>
					</View>
				</View>
			}
			ListEmptyComponent={
				<ListState
					loading={list.loading}
					error={list.error}
					empty={filtered ? 'Nothing matches these filters.' : 'Nothing has been logged yet.'}
				/>
			}
			renderItem={({ item }) => <LogEntryRow entry={item} />}
			ListFooterComponent={<View style={{ height: 40 }} />}
		/>
	);
}

type Motd = { motd: string; custom: boolean; default: string; max: number };

function SettingsTab({ header, onStaff }: { header: React.ReactElement; onStaff: () => void }) {
	const [motd, setMotd] = useState<Motd | null>(null);
	const [motdError, setMotdError] = useState<string | null>(null);
	const [groupId, setGroupId] = useState('');
	const [group, setGroup] = useState<AdminGroup | null>(null);
	const [reason, setReason] = useState('');
	const [groupFlash, setGroupFlash] = useState<{ message: string; failed: boolean } | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<Motd>('admin/motd')
			.then(setMotd)
			.catch((e) => setMotdError(errorMessage(e)));
	}, []);

	async function editMotd() {
		if (!motd) return;
		const value = await ask({
			title: 'Message of the day',
			message: `Shown in the post composer. Leave it empty for the default (“${motd.default}”).`,
			initial: motd.custom ? motd.motd : '',
			maxLength: motd.max,
			confirm: 'Save'
		});
		if (value === null) return;
		try {
			const res = await api<{ motd: string; message: string }>('admin/motd', {
				method: 'PUT',
				body: { motd: value.trim() }
			});
			setMotd({ ...motd, motd: res.motd, custom: !!value.trim() });
			toast(res.message);
		} catch (e) {
			setMotdError(errorMessage(e));
		}
	}

	async function findGroup() {
		const id = groupId.trim();
		if (!/^\d+$/.test(id)) {
			setGroupFlash({ message: 'A group id is a number.', failed: true });
			return;
		}
		setBusy(true);
		setGroup(null);
		setGroupFlash(null);
		try {
			setGroup(await api<AdminGroup>(`admin/groups/${id}`));
		} catch (e) {
			setGroupFlash({ message: errorMessage(e), failed: true });
		} finally {
			setBusy(false);
		}
	}

	async function deleteGroup() {
		if (!group) return;
		const ok = await confirm(
			'Delete group?',
			`Delete “${group.name}” for all ${group.members.length} members? Its ${group.messages} messages and images go with it. This can’t be undone.`,
			'Delete',
			true
		);
		if (!ok) return;
		setBusy(true);
		try {
			const res = await api<{ message: string }>(`admin/groups/${group.id}`, {
				method: 'DELETE',
				body: { reason: reason.trim() }
			});
			setGroupFlash({ message: res.message, failed: false });
			setGroup(null);
			setGroupId('');
			setReason('');
			emit('moderation_changed');
		} catch (e) {
			setGroupFlash({ message: errorMessage(e), failed: true });
		} finally {
			setBusy(false);
		}
	}

	const flashView = (flash: { message: string; failed: boolean } | null) =>
		flash ? (
			<View
				style={{
					borderRadius: 5,
					padding: 5,
					backgroundColor: flash.failed ? colors.danger : colors.accent
				}}
			>
				<Txt style={{ color: flash.failed ? '#fff' : colors.background }}>{flash.message}</Txt>
			</View>
		) : null;

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			automaticallyAdjustKeyboardInsets
			keyboardDismissMode="on-drag"
		>
			{header}
			<View style={{ padding: 20 }}>
				<Section title="Message of the day">
					<ErrorBanner message={motdError} />
					{motd ? (
						<>
							<Txt muted>{motd.motd}</Txt>
							<Hint>
								Shown in the post composer.{' '}
								{motd.custom ? 'Custom.' : `This is the default (“${motd.default}”).`}
							</Hint>
							<Button
								size="sm"
								label="Edit"
								style={{ alignSelf: 'flex-start' }}
								onPress={editMotd}
							/>
						</>
					) : !motdError ? (
						<Loading />
					) : null}
				</Section>

				<Section title="Delete a group">
					<Hint>
						Deletes a group chat with all its messages and images for everyone in it. The id is the
						number in the group’s address on the web (/messages/groups/123).
					</Hint>
					{flashView(groupFlash)}
					<View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
						<View style={{ flex: 1 }}>
							<Field
								label="Group id"
								value={groupId}
								onChangeText={setGroupId}
								keyboardType="number-pad"
								onSubmitEditing={findGroup}
							/>
						</View>
						<Button label="Find" loading={busy && !group} onPress={findGroup} />
					</View>
					{group ? (
						<View
							style={{ backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 10, padding: 10, gap: 10 }}
						>
							<View>
								<Txt bold>{group.name}</Txt>
								<Txt size={13} muted>
									#{group.id} · {group.members.length}{' '}
									{group.members.length === 1 ? 'member' : 'members'} · {group.messages}{' '}
									{group.messages === 1 ? 'message' : 'messages'} · created{' '}
									{fullDate(group.created_at)}
								</Txt>
							</View>
							<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
								{group.members.map((m) => (
									<Pressable
										key={m.username}
										onPress={() => router.push(`/admin/user/${m.username}`)}
										style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
									>
										<Avatar user={m} size={24} />
										<Txt size={14} accent>
											@{m.username}
										</Txt>
										{m.username === group.owner ? (
											<Txt size={12} muted>
												owner
											</Txt>
										) : null}
									</Pressable>
								))}
							</View>
							<Field
								label="Reason, for the moderation log (optional)"
								value={reason}
								onChangeText={setReason}
								maxLength={200}
								autoCapitalize="sentences"
							/>
							<Button
								variant="danger"
								label="Delete for everyone"
								style={{ alignSelf: 'flex-start' }}
								loading={busy}
								onPress={deleteGroup}
							/>
						</View>
					) : null}
				</Section>

				<Section title="Staff">
					<Hint>
						Make someone a mod from their case page (Accounts → the account → Admin). Mods handle
						reports, ban, mute and delete posts of regular users. Admins also reset passwords and
						manage mods; new admins are made on the server.
					</Hint>
					<Button
						size="sm"
						label="See the staff"
						style={{ alignSelf: 'flex-start' }}
						onPress={onStaff}
					/>
				</Section>
			</View>
		</ScrollView>
	);
}
