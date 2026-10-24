import type { ServerEnvironment } from './bridge';

export const ENVIRONMENT_COOKIE = 'spb_environment';

export function resolveEnvironment(request: Request): ServerEnvironment {
	const value = request.headers
		.get('cookie')
		?.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${ENVIRONMENT_COOKIE}=`))
		?.slice(`${ENVIRONMENT_COOKIE}=`.length);
	return value === 'production' ? 'production' : 'staging';
}
