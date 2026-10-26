<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Cloud from '@lucide/svelte/icons/cloud';
	import Blocks from '@lucide/svelte/icons/blocks';
	import Menu from '@lucide/svelte/icons/menu';
	import Server from '@lucide/svelte/icons/server';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Settings from '@lucide/svelte/icons/settings';
	import Terminal from '@lucide/svelte/icons/terminal';
	import MapPinned from '@lucide/svelte/icons/map-pinned';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import EnvironmentSelector from '#lib/components/EnvironmentSelector.svelte';
	import * as Separator from '#lib/components/ui/separator/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';

	type ConsoleLine = { id: number; at: string; text: string };
	type PlayerSnapshot = {
		online: number;
		capacity: number;
		players: string[];
		observedAt: string;
		source: string;
	};

	let loading = $state(true);
	let bedrockRunning = $state(false);
	let logs = $state<ConsoleLine[]>([]);
	let terminalHref = $state('/terminal');
	let localPreview = $state(false);
	let localDevelopment = $state(false);
	let playerSnapshot = $state<PlayerSnapshot | null>(null);
	let playersError = $state('');
	let mobileNavOpen = $state(false);
	let environment = $state<'staging' | 'production'>('staging');

	const lastLog = $derived(logs.at(-1)?.text ?? 'Aún no hay actividad registrada.');

	async function refresh() {
		const [response, playersResponse] = await Promise.all([
			fetch('/api/commands', { headers: { 'content-type': 'application/json' } }),
			fetch('/api/players', { headers: { 'content-type': 'application/json' } })
		]);
		if (!response.ok) {
			void goto(`/terminal${window.location.search}`);
			return;
		}
		const body = (await response.json()) as {
			environment?: string;
			logs: { lines: ConsoleLine[] };
			health: { bedrockRunning: boolean };
		};
		environment = body.environment === 'production' ? 'production' : 'staging';
		logs = body.logs.lines;
		bedrockRunning = body.health.bedrockRunning === true;
		localDevelopment = body.health.localDevelopment === true;
		if (playersResponse.ok) {
			playerSnapshot = (await playersResponse.json()) as PlayerSnapshot;
			playersError = '';
		} else {
			const playersBody = (await playersResponse.json().catch(() => ({}))) as { error?: string };
			playerSnapshot = null;
			playersError = playersBody.error ?? 'La consulta de jugadores no está disponible todavía.';
		}
		loading = false;
	}

	onMount(() => {
		localPreview =
			import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview');
		if (localPreview) {
			terminalHref = '/terminal?preview=1';
			bedrockRunning = true;
			localDevelopment = true;
			logs = [
				{ id: 1, at: new Date().toISOString(), text: '[Server] Local dashboard preview ready.' },
				{ id: 2, at: new Date().toISOString(), text: '[Server] No connection to staging was made.' }
			];
			loading = false;
			return;
		}
		void refresh();
		const refreshWhenVisible = () => {
			if (!document.hidden) void refresh();
		};
		document.addEventListener('visibilitychange', refreshWhenVisible);
		const timer = window.setInterval(refreshWhenVisible, 15000);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', refreshWhenVisible);
		};
	});
</script>

