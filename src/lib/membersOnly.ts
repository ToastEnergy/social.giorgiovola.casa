/**
 * What signed-out visitors can still open when MEMBERS_ONLY is on (src/lib/server/membersOnly.ts).
 * Shared by the request hook and the root layout, so both agree on which pages stay open.
 */

/** Pages (route ids) open to everyone: signing in and up, and docs that hold no user content. */
export const PUBLIC_PAGES = ['/login', '/register', '/logout', '/install', '/developers'];

export const isPublicPage = (routeId: string | null) =>
	routeId !== null && PUBLIC_PAGES.includes(routeId);
