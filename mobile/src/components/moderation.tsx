import { router } from 'expo-router';
import {
	Ban,
	Clock,
	Flag,
	KeyRound,
	MicOff,
	NotebookPen,
	RotateCcw,
	Shield,
	Trash2,
	UserRound
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { count, fullDate } from '@/lib/format';
import { actionHref, categoryLabel, LOG_ACTIONS, relative } from '@/lib/moderation';
import { colors } from '@/lib/theme';
import type { LogEntry, Report, ReportStatus } from '@/lib/types';
import { confirm } from './overlays';
import { Avatar, Button, Input, Txt } from './ui';

// the pieces of the staff screens (the web app's src/lib/components/moderation/)

/** A small pill: a role, "banned", a report's status. */
export function Badge({
	label,
	tone = 'line',
	solid
}: {
	label: string;
	tone?: 'accent' | 'danger' | 'line';
	solid?: boolean;
}) {
	const color = tone === 'accent' ? colors.accent : tone === 'danger' ? colors.danger : colors.line;
	return (
		<View
			style={{
				borderWidth: 1,
				borderColor: color,
				backgroundColor: solid ? color : 'transparent',
				borderRadius: 999,
				paddingHorizontal: 8
			}}
		>
			<Txt
				size={12}
				bold
				style={{
					color: solid ? colors.background : tone === 'line' ? colors.muted : color
				}}
			>
				{label}
			</Txt>
		</View>
	);
}

/** A number with its label, in a bordered tile (red when it needs attention). */
export function StatTile({
	label,
	value,
	alert,
	onPress
}: {
	label: string;
	value: number;
	alert?: boolean;
	onPress?: () => void;
}) {
	return (
		<Pressable
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => ({
				flexBasis: '47%',
				flexGrow: 1,
				borderWidth: 1,
				borderColor: alert ? colors.danger : colors.line,
				borderRadius: 10,
				padding: 10,
				backgroundColor: pressed ? colors.hover : 'transparent'
			})}
		>
			<Txt extrabold size={22} style={alert ? { color: colors.danger } : undefined}>
				{count(value)}
			</Txt>
			<Txt size={13} muted>
				{label}
			</Txt>
		</Pressable>
	);
}

const statusTone = { open: 'danger', resolved: 'accent', dismissed: 'line' } as const;

