import { router, useLocalSearchParams } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { confirm, toast } from '@/components/overlays';
import { Button, ErrorBanner, Field, Hint, Loading, Section, Txt, UserRow } from '@/components/ui';
import { UserPicker } from '@/components/UserPicker';
import { api, errorMessage } from '@/lib/api';
import { emit, useBus } from '@/lib/bus';
import { useSession } from '@/lib/session';
import type { Group } from '@/lib/types';

/** A group's name and members: rename, add people, remove them (the owner) or leave. */
export default function GroupSettings() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const { me, instance } = useSession();
	const [group, setGroup] = useState<Group | null>(null);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);

	const load = useCallback(() => {
		api<Group>(`groups/${id}`)
			.then((res) => {
				setGroup(res);
				setName(res.name);
			})
			.catch((e) => setError(errorMessage(e)));
	}, [id]);
	useEffect(load, [load]);
	useBus('group_updated', (e: { id: number }) => String(e.id) === id && load());

	const run = async (action: () => Promise<Group | void>) => {
		setError(null);
		try {
			const res = await action();
			if (res) {
				setGroup(res);
				setName(res.name);
			}
			emit('chats_changed');
		} catch (e) {
			setError(errorMessage(e));
		}
	};

	if (!group)
		return (
			<View style={{ padding: 20 }}>
				<Stack.Screen options={{ title: 'Group info' }} />
				{error ? <ErrorBanner message={error} /> : <Loading />}
			</View>
		);

	const owner = group.owner === me?.user.username;
	const leave = async () => {
		if (
			!(await confirm(
				'Leave group?',
				`You stop getting messages from “${group.name}”.`,
				'Leave',
				true
			))
		)
			return;
		try {
			await api(`groups/${id}/leave`, { method: 'POST' });
			emit('chats_changed');
			router.dismissTo('/messages');
		} catch (e) {
			setError(errorMessage(e));
		}
	};

	if (adding)
		return (
			<>
				<Stack.Screen options={{ title: 'Add people' }} />
				<UserPicker
					exclude={group.members.map((m) => m.username)}
					header={
						<View style={{ padding: 20, paddingBottom: 10, gap: 10 }}>
							<ErrorBanner message={error} />
							<Button label="Done" onPress={() => setAdding(false)} />
						</View>
					}
					onPick={(user) =>
						run(async () => {
							const res = await api<Group>(`groups/${id}/members`, {
								method: 'POST',
								body: { usernames: [user.username] }
							});
							toast(`${user.name} added`);
							return res;
						})
					}
				/>
			</>
		);

	return (
		<ScrollView contentContainerStyle={{ paddingVertical: 20 }} keyboardShouldPersistTaps="handled">
			<Stack.Screen options={{ title: 'Group info' }} />
			<View style={{ paddingHorizontal: 20 }}>
				<Section>
					<ErrorBanner message={error} />
					<Field
						label="Group name"
						value={name}
						onChangeText={setName}
						autoCapitalize="sentences"
						maxLength={instance?.limits.groupName}
					/>
					<Button
						label="Rename"
						style={{ alignSelf: 'flex-start' }}
						disabled={!name.trim() || name.trim() === group.name}
						onPress={() =>
							run(() =>
								api<Group>(`groups/${id}`, { method: 'PATCH', body: { name: name.trim() } })
							)
						}
					/>
				</Section>
				<View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
					<Txt bold size={20} style={{ flex: 1 }}>
						{group.members.length} members
					</Txt>
					<Button size="sm" label="Add people" onPress={() => setAdding(true)} />
				</View>
				<Hint>Any member can rename the group and add people; only the owner removes others.</Hint>
			</View>
			{group.members.map((member) => (
				<UserRow
					key={member.username}
					user={member}
					subtitle={member.username === group.owner ? 'Owner' : null}
					right={
						owner && member.username !== me?.user.username ? (
							<Button
								size="sm"
								variant="danger"
								label="Remove"
								onPress={async () => {
									if (
										!(await confirm(
											'Remove member?',
											`Remove ${member.name} from the group?`,
											'Remove',
											true
										))
									)
										return;
									run(async () => {
										await api(`groups/${id}/members/${member.username}`, { method: 'DELETE' });
										return api<Group>(`groups/${id}`);
									});
								}}
							/>
						) : null
					}
				/>
			))}
			<View style={{ padding: 20 }}>
				<Button variant="danger" label="Leave group" onPress={leave} />
			</View>
		</ScrollView>
	);
}
