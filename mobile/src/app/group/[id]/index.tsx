import { useLocalSearchParams } from 'expo-router';
import { ChatView } from '@/components/ChatView';

export default function GroupChat() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return <ChatView kind="group" id={Number(id)} />;
}
