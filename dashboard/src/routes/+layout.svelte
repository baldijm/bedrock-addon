<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { page } from '$app/state';
	import Blocks from '@lucide/svelte/icons/blocks';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import MapPinned from '@lucide/svelte/icons/map-pinned';
	import Server from '@lucide/svelte/icons/server';
	import Settings from '@lucide/svelte/icons/settings';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Terminal from '@lucide/svelte/icons/terminal';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Toaster } from 'svelte-sonner';
	import type { LayoutProps } from './$types';
	import EnvironmentSelector from '#lib/components/EnvironmentSelector.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';

	let { children }: LayoutProps = $props();

	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === href : page.url.pathname.startsWith(href);

	/** Redirect expired browser sessions from any private screen to the terminal's sign-in view. */
	onMount(() => {
		const originalFetch = window.fetch;
		window.fetch = async (...arguments_) => {
			const response = await originalFetch.call(window, ...arguments_);
			const source = arguments_[0];
			const requestUrl =
				source instanceof Request ? source.url : source instanceof URL ? source.toString() : source;
			const target = new URL(requestUrl, window.location.origin);
			const isPrivateApi =
				target.origin === window.location.origin &&
				target.pathname.startsWith('/api/') &&
				target.pathname !== '/api/login';

			if (
				response.status === 401 &&
				isPrivateApi &&
				!window.location.pathname.startsWith('/terminal')
			) {
				const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
				window.location.replace(`/terminal?returnTo=${encodeURIComponent(returnTo)}`);
			}
			return response;
		};

		return () => {
			window.fetch = originalFetch;
		};
	});
</script>

<svelte:head>
	<title>SPB · Consola</title>
	<meta name="description" content="Consola privada de administración de SPB." />
</svelte:head>

<div class="dark min-h-svh bg-background text-foreground">
	<Sidebar.Provider>
		<Sidebar.Root collapsible="icon">
			<Sidebar.Header class="h-16 border-b px-3">
				<a href="/" class="flex min-w-0 items-center gap-2 rounded-md px-1 py-2">
					<span
						class="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"
					>
						<Server class="size-4" />
					</span>
					<span class="min-w-0 group-data-[collapsible=icon]:hidden">
						<span class="block truncate text-sm font-semibold">SPB</span>
						<span class="block truncate text-xs text-muted-foreground">Administración</span>
					</span>
				</a>
			</Sidebar.Header>
			<Sidebar.Content>
				<Sidebar.Group>
					<Sidebar.GroupLabel>Operación</Sidebar.GroupLabel>
					<Sidebar.Menu>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/')} tooltipContent="Panel"
								>{#snippet child({ props })}<a href="/" {...props}
										><LayoutDashboard /><span>Panel</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/members')} tooltipContent="Miembros"
								>{#snippet child({ props })}<a href="/members" {...props}
										><UsersRound /><span>Miembros</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/blocks')} tooltipContent="Bloques"
								>{#snippet child({ props })}<a href="/blocks" {...props}
										><Blocks /><span>Bloques</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/structures')} tooltipContent="Estructuras"
								>{#snippet child({ props })}<a href="/structures" {...props}
										><MapPinned /><span>Estructuras</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/terminal')} tooltipContent="Terminal"
								>{#snippet child({ props })}<a href="/terminal" {...props}
										><Terminal /><span>Terminal</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
					</Sidebar.Menu>
				</Sidebar.Group>
				<Sidebar.Group>
					<Sidebar.GroupLabel>Servidor</Sidebar.GroupLabel>
					<Sidebar.Menu>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/server')} tooltipContent="Configuración"
								>{#snippet child({ props })}<a href="/server" {...props}
										><Settings /><span>Configuración</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/releases')} tooltipContent="Mundos"
								>{#snippet child({ props })}<a href="/releases" {...props}
										><Server /><span>Mundos</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
						<Sidebar.MenuItem
							><Sidebar.MenuButton isActive={isActive('/updates')} tooltipContent="Actualizaciones"
								>{#snippet child({ props })}<a href="/updates" {...props}
										><RefreshCw /><span>Actualizaciones</span></a
									>{/snippet}</Sidebar.MenuButton
							></Sidebar.MenuItem
						>
					</Sidebar.Menu>
				</Sidebar.Group>
			</Sidebar.Content>
			<Sidebar.Footer class="border-t p-3">
				<p class="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
					Ctrl/Cmd + B para contraer
				</p>
			</Sidebar.Footer>
		</Sidebar.Root>
		<Sidebar.Inset class="min-w-0">
			{#if !page.url.pathname.startsWith('/terminal')}
				<header
					class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:px-6"
				>
					<Sidebar.Trigger aria-label="Alternar navegación" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">Consola SPB</p>
					</div>
					<EnvironmentSelector />
				</header>
			{/if}
			{@render children()}
		</Sidebar.Inset>
	</Sidebar.Provider>
</div>
<Toaster theme="dark" position="top-right" richColors closeButton />
