import { Pressable } from 'react-native';
import { colors } from '@/lib/theme';
import { Txt } from './ui';

/** One option of a pick-one list: a bordered row, accent-bordered when chosen. */
export function Choice({
	label,
	hint,
	selected,
	onPress,
	filled,
	compact
}: {
	label: string;
	hint?: string;
	selected: boolean;
	onPress: () => void;
	/** the chosen one fills with the accent (short options in a grid) */
	filled?: boolean;
	/** centred, for a grid of short options */
	compact?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ selected }}
			onPress={onPress}
			style={({ pressed }) => ({
				borderWidth: 1,
				borderColor: selected ? colors.accent : colors.line,
				borderRadius: compact ? 5 : 6,
				paddingVertical: 8,
				paddingHorizontal: compact ? 5 : 10,
				alignItems: compact ? 'center' : 'flex-start',
				backgroundColor:
					selected && filled ? colors.accent : selected || pressed ? colors.hover : 'transparent'
			})}
		>
			<Txt
				bold={!compact || selected}
				size={compact ? 14 : 16}
				style={selected && filled ? { color: colors.background } : undefined}
			>
				{label}
			</Txt>
			{hint ? (
				<Txt size={13} muted>
					{hint}
				</Txt>
			) : null}
		</Pressable>
	);
}
