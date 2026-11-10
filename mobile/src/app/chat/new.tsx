import { router } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { UserPicker } from '@/components/UserPicker';
import { useSession } from '@/lib/session';

/** Choosing who to write to. */
export default function NewChat() {
	const { me } = useSession();
	return (
		<>
			<Stack.Screen options={{ title: 'New message' }} />
			<UserPicker
				exclude={me ? [me.user.username] : []}
				onPick={(user) => router.replace(`/chat/${user.username}`)}
			/>
		</>
	);
}
