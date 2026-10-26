import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isAuthenticated } from '#lib/server/auth';

export const load: PageServerLoad = async ({ request }) => {
	if (!(await isAuthenticated(request))) redirect(303, '/terminal?returnTo=/structures');
};
