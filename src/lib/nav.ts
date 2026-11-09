import Bell from '@lucide/svelte/icons/bell';
import House from '@lucide/svelte/icons/house';
import MessageCircle from '@lucide/svelte/icons/message-circle';
import Settings from '@lucide/svelte/icons/settings';

export type NavItem = {
	href: string;
	label: string;
	icon: typeof Bell;
	/** which unread count the item shows */
	count?: 'notifications' | 'messages';
};

// the main sections, shared by the sidebar (wide screens) and the bottom bar (narrow ones)
export const navItems: NavItem[] = [
	{ href: '/notifications', label: 'Notifications', icon: Bell, count: 'notifications' },
	{ href: '/messages', label: 'Messages', icon: MessageCircle, count: 'messages' },
	{ href: '/settings', label: 'Settings', icon: Settings }
];

// home is its own item so the bottom bar can put it first
export const homeItem: NavItem = { href: '/', label: 'Home', icon: House };

export const isActive = (pathname: string, href: string) =>
	pathname === href || pathname.startsWith(href + '/');

export const countLabel = (count: number) => (count > 99 ? '99+' : String(count));

export const navLabel = (item: NavItem, count: number) =>
	count > 0 ? `${item.label} (${countLabel(count)} unread)` : item.label;
