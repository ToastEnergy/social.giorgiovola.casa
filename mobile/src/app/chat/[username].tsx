import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '@/components/ChatView';

export default function DirectChat() {
	const { username } = useLocalSearchParams<{ username: string }>();
	return <ChatView kind="direct" username={username.replace(/^@/, '').toLowerCase()} />;
}
