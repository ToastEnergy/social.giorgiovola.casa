import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { expiresIn, linkOf, STATUS_LABELS } from '@/lib/invites';
import { colors, fonts } from '@/lib/theme';
import type { Invite } from '@/lib/types';
import { Badge } from './moderation';
import { confirm } from './overlays';
import { Avatar, Button, Txt } from './ui';

/** Copies an invite link. Says whether it worked. */
export const copyLink = (invite: Invite) =>
	Clipboard.setStringAsync(linkOf(invite)).catch(() => false);

/** The share sheet with an invite link. */
export const shareLink = (invite: Invite) =>
	Share.share({ message: linkOf(invite) }).catch(() => {});

/** One invite code in a list (the web app's InviteList): who it is for, its state, its actions. */
export function InviteRow({
	invite,
	admin = false,
	showStatus = true,
	onChange
}: {
	invite: Invite;
	/** the admin list: shows who made the code, and revokes through the admin API */
	admin?: boolean;
	/** the status pill; a list of only pending codes doesn't need it */
	showStatus?: boolean;
	/** after the code was revoked, with what to tell */
	onChange?: (message: string, failed?: boolean) => void;
}) {
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const pending = invite.status === 'pending';
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	async function copy() {
		if (!(await copyLink(invite))) {
			onChange?.('Could not copy the link.', true);
			return;
		}
		setCopied(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setCopied(false), 2000);
	}

	async function revoke() {
		const who = invite.note ? ` for ${invite.note}` : '';
		const ok = await confirm(
			'Revoke invite?',
			`Revoke the invite${who} (${invite.code})? The link stops working right away.`,
			'Revoke',
			true
		);
		if (!ok) return;
		setBusy(true);
		try {
			const res = await api<{ message: string }>(`${admin ? 'admin' : 'me'}/invites/${invite.id}`, {
				method: 'DELETE'
			});
			onChange?.(res.message);
		} catch (e) {
			onChange?.(errorMessage(e), true);
		} finally {
			setBusy(false);
		}
	}

	const profile = (username: string) =>
		router.push(admin ? `/admin/user/${username}` : `/user/${username}`);

	return (
		<View
			style={{
				paddingVertical: 10,
				paddingHorizontal: 20,
				gap: 8,
				borderBottomWidth: 1,
				borderBottomColor: colors.line
			}}
		>
			<View style={{ gap: 5, opacity: pending ? 1 : 0.7 }}>
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
					{invite.note ? (
						<Txt bold numberOfLines={1} style={{ flexShrink: 1 }}>
							{invite.note}
						</Txt>
					) : (
						<Txt muted style={{ fontStyle: 'italic', flexShrink: 1 }}>
							No note
						</Txt>
					)}
					{showStatus ? (
						<Badge label={STATUS_LABELS[invite.status]} tone={pending ? 'accent' : 'line'} />
					) : null}
				</View>
				<View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
					<Txt
						size={13}
						muted
						selectable={pending}
						style={{
							fontFamily: fonts.mono,
							textDecorationLine: pending ? 'none' : 'line-through'
						}}
					>
						{invite.code}
					</Txt>
					{admin ? (
						<>
							<Txt size={13} muted>
								·
							</Txt>
							{invite.inviter ? (
								<Txt size={13} muted>
									by{' '}
									<Txt
										size={13}
										accent
										onPress={() => profile(invite.inviter!.username)}
										suppressHighlighting
									>
										@{invite.inviter.username}
									</Txt>
									{invite.by_staff ? ' (admin code)' : ''}
								</Txt>
							) : (
								<Txt size={13} muted>
									by a deleted account
								</Txt>
							)}
						</>
					) : null}
					<Txt size={13} muted>
						·
					</Txt>
					{invite.status === 'used' && invite.used_at ? (
						invite.used_by ? (
							<>
								<Txt size={13} muted>
									used by
								</Txt>
								<Avatar user={invite.used_by} size={20} />
								<Txt
									size={13}
									accent
									onPress={() => profile(invite.used_by!.username)}
									suppressHighlighting
								>
									@{invite.used_by.username}
								</Txt>
								<Txt size={13} muted>
									on {shortDate(invite.used_at)}
								</Txt>
							</>
						) : (
							<Txt size={13} muted>
								used {shortDate(invite.used_at)}
							</Txt>
						)
					) : pending ? (
						<Txt size={13} muted>
							{invite.expires_at ? `expires ${expiresIn(invite.expires_at)}` : 'never expires'}
						</Txt>
					) : (
						<Txt size={13} muted>
							created {shortDate(invite.created_at)}
						</Txt>
					)}
				</View>
			</View>
			{pending ? (
				<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
					<Button size="sm" label={copied ? 'Copied!' : 'Copy link'} onPress={copy} />
					<Button size="sm" label="Share…" onPress={() => shareLink(invite)} />
					<Button size="sm" variant="danger" label="Revoke" loading={busy} onPress={revoke} />
				</View>
			) : null}
		</View>
	);
}
