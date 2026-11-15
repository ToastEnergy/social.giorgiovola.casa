import { Platform } from 'react-native';

// the web app's design tokens (src/app.css): flat, dark, one green accent
export const colors = {
	background: '#0c0b0b',
	panel: '#000000',
	foreground: '#d9d9d9',
	accent: '#799a74',
	danger: '#bb5353',
	muted: '#999999',
	line: '#4e4e4e',
	hover: 'rgba(255,255,255,0.05)'
};

export const fonts = {
	medium: 'Manrope_500Medium',
	bold: 'Manrope_700Bold',
	extrabold: 'Manrope_800ExtraBold',
	/** codes (invite codes): the system's monospaced font */
	mono: Platform.select({ ios: 'Menlo', default: 'monospace' })
};

/** the tab bar's height above the safe area: breathing room between its top border and the
 * icons, and as much more so the icons don't get pushed into the home indicator area */
export const TAB_BAR_PADDING_TOP = 8;
export const TAB_BAR_HEIGHT = 49 + TAB_BAR_PADDING_TOP;
