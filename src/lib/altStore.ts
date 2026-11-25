// the AltStore source of the iOS app, which mobile-ios publishes on the altstore branch
const SOURCE =
	'https://raw.githubusercontent.com/ToastEnergy/social.giorgiovola.casa/altstore/source.json';

// opens AltStore Classic and asks to add the source. not an altstore.io/source link, which leads
// to AltStore PAL (its scheme is altstore-pal)
export const ADD_ALTSTORE_SOURCE = `altstore://source?url=${encodeURIComponent(SOURCE)}`;