/** A report with what staff can do about it. */
export function ReportCard({
	report,
	onChange,
	compact
}: {
	report: Report;
	/** something changed: what to tell the staff member, and whether it failed */
	onChange: (message: string, failed?: boolean) => void;
	/** hides who the report is against (the case page already says) */
	compact?: boolean;
}) {
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const open = report.status === 'open';
	const post = report.post;
	const account = report.account;

	async function setStatus(status: ReportStatus, related = false) {
		setBusy(true);
		try {
			const res = await api<{ message: string }>(`admin/reports/${report.id}`, {
				method: 'PATCH',
				body: { status, note: note.trim(), related }
			});
			setNote('');
			onChange(res.message);
		} catch (e) {
			onChange(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	async function deletePost() {
		if (!post?.id) return;
		if (
			!(await confirm(
				'Delete post?',
				`Delete this post by @${report.target.username}? Its replies go with it.`,
				'Delete',
				true
			))
		)
			return;
		setBusy(true);
		try {
			await api(`posts/${post.id}`, { method: 'DELETE' });
			onChange('Post deleted, its reports are resolved.');
		} catch (e) {
			onChange(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	const openSubject = () =>
		router.push(post?.id && !post.deleted ? `/post/${post.id}` : `/user/${report.target.username}`);

	return (
		<View
			style={{
				borderWidth: 1,
				borderColor: colors.line,
				borderRadius: 6,
				padding: 10,
				gap: 10,
				opacity: open ? 1 : 0.85
			}}
		>
			<View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
					{report.kind === 'post' ? (
						<Flag size={15} color={colors.foreground} />
					) : (
						<UserRound size={15} color={colors.foreground} />
					)}
					<Txt bold>{categoryLabel(report.category)}</Txt>
				</View>
				<Badge label={report.status} tone={statusTone[report.status]} />
				{open && report.related_open > 0 ? (
					<Badge
						solid
						tone="danger"
						label={`+${report.related_open} more ${
							report.related_open === 1 ? 'report' : 'reports'
						}`}
					/>
				) : null}
				<Txt size={12} muted style={{ marginLeft: 'auto' }}>
					#{report.id} · {fullDate(report.created_at)}
				</Txt>
			</View>

			{!compact ? (
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
					<Avatar user={report.target} size={36} link />
					<View style={{ flex: 1 }}>
						<Txt bold numberOfLines={1}>
							{report.target.name}{' '}
							<Txt size={14} dim={0.7}>
								@{report.target.username}
							</Txt>
						</Txt>
						<Txt size={13} muted>
							{account.username !== report.target.username
								? `identity of @${account.username} · `
								: ''}
							{account.role}
							{account.banned ? (
								<Txt size={13} style={{ color: colors.danger }}>
									{' '}
									· banned
								</Txt>
							) : null}
							{account.muted ? (
								<Txt size={13} style={{ color: colors.danger }}>
									{' '}
									· muted
								</Txt>
							) : null}
						</Txt>
					</View>
					<Button
						size="sm"
						label="Case"
						onPress={() => router.push(`/admin/user/${account.username}`)}
					/>
				</View>
			) : null}

			{post ? (
				<Pressable
					disabled={post.deleted}
					onPress={openSubject}
					style={({ pressed }) => ({
						borderLeftWidth: 2,
						borderLeftColor: pressed ? colors.accent : colors.line,
						backgroundColor: colors.hover,
						borderRadius: 6,
						padding: 10,
						gap: 5
					})}
				>
					<Txt size={13} muted>
						{post.deleted ? 'Post deleted · copy taken when reported' : 'Reported post'}
						{post.edited ? ' · edited since' : ''}
					</Txt>
					{post.content ? <Txt numberOfLines={6}>{post.content}</Txt> : null}
					{post.images.length ? (
						<Txt size={13} muted>
							{post.images.length} {post.images.length === 1 ? 'image' : 'images'}
						</Txt>
					) : null}
				</Pressable>
			) : compact ? (
				<Txt size={14} accent onPress={openSubject} suppressHighlighting>
					Reported profile @{report.target.username}
				</Txt>
			) : null}

			<Txt size={13} muted>
				Reported by{' '}
				<Txt
					size={13}
					onPress={() => router.push(`/user/${report.reporter.username}`)}
					suppressHighlighting
				>
					@{report.reporter.username}
				</Txt>
			</Txt>
			{report.details ? (
				<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 }}>
					<Txt size={14}>{report.details}</Txt>
				</View>
			) : null}

			{!open ? (
				<>
					<Txt size={13} muted>
						{report.status === 'resolved' ? 'Resolved' : 'Dismissed'}
						{report.resolved_by ? ` by @${report.resolved_by}` : ''}
						{report.resolved_at ? ` · ${fullDate(report.resolved_at)}` : ''}
						{report.resolution_note ? <Txt size={13}>{`\n“${report.resolution_note}”`}</Txt> : null}
					</Txt>
					<Button
						size="sm"
						label="Reopen"
						style={{ alignSelf: 'flex-start' }}
						disabled={busy}
						onPress={() => setStatus('open')}
					/>
				</>
			) : (
				<>
					<Input
						value={note}
						onChangeText={setNote}
						maxLength={500}
						placeholder="Note for the staff (optional)"
						accessibilityLabel="Note for the staff"
						autoCapitalize="sentences"
						style={{ fontSize: 14, paddingVertical: 5 }}
					/>
					<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
						<Button
							size="sm"
							variant="primary"
							disabled={busy}
							label={report.related_open > 0 ? `Resolve all ${report.related_open + 1}` : 'Resolve'}
							onPress={() => setStatus('resolved', true)}
						/>
						<Button
							size="sm"
							disabled={busy}
							label={report.related_open > 0 ? 'Dismiss all' : 'Dismiss'}
							onPress={() => setStatus('dismissed', true)}
						/>
						{report.can_moderate ? (
							<>
								{post && post.id && !post.deleted ? (
									<Button
										size="sm"
										variant="danger"
										disabled={busy}
										label="Delete post"
										onPress={deletePost}
									/>
								) : null}
								{!account.muted ? (
									<Button
										size="sm"
										label="Mute…"
										onPress={() => router.push(actionHref(account.username, 'mute'))}
									/>
								) : null}
								{!account.banned ? (
									<Button
										size="sm"
										variant="danger"
										label="Ban…"
										onPress={() => router.push(actionHref(account.username, 'ban'))}
									/>
								) : null}
							</>
						) : null}
					</View>
				</>
			)}
		</View>
	);
}

const logIcons: Record<string, typeof Shield> = {
	ban: Ban,
	unban: RotateCcw,
	mute: MicOff,
	unmute: RotateCcw,
	role: Shield,
	password: KeyRound,
	delete_post: Trash2,
	delete_group: Trash2,
	note: NotebookPen,
	report_resolved: Flag,
	report_dismissed: Flag,
	report_reopened: Flag
};

/** One line of the moderation log. */
export function LogEntryRow({ entry, compact }: { entry: LogEntry; compact?: boolean }) {
	const d = (entry.details ?? {}) as Record<string, unknown>;
	const expired = d.expired === true;
	const Icon = expired ? Clock : logIcons[entry.action] ?? Shield;
	const danger = ['ban', 'mute', 'delete_post', 'delete_group'].includes(entry.action);
	const tone = danger ? colors.danger : entry.action === 'note' ? colors.accent : colors.muted;
	const reports = Array.isArray(d.reports) ? d.reports.length : 0;
	const members = Array.isArray(d.members) ? (d.members as string[]) : null;

	const extras = [
		entry.expires_at
			? `ends ${relative(entry.expires_at)}`
			: entry.action === 'ban' || entry.action === 'mute'
			? 'permanent'
			: '',
		entry.action === 'role' ? `${d.from} → ${d.to}` : '',
		entry.action === 'delete_group' && typeof d.name === 'string' ? `“${d.name}”` : '',
		reports > 1 ? `${reports} reports` : ''
	].filter(Boolean);

	return (
		<View
			style={{
				flexDirection: 'row',
				gap: 10,
				paddingVertical: 10,
				paddingHorizontal: 20,
				borderBottomWidth: 1,
				borderBottomColor: colors.line
			}}
		>
			<View
				style={{
					width: 28,
					height: 28,
					marginTop: 2,
					borderRadius: 14,
					borderWidth: 1,
					borderColor: danger || entry.action === 'note' ? tone : colors.line,
					alignItems: 'center',
					justifyContent: 'center'
				}}
			>
				<Icon size={14} color={tone} />
			</View>
			<View style={{ flex: 1, gap: 5 }}>
				<Txt size={15}>
					<Txt bold size={15}>
						{LOG_ACTIONS[entry.action] ?? entry.action}
					</Txt>
					{!compact && entry.target ? (
						<>
							<Txt muted size={15}>
								{' · '}
							</Txt>
							<Txt
								size={15}
								accent
								onPress={() => router.push(`/admin/user/${entry.target}`)}
								suppressHighlighting
							>
								@{entry.target}
							</Txt>
						</>
					) : null}
					{extras.length ? (
						<Txt muted size={15}>
							{' · '}
							{extras.join(' · ')}
						</Txt>
					) : null}
				</Txt>
				{entry.action === 'note' && entry.reason ? (
					<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 10 }}>
						<Txt size={14}>{entry.reason}</Txt>
					</View>
				) : entry.reason ? (
					<Txt size={14} dim={0.8}>
						“{entry.reason}”
					</Txt>
				) : null}
				{entry.action === 'delete_post' && typeof d.content === 'string' ? (
					<View
						style={{
							borderLeftWidth: 2,
							borderLeftColor: colors.line,
							backgroundColor: colors.hover,
							borderRadius: 6,
							padding: 10
						}}
					>
						<Txt size={14} numberOfLines={4}>
							{d.author && d.author !== entry.target ? (
								<Txt size={14} muted>
									@{String(d.author)}:{' '}
								</Txt>
							) : null}
							{d.content || '(no text)'}
						</Txt>
					</View>
				) : null}
				{entry.action === 'delete_group' && members ? (
					<Txt size={14} muted>
						{members.length} {members.length === 1 ? 'member' : 'members'}
						{members.length ? `: ${members.map((u) => `@${u}`).join(', ')}` : ''}
						{typeof d.messages === 'number'
							? ` · ${d.messages} ${d.messages === 1 ? 'message' : 'messages'}`
							: ''}
					</Txt>
				) : null}
				<Txt size={13} muted>
					{expired ? 'ran out' : entry.system ? 'system' : `by @${entry.actor}`} ·{' '}
					{fullDate(entry.created_at)}
				</Txt>
			</View>
		</View>
	);
}
