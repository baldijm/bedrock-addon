// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface Env {
		DB: D1Database;
		STRUCTURES: R2Bucket;
		ADMIN_PASSWORD: string;
		SESSION_SECRET: string;
		STAGING_SERVER_TOKEN: string;
		STAGING_BRIDGE_URL: string;
		STAGING_BRIDGE_TOKEN: string;
		PRODUCTION_OBSERVER_URL: string;
		PRODUCTION_OBSERVER_TOKEN: string;
		GITHUB_STRUCTURES_TOKEN: string;
		GITHUB_STRUCTURES_REPOSITORY: string;
		GITHUB_STRUCTURES_BRANCH: string;
	}

	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
