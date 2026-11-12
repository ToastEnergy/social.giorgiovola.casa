import { ProfileMenu } from '@/components/ProfileMenu';

// pressing the avatar tab opens the menu as a sheet (/menu) instead: this screen is only reached
// through a link to it
export default function MeTab() {
	return <ProfileMenu />;
}
