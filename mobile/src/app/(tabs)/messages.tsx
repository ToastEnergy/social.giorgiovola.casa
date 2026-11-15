import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { setHomePage } from '@/lib/homePage';

// the messages are the second page of the home tab (HomePager); this route only exists for the
// tab bar and for links to /messages, and opens that page
export default function MessagesRoute() {
	useFocusEffect(
		useCallback(() => {
			setHomePage(1, false);
			router.navigate('/');
		}, [])
	);
	return null;
}
