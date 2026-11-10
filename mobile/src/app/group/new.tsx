import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, ErrorBanner, Field, Hint } from '@/components/ui';
import { UserPicker } from '@/components/UserPicker';
import { api, errorMessage } from '@/lib/api';
import { emit } from '@/lib/bus';
import { useSession } from '@/lib/session';
import type { Group } from '@/lib/types';

export default function NewGroup() {
	const { me, instance } = useSession();
	const [name, setName] = useState('');
	const [members, setMembers] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const max = (instance?.limits.groupMembers ?? 50) - 1;

	async function create() {
		setBusy(true);
		setError(null);
		try {
			const group = await api<Group>('groups', {
				method: 'POST',
				body: { name: name.trim(), members }
			});
			emit('chats_changed');
			router.replace(`/group/${group.id}`);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<Stack.Screen options={{ title: 'New group' }} />
			<UserPicker
				placeholder="Add people"
				selected={members}
				exclude={me ? [me.user.username] : []}
				onPick={(user) =>
					setMembers((now) =>
						now.includes(user.username)
							? now.filter((u) => u !== user.username)
							: now.length < max
							? [...now, user.username]
							: now
					)
				}
				header={
					<View style={{ padding: 20, gap: 12 }}>
						<ErrorBanner message={error} />
						<Field
							label="Group name"
							value={name}
							onChangeText={setName}
							autoCapitalize="sentences"
							maxLength={instance?.limits.groupName}
						/>
						<Button
							variant="primary"
							label={`Create group${members.length ? ` with ${members.length}` : ''}`}
							disabled={!name.trim() || !members.length}
							loading={busy}
							onPress={create}
						/>
						<Hint>
							{members.length
								? `Members: ${members.map((u) => `@${u}`).join(', ')}`
								: 'Choose who to add below.'}
						</Hint>
					</View>
				}
			/>
		</>
	);
}
