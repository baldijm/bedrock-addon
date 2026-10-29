import { redirect, type Handle } from '@sveltejs/kit';
import { isAuthenticated, unauthorized } from '#lib/server/auth';

const publicPages = new Set(['/login', '/terminal']);
const publicApi = new Set(['/api/login', '/api/logout']);

function returnTo(url: URL) {
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The dashboard used to protect individual endpoints only. That left rendered
 * pages visible after a session expired, until their first request failed.
 * Keep the terminal public because it is also the sign-in screen; every other
 * application route now has one server-side session gate.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Static files do not participate in the application session flow.
	if (event.route.id === null) return resolve(event);

	if (pathname.startsWith('/internal/')) return resolve(event);

	if (pathname.startsWith('/api/')) {
		if (publicApi.has(pathname)) return resolve(event);
		if (!(await isAuthenticated(event.request))) return unauthorized();
		return resolve(event);
	}

	if (publicPages.has(pathname)) return resolve(event);
	if (!(await isAuthenticated(event.request)))
		redirect(303, `/terminal?returnTo=${encodeURIComponent(returnTo(event.url))}`);

	return resolve(event);
};