<main class="dark min-h-svh bg-background text-foreground">
	{#if loading}
		<div class="grid min-h-svh place-items-center text-sm text-muted-foreground">
			<Activity class="mr-2 inline size-4 animate-pulse" /> Cargando panel…
		</div>
	{:else}
		<header class="border-b">
			<div class="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 md:px-6">
				<div
					class="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
				>
					<Server class="size-4" />
				</div>
				<div class="min-w-0">
					<p class="truncate text-sm font-semibold">SPB</p>
					<p class="truncate text-xs text-muted-foreground">Panel de administración</p>
				</div>
				<div class="ml-auto hidden items-center gap-2 md:flex">
					<EnvironmentSelector /><Badge
						variant={localDevelopment ? 'outline' : bedrockRunning ? 'default' : 'destructive'}
						>{localDevelopment
							? 'Vista local'
							: bedrockRunning
								? 'En línea'
								: 'Sin conexión'}</Badge
					><Button variant="outline" size="sm" href="/members"><UsersRound /> Miembros</Button
					><Button variant="outline" size="sm" href="/blocks"><Blocks /> Bloques</Button><Button
						variant="outline"
						size="sm"
						href="/structures"><MapPinned /> Estructuras</Button
					><Button variant="outline" size="sm" href="/server"><Settings /> Servidor</Button><Button
						size="sm"
						onclick={() => void goto(terminalHref)}><Terminal /> Terminal</Button
					>
				</div>
				<div class="ml-auto flex items-center gap-2 md:hidden">
					<EnvironmentSelector /><Button
						variant="outline"
						size="icon-sm"
						aria-label="Abrir navegación"
						onclick={() => (mobileNavOpen = true)}><Menu /></Button
					>
				</div>
			</div>
		</header>
		<Sheet.Root bind:open={mobileNavOpen}>
			<Sheet.Content side="right" class="w-[min(20rem,calc(100vw-1.5rem))] p-5">
				<Sheet.Header
					><Sheet.Title>Navegación</Sheet.Title><Sheet.Description
						>Panel de administración de staging.</Sheet.Description
					></Sheet.Header
				>
				<div class="mt-2">
					<Badge variant={localDevelopment ? 'outline' : bedrockRunning ? 'default' : 'destructive'}
						>{localDevelopment
							? 'Vista local'
							: bedrockRunning
								? 'Staging en línea'
								: 'Staging sin conexión'}</Badge
					>
				</div>
				<nav class="mt-3 grid gap-2" aria-label="Navegación principal">
					<Button
						class="justify-start"
						variant="outline"
						onclick={() => {
							mobileNavOpen = false;
							void goto('/members');
						}}><UsersRound /> Miembros</Button
					>
					<Button
						class="justify-start"
						variant="outline"
						onclick={() => {
							mobileNavOpen = false;
							void goto('/blocks');
						}}><Blocks /> Bloques</Button
					>
					<Button
						class="justify-start"
						variant="outline"
						onclick={() => {
							mobileNavOpen = false;
							void goto('/structures');
						}}><MapPinned /> Estructuras</Button
					>
					<Button
						class="justify-start"
						variant="outline"
						onclick={() => {
							mobileNavOpen = false;
							void goto('/server');
						}}><Settings /> Servidor</Button
					>
					<Button
						class="justify-start"
						onclick={() => {
							mobileNavOpen = false;
							void goto(terminalHref);
						}}><Terminal /> Terminal</Button
					>
				</nav>
			</Sheet.Content>
		</Sheet.Root>

		<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
			<section class="flex flex-col justify-between gap-4 md:flex-row md:items-end">
				<div class="space-y-2">
					<p class="text-sm text-muted-foreground">
						Resumen operativo · {environment === 'production' ? 'Producción' : 'Staging'}
					</p>
					<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">
						Tu mundo, de un vistazo.
					</h1>
					<p class="max-w-2xl text-sm text-muted-foreground">
						Los datos corresponden al entorno global elegido. Los comandos viven en su propia
						terminal.
					</p>
				</div>
				<Button variant="outline" onclick={() => void refresh()} disabled={localPreview}
					><Activity /> Actualizar</Button
				>
			</section>

			<section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<Card.Root
					><Card.Header class="pb-3"
						><Card.Description>Entorno activo</Card.Description><Card.Title
							class="flex items-center gap-2 text-2xl"
							><Cloud class="size-5" />
							{localDevelopment
								? 'Vista local'
								: environment === 'production'
									? 'Producción'
									: 'Staging'}</Card.Title
						></Card.Header
					><Card.Content class="text-sm text-muted-foreground"
						>{localDevelopment
							? 'Datos simulados; no existe conexión al servidor.'
							: environment === 'production'
								? 'Observación de estado y registros.'
								: 'Entorno para probar add-ons, mundos y comandos.'}</Card.Content
					></Card.Root
				>
				<Card.Root
					><Card.Header class="pb-3"
						><Card.Description>Servidor Bedrock</Card.Description><Card.Title
							class="flex items-center gap-2 text-2xl"
							><Activity class="size-5" /> {bedrockRunning ? 'Operativo' : 'Detenido'}</Card.Title
						></Card.Header
					><Card.Content class="text-sm text-muted-foreground"
						>El estado se actualiza automáticamente cada cinco segundos.</Card.Content
					></Card.Root
				>
				<Card.Root
					><Card.Header class="pb-3"
						><Card.Description>Salida disponible</Card.Description><Card.Title class="text-2xl"
							>{logs.length} líneas</Card.Title
						></Card.Header
					><Card.Content class="text-sm text-muted-foreground"
						>Buffer actual recibido desde el bridge local del servidor.</Card.Content
					></Card.Root
				>
				<Card.Root
					><Card.Header class="pb-3"
						><Card.Description>Jugadores en línea</Card.Description><Card.Title
							class="flex items-center gap-2 text-2xl"
							><Activity class="size-5" />
							{playerSnapshot?.online ?? '—'}{#if playerSnapshot?.capacity !== undefined}<span
									class="text-base font-normal text-muted-foreground"
									>/ {playerSnapshot.capacity}</span
								>{/if}</Card.Title
						></Card.Header
					><Card.Content class="text-sm text-muted-foreground"
						>{#if playerSnapshot}{playerSnapshot.players.length
								? playerSnapshot.players.join(', ')
								: 'No hay jugadores conectados.'}{:else}{playersError ||
								'Pendiente de consulta.'}{/if}</Card.Content
					></Card.Root
				>
			</section>

			<section class="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
				<Card.Root
					><Card.Header
						><Card.Title>Actividad reciente</Card.Title><Card.Description
							>La última salida visible del servidor seleccionado.</Card.Description
						></Card.Header
					><Card.Content
						><div class="rounded-lg border bg-black/30 p-4 font-mono text-sm text-foreground/90">
							{lastLog}
						</div></Card.Content
					><Card.Footer
						><Button variant="outline" onclick={() => void goto(terminalHref)}
							>Abrir salida completa <ArrowRight /></Button
						></Card.Footer
					></Card.Root
				>
				<Card.Root
					><Card.Header
						><Card.Title class="flex items-center gap-2"
							><ShieldCheck class="size-5" /> Límites de seguridad</Card.Title
						><Card.Description
							>El panel está diseñado para administrar staging sin convertirlo en una puerta a
							producción.</Card.Description
						></Card.Header
					><Card.Content class="space-y-3 text-sm text-muted-foreground"
						><div>
							<p class="font-medium text-foreground">Producción separada</p>
							<p>Esta sesión no envía comandos a producción.</p>
						</div>
						<Separator.Root />
						<div>
							<p class="font-medium text-foreground">Bridge local</p>
							<p>
								La consola se comunica por el túnel configurado, no por un puerto público de
								administración.
							</p>
						</div></Card.Content
					></Card.Root
				>
			</section>
		</div>
	{/if}
</main>
