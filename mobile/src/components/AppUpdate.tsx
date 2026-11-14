import { X } from 'lucide-react-native';
import { useEffect } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
	checkForUpdate,
	dismissUpdate,
	downloadUpdate,
	installUpdate,
	updatesSupported,
	useAppUpdate
} from '@/lib/appUpdate';
import { colors } from '@/lib/theme';
import { Button, IconButton, Txt } from './ui';
import { UploadProgress } from './UploadProgress';

/**
 * Offers a newer release of the Android app (src/lib/appUpdate.ts) in a card above the screens:
 * looked for when the app starts and when it comes back to the foreground. Mounted once in the
 * root layout.
 */
export function AppUpdate() {
	if (!updatesSupported) return null;
	return <UpdateCard />;
}

function UpdateCard() {
	const update = useAppUpdate();
	const insets = useSafeAreaInsets();

	useEffect(() => {
		checkForUpdate();
		const sub = AppState.addEventListener('change', (s) => s === 'active' && checkForUpdate());
		return () => sub.remove();
	}, []);

	if (update.status === 'idle') return null;
	const failed = update.status === 'error';
	return (
		<View
			pointerEvents="box-none"
			style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 80 }}
		>
			<View
				accessibilityLiveRegion="polite"
				style={{
					flexDirection: 'row',
					alignItems: 'center',
					gap: 10,
					padding: 10,
					borderRadius: 5,
					borderWidth: 1,
					borderColor: failed ? colors.danger : colors.accent,
					backgroundColor: colors.background
				}}
			>
				{update.status === 'downloading' ? (
					<UploadProgress progress={update.progress} size={22} />
				) : null}
				<View style={{ flex: 1, gap: 5 }}>
					<Txt size={14} bold style={failed ? { color: colors.danger } : undefined}>
						{update.status === 'available'
							? `Version ${update.version} is out`
							: update.status === 'downloading'
							? `Downloading ${update.version}…`
							: update.status === 'ready'
							? `Version ${update.version} is ready`
							: 'The update failed'}
					</Txt>
					<Txt size={13} muted numberOfLines={2}>
						{update.status === 'available'
							? update.notes || 'Update to get the latest changes.'
							: update.status === 'downloading'
							? `${Math.round(update.progress * 100)}%`
							: update.status === 'ready'
							? 'Install it over this one, your accounts stay signed in.'
							: update.message}
					</Txt>
				</View>
				{update.status === 'available' || failed ? (
					<Button size="sm" label={failed ? 'Try again' : 'Update'} onPress={downloadUpdate} />
				) : update.status === 'ready' ? (
					<Button size="sm" label="Install" onPress={() => installUpdate().catch(() => {})} />
				) : null}
				{update.status !== 'downloading' ? (
					<IconButton label="Later" onPress={dismissUpdate}>
						<X size={18} color={colors.muted} />
					</IconButton>
				) : null}
			</View>
		</View>
	);
}
