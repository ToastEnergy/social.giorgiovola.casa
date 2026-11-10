import { router, useLocalSearchParams } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { toast } from '@/components/overlays';
import { Avatar, ErrorBanner, Input, Txt } from '@/components/ui';
import { UserPicker } from '@/components/UserPicker';
import { api, auth, errorMessage } from '@/lib/api';
import { emit } from '@/lib/bus';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import type { ShareTarget } from '@/lib/types';

/** Sending a post to someone or a group: a message with its link, which shows the post. */
export default function SharePost() {
	const { post, username } = useLocalSearchParams<{ post: string; username: string }>();
	const { me } = useSession();
	const [targets, setTargets] = useState<ShareTarget[]>([]);
	const [note, setNote] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<{ recent: ShareTarget[] }>('share-targets')
			.then((res) => setTargets(res.recent))
			.catch(() => {});
	}, []);

	async function send(path: string, name: string) {
		if (busy) return;
		setBusy(true);
		const link = `${auth.server}/@${username}/${post}`;
		try {
			await api(`${path}/messages`, {
				method: 'POST',
				body: { content: note.trim() ? `${note.trim()}\n${link}` : link }
			});
			emit('chats_changed');
			toast(`Sent to ${name}`);
			router.back();
		} catch (e) {
			setError(errorMessage(e));
			setBusy(false);
		}
	}

	return (
		<UserPicker
			placeholder="Search people"
			exclude={me ? [me.user.username] : []}
			onPick={(user) => send(`conversations/${user.username}`, user.name)}
			header={
				<View style={{ padding: 20, paddingBottom: 10, gap: 12 }}>
					<ErrorBanner message={error} />
					<Input
						value={note}
						onChangeText={setNote}
						placeholder="Add a message (optional)"
						autoCapitalize="sentences"
					/>
					{targets.length ? (
						<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
							{targets.map((target) => {
								const name = target.kind === 'group' ? target.group.name : target.peer.name;
								return (
									<Pressable
										key={
											target.kind === 'group' ? `g${target.group.id}` : `u${target.peer.username}`
										}
										accessibilityLabel={`Send to ${name}`}
										onPress={() =>
											send(
												target.kind === 'group'
													? `groups/${target.group.id}`
													: `conversations/${target.peer.username}`,
												name
											)
										}
										style={{ width: 64, alignItems: 'center', gap: 4 }}
									>
										{target.kind === 'user' ? (
											<Avatar user={target.peer} size={48} />
										) : (
											<View
												style={{
													width: 48,
													height: 48,
													borderRadius: 24,
													borderWidth: 1,
													borderColor: colors.line,
													alignItems: 'center',
													justifyContent: 'center'
												}}
											>
												<Users size={22} color={colors.foreground} />
											</View>
										)}
										<Txt size={12} numberOfLines={1}>
											{name}
										</Txt>
									</Pressable>
								);
							})}
						</View>
					) : null}
				</View>
			}
		/>
	);
}
