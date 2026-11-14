import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import {
	appVersion,
	checkForUpdate,
	dismissUpdate,
	downloadUpdate,
	installUpdate,
	updatesSupported,
	useAppUpdate
} from '@/lib/appUpdate';
import { colors } from '@/lib/theme';
import { toast } from './overlays';
import { Button, Hint, IconButton, Txt } from './ui';
import { UploadProgress } from './UploadProgress';

/**
 * Offers a newer release of the Android app (src/lib/appUpdate.ts) in a card above the screens:
 * looked for when the app starts and when it comes back to the foreground. Mounted once in the
 * root layout. The card is only there to decide (update or later, install, try again): the
 * download goes on out of the way, as a ring around the avatar in the tab bar (UpdateRing) and a
 * row in the profile menu, so the app stays usable meanwhile.
 */
export function AppUpdate() {
	if (!updatesSupported) return null;
	return <UpdateCard />;
}

function UpdateCard() {
	const update = useAppUpdate();
	const insets = useSafeAreaInsets();
	// the ready version whose card was closed: it stays in the menu, the download is kept
	const [hiddenReady, setHiddenReady] = useState<string | null>(null);

	useEffect(() => {
		checkForUpdate();
		const sub = AppState.addEventListener('change', (s) => s === 'active' && checkForUpdate());
		return () => sub.remove();
	}, []);

	if (update.status === 'idle' || update.status === 'downloading') return null;
	if (update.status === 'ready' && update.version === hiddenReady) return null;
	const failed = update.status === 'error';
	const ready = update.status === 'ready';
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
				<View style={{ flex: 1, gap: 5 }}>
					<Txt size={14} bold style={failed ? { color: colors.danger } : undefined}>
						{failed
							? 'The update failed'
							: ready
							? `Version ${update.version} is ready`
							: `Version ${update.version} is out`}
					</Txt>
					<Txt size={13} muted numberOfLines={2}>
						{failed
							? update.message
							: ready
							? 'Install it over this one, your accounts stay signed in.'
							: update.notes || 'Update to get the latest changes.'}
					</Txt>
				</View>
				{ready ? (
					<Button size="sm" label="Install" onPress={() => installUpdate().catch(() => {})} />
				) : (
					<Button
						size="sm"
						label={failed ? 'Try again' : 'Update'}
						onPress={() => {
							toast('Downloading, the ring on your avatar shows how far');
							downloadUpdate();
						}}
					/>
				)}
				<IconButton
					label="Later"
					onPress={() => (ready ? setHiddenReady(update.version) : dismissUpdate())}
				>
					<X size={18} color={colors.muted} />
				</IconButton>
			</View>
		</View>
	);
}

const RING = 2;

/**
 * The update's download as a ring around the tab bar's avatar (`size` is the avatar's): filling
 * up while it downloads, whole once it waits to be installed. Just the avatar otherwise.
 */
export function UpdateRing({ size, children }: { size: number; children: React.ReactNode }) {
	const update = useAppUpdate();
	if (!updatesSupported || (update.status !== 'downloading' && update.status !== 'ready')) {
		return <>{children}</>;
	}
	// a gap between the picture and the ring, then the ring
	const outer = size + 4 * RING + 2;
	const r = (outer - RING) / 2;
	const circumference = 2 * Math.PI * r;
	// a small visible arc from the start, so a slow connection doesn't look stuck
	const shown = update.status === 'ready' ? 1 : Math.max(0.05, update.progress);
	return (
		<View
			accessibilityLabel={
				update.status === 'ready'
					? `Version ${update.version} is ready to install`
					: `Downloading version ${update.version}, ${Math.round(update.progress * 100)}%`
			}
			style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}
		>
			<Svg width={outer} height={outer} style={{ position: 'absolute' }}>
				<Circle
					cx={outer / 2}
					cy={outer / 2}
					r={r}
					fill="none"
					stroke={colors.foreground}
					strokeOpacity={0.25}
					strokeWidth={RING}
				/>
				<Circle
					cx={outer / 2}
					cy={outer / 2}
					r={r}
					fill="none"
					stroke={colors.accent}
					strokeWidth={RING}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - shown)}
					transform={`rotate(-90 ${outer / 2} ${outer / 2})`}
				/>
			</Svg>
			{children}
		</View>
	);
}

/** the update's row in the profile menu: its label and what tapping it does, or null for none */
export function useUpdateMenuItem(): {
	label: string;
	progress: number | null;
	onPress: (() => void) | null;
} | null {
	const update = useAppUpdate();
	if (!updatesSupported) return null;
	switch (update.status) {
		case 'available':
			return { label: `Update to ${update.version}`, progress: null, onPress: downloadUpdate };
		case 'downloading':
			return {
				label: `Downloading ${update.version} · ${Math.round(update.progress * 100)}%`,
				progress: update.progress,
				onPress: null
			};
		case 'ready':
			return {
				label: `Install version ${update.version}`,
				progress: null,
				onPress: () => installUpdate().catch(() => {})
			};
		case 'error':
			return { label: 'The update failed, try again', progress: null, onPress: downloadUpdate };
		default:
			return null;
	}
}

/** the app's version in settings, with a button to look for an update now */
export function AppVersion() {
	const update = useAppUpdate();
	const [checking, setChecking] = useState(false);

	async function check() {
		setChecking(true);
		const result = await checkForUpdate(true);
		setChecking(false);
		if (result === 'current') toast('This is the latest version');
		else if (result === 'failed') toast("Couldn't look for updates, try again later");
	}

	return (
		<View style={{ paddingHorizontal: 20, gap: 10 }}>
			<Hint>Version {appVersion ?? 'unknown'}</Hint>
			{!updatesSupported ? null : update.status === 'downloading' ? (
				<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
					<UploadProgress progress={update.progress} size={22} />
					<Hint>
						Downloading {update.version} · {Math.round(update.progress * 100)}%
					</Hint>
				</View>
			) : update.status === 'ready' ? (
				<Button
					size="sm"
					style={{ alignSelf: 'flex-start' }}
					label={`Install version ${update.version}`}
					onPress={() => installUpdate().catch(() => {})}
				/>
			) : update.status === 'available' ? (
				<Button
					size="sm"
					variant="primary"
					style={{ alignSelf: 'flex-start' }}
					label={`Update to ${update.version}`}
					onPress={downloadUpdate}
				/>
			) : (
				<Button
					size="sm"
					style={{ alignSelf: 'flex-start' }}
					label="Check for updates"
					loading={checking}
					onPress={check}
				/>
			)}
		</View>
	);
}
