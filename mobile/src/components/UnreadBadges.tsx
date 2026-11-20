import { MessageCircle } from 'lucide-react-native';
import { View } from 'react-native';
import { Txt } from '@/components/ui';
import { colors } from '@/lib/theme';

const cap = (n: number) => (n > 99 ? '99+' : String(n));

// mirrors the web's UnreadBadges: notifications a filled pill, messages an outlined one with the
// chat bubble of the messages tab
export function UnreadBadges({
	notifications,
	messages
}: {
	notifications: number;
	messages: number;
}) {
	return (
		<>
			{notifications > 0 ? (
				<View
					accessible
					accessibilityLabel={`${notifications} unread notifications`}
					style={{
						backgroundColor: colors.accent,
						borderWidth: 1,
						borderColor: colors.accent,
						borderRadius: 999,
						minWidth: 20,
						paddingHorizontal: 6,
						alignItems: 'center'
					}}
				>
					<Txt size={12} bold style={{ color: colors.background }}>
						{cap(notifications)}
					</Txt>
				</View>
			) : null}
			{messages > 0 ? (
				<View
					accessible
					accessibilityLabel={`${messages} unread messages`}
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						gap: 3,
						borderWidth: 1,
						borderColor: colors.accent,
						borderRadius: 999,
						minWidth: 20,
						paddingHorizontal: 6,
						justifyContent: 'center'
					}}
				>
					<MessageCircle size={11} color={colors.accent} />
					<Txt size={12} bold style={{ color: colors.accent }}>
						{cap(messages)}
					</Txt>
				</View>
			) : null}
		</>
	);
}
