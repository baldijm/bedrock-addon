import { redirect, type Handle } from '@sveltejs/kit';
import { isAuthenticated, unauthorized } from '#lib/server/auth';

const publicPages = new Set(['/login']);
const publicApi = new Set(['/api/login', '/api/logout']);

function returnTo(url: URL) {
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The dashboard used to protect individual endpoints only. That left rendered
 * pages visible after a session expired, until their first request failed.
 * The sign-in screen is intentionally the only public application page; every
 * dashboard route, including the terminal, has one server-side session gate.
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
		redirect(303, `/login?returnTo=${encodeURIComponent(returnTo(event.url))}`);

	return resolve(event);
};
