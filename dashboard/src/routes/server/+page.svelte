<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Save from '@lucide/svelte/icons/save';
	import Server from '@lucide/svelte/icons/server';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	type Properties = Record<string, string>;
	type Settings = {
		serverName: string; levelName: string; levelSeed: string; gamemode: string; difficulty: string;
		maxPlayers: number; viewDistance: number; tickDistance: number; allowCheats: boolean;
		allowList: boolean; permissionLevel: string; idleTimeout: number;
	};

	let loading = $state(true);
	let saving = $state(false);
	let applying = $state(false);
	let cancelling = $state(false);
	let restartRequested = $state(false);
	let resettingWorld = $state(false);
	let resetMode = $state<'random' | 'seed'>('random');
	let resetSeed = $state('');
	let resetConfirmation = $state('');
	let resetStatus = $state('');
	let worldOperation = $state<{ state?: string; operation?: string; world?: string; completedAt?: string; error?: string; snapshot?: string }>({ state: 'idle' });
	let requestedWorldOperation = $state<string | null>(null);
	let error = $state('');
	let notice = $state('');
	let localDevelopment = $state(false);
	let serverAvailable = $state(false);
	let settings = $state<Settings>(defaults());
	let activeProperties = $state<Properties>({});
	let hasPendingChanges = $state(false);

	function defaults(): Settings {
		return { serverName: '', levelName: '', levelSeed: '', gamemode: 'survival', difficulty: 'normal', maxPlayers: 10, viewDistance: 12, tickDistance: 4, allowCheats: false, allowList: false, permissionLevel: 'member', idleTimeout: 0 };
	}
	function bool(value: string | undefined) { return value === 'true'; }
	function status(value: string | undefined) { return bool(value) ? 'Activado' : 'Desactivado'; }
	function number(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
	const currentRows = $derived([
		['Nombre del servidor', activeProperties['server-name'] || '—'],
		['Mundo activo', activeProperties['level-name'] || '—'],
		['Modo', activeProperties.gamemode || '—'],
		['Dificultad', activeProperties.difficulty || '—'],
		['Máximo de jugadores', activeProperties['max-players'] || '—'],
		['Distancia de vista', activeProperties['view-distance'] || '—'],
		['Distancia de simulación', activeProperties['tick-distance'] || '—'],
		['Trucos', status(activeProperties['allow-cheats'])],
		['Lista blanca', status(activeProperties['allow-list'])],
		['Permiso predeterminado', activeProperties['default-player-permission-level'] || '—'],
		['Inactividad', activeProperties['player-idle-timeout'] && activeProperties['player-idle-timeout'] !== '0' ? `${activeProperties['player-idle-timeout']} min` : 'Desactivada']
	]);
	function fromProperties(properties: Properties): Settings {
		return {
			serverName: properties['server-name'] ?? '', levelName: properties['level-name'] ?? '', levelSeed: properties['level-seed'] ?? '',
			gamemode: properties.gamemode ?? 'survival', difficulty: properties.difficulty ?? 'normal',
			maxPlayers: number(properties['max-players'], 10), viewDistance: number(properties['view-distance'], 12), tickDistance: number(properties['tick-distance'], 4),
			allowCheats: bool(properties['allow-cheats']), allowList: bool(properties['allow-list']),
			permissionLevel: properties['default-player-permission-level'] ?? 'member', idleTimeout: number(properties['player-idle-timeout'], 0)
		};
	}
	function payload() {
		return { properties: {
			'server-name': settings.serverName, 'level-name': settings.levelName,
			...(settings.levelSeed.trim() ? { 'level-seed': settings.levelSeed } : {}),
			gamemode: settings.gamemode, difficulty: settings.difficulty, 'max-players': settings.maxPlayers,
			'view-distance': settings.viewDistance, 'tick-distance': settings.tickDistance, 'allow-cheats': settings.allowCheats,
			'allow-list': settings.allowList, 'default-player-permission-level': settings.permissionLevel,
			'player-idle-timeout': settings.idleTimeout
		} };
	}
	async function load() {
		loading = true; error = '';
		try {
			const response = await fetch('/api/server-settings');
			const body = await response.json() as { properties?: Properties; activeProperties?: Properties; hasPendingChanges?: boolean; environment?: string; error?: string };
			if (!response.ok || !body.properties) throw new Error(body.error ?? 'No se pudo leer la configuración.');
			settings = fromProperties(body.properties);
			activeProperties = body.activeProperties ?? body.properties;
			hasPendingChanges = body.hasPendingChanges === true;
			serverAvailable = true;
			if (!hasPendingChanges) {
				restartRequested = false;
				sessionStorage.removeItem('spb-staging-restart-requested');
			}
			localDevelopment = body.environment === 'local-development';
		} catch (cause) { serverAvailable = false; error = cause instanceof Error ? cause.message : 'No se pudo leer la configuración.'; }
		finally { loading = false; }
	}
	async function save() {
		saving = true; error = ''; notice = '';
		try {
			const response = await fetch('/api/server-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) });
			const body = await response.json() as { error?: string; changed?: Record<string, string>; restartRequired?: boolean };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo guardar la configuración.');
			const count = Object.keys(body.changed ?? {}).length;
			if (count) hasPendingChanges = true;
			notice = count ? `Se guardaron ${count} ajuste${count === 1 ? '' : 's'} en staging. Reinicia staging para aplicarlos.` : 'No había cambios que guardar.';
			if (count) toast.success('Configuración guardada', { description: 'Los cambios están listos para aplicarse en staging.' });
			else toast.info('Sin cambios', { description: 'La configuración ya coincidía con el archivo.' });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.'; toast.error('No se pudo guardar', { description: error }); }
		finally { saving = false; }
	}
	async function apply() {
		if (applying || !confirm('¿Aplicar la configuración guardada y reiniciar únicamente staging? Los jugadores de staging se desconectarán durante el reinicio.')) return;
		applying = true; error = ''; notice = '';
		try {
			const response = await fetch('/api/server-settings/apply', { method: 'POST' });
			const body = await response.json() as { error?: string; localDevelopment?: boolean };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo reiniciar staging.');
			restartRequested = true;
			sessionStorage.setItem('spb-staging-restart-requested', '1');
			notice = body.localDevelopment ? 'Vista local: no se reinició ningún servidor.' : 'Staging se está reiniciando para aplicar la configuración. La página se actualizará cuando vuelva a responder.';
			toast.info(body.localDevelopment ? 'Vista local' : 'Reinicio solicitado', { description: body.localDevelopment ? 'No se reinició ningún servidor.' : 'Staging guardará y volverá a arrancar automáticamente.' });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo reiniciar staging.'; toast.error('No se pudo reiniciar staging', { description: error }); }
		finally { applying = false; }
	}
	async function cancelPendingChanges() {
		if (cancelling || !confirm('¿Descartar los cambios guardados y restaurar el archivo a la configuración que staging usa ahora? No se reiniciará el servidor.')) return;
		cancelling = true; error = ''; notice = '';
		try {
			const response = await fetch('/api/server-settings/cancel', { method: 'POST' });
			const body = await response.json() as { error?: string; changed?: Record<string, string>; localDevelopment?: boolean };
			if (!response.ok) throw new Error(body.error ?? 'No se pudieron descartar los cambios de staging.');
			const count = Object.keys(body.changed ?? {}).length;
			hasPendingChanges = false;
			settings = fromProperties(activeProperties);
			notice = body.localDevelopment ? 'Vista local: no se modificó ningún servidor.' : count ? `Se descartaron ${count} cambio${count === 1 ? '' : 's'} pendiente${count === 1 ? '' : 's'}. Staging no se reinició.` : 'No había cambios pendientes.';
			toast.success(body.localDevelopment ? 'Vista local' : 'Cambios descartados', { description: body.localDevelopment ? 'No se modificó ningún servidor.' : 'Staging continúa ejecutándose sin reiniciarse.' });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudieron descartar los cambios de staging.'; toast.error('No se pudieron descartar los cambios', { description: error }); }
		finally { cancelling = false; }
	}
	async function resetWorld() {
		const world = activeProperties['level-name'] ?? '';
		if (!world || resetConfirmation !== world || resettingWorld) return;
		if (!confirm('Esto archivará el mundo actual de staging después de crear y verificar un respaldo en R2. ¿Continuar?')) return;
		resettingWorld = true; error = ''; resetStatus = '';
		try {
			const response = await fetch('/api/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: resetMode, seed: resetSeed, confirmation: resetConfirmation }) });
			const body = await response.json() as { error?: string; localDevelopment?: boolean; operation?: string };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo iniciar el reinicio del mundo.');
			if (!body.localDevelopment && body.operation) {
				requestedWorldOperation = body.operation;
				sessionStorage.setItem('spb-staging-world-reset-operation', body.operation);
			}
			worldOperation = body.localDevelopment ? { state: 'idle' } : { state: 'backing-up', operation: body.operation, world };
			resetStatus = body.localDevelopment ? 'Vista local: no se modificó ningún mundo.' : 'Solicitud aceptada. Staging realizará respaldo, verificación en R2 y reemplazo del mundo; esta operación puede tardar varios minutos.';
			toast.info(body.localDevelopment ? 'Vista local' : 'Reinicio de mundo solicitado', { description: body.localDevelopment ? 'No se modificó ningún mundo.' : 'El progreso y resultado aparecerán en esta tarjeta.' });
		} catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo iniciar el reinicio del mundo.'; toast.error('No se pudo iniciar el reinicio', { description: error }); }
		finally { resettingWorld = false; }
	}
	async function loadWorldOperation() {
		try {
			const response = await fetch('/api/world');
			if (!response.ok) return;
			const status = await response.json() as typeof worldOperation;
			const previousState = worldOperation.state;
			const previousOperation = worldOperation.operation;
			worldOperation = status;
			const isRequestedHere = Boolean(requestedWorldOperation && status.operation === requestedWorldOperation);
			const justFinished = isRequestedHere && (status.state === 'complete' || status.state === 'failed') && (status.state !== previousState || status.operation !== previousOperation);
			if (justFinished && status.state === 'complete') {
				toast.success('Mundo reiniciado correctamente', { description: 'El respaldo se verificó antes de reemplazarlo.' });
				requestedWorldOperation = null;
				sessionStorage.removeItem('spb-staging-world-reset-operation');
				resetConfirmation = '';
				resetStatus = 'Mundo reiniciado correctamente. El respaldo fue verificado antes de reemplazarlo.';
				void load();
			}
			if (justFinished && status.state === 'failed') {
				toast.error('El reinicio del mundo no se completó', { description: status.error ?? 'El respaldo y archivos existentes se conservaron.' });
				requestedWorldOperation = null;
				sessionStorage.removeItem('spb-staging-world-reset-operation');
			}
		} catch { /* El estado del mundo no debe ocultar la configuración disponible. */ }
	}
	onMount(() => {
		restartRequested = sessionStorage.getItem('spb-staging-restart-requested') === '1';
		requestedWorldOperation = sessionStorage.getItem('spb-staging-world-reset-operation');
		void load();
		void loadWorldOperation();
		const hasActiveWorldOperation = () => ['backing-up', 'replacing-world'].includes(worldOperation.state ?? '');
		const refreshWhenVisible = () => {
			if (document.hidden) return;
			if (restartRequested) void load();
			if (requestedWorldOperation || hasActiveWorldOperation()) void loadWorldOperation();
		};
		document.addEventListener('visibilitychange', refreshWhenVisible);
		const retry = window.setInterval(refreshWhenVisible, 3000);
		return () => { window.clearInterval(retry); document.removeEventListener('visibilitychange', refreshWhenVisible); };
	});
</script>

<svelte:head><title>Servidor · SPB</title></svelte:head>

<main class="dark min-h-svh bg-background text-foreground">
	<header class="border-b"><div class="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 md:px-6"><div class="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Server class="size-4" /></div><div><p class="text-sm font-semibold">SPB</p><p class="text-xs text-muted-foreground">Configuración del servidor</p></div><div class="ml-auto flex items-center gap-2"><Badge variant="outline">{localDevelopment ? 'Vista local' : 'Staging'}</Badge><Button variant="outline" size="sm" href="/"><ArrowLeft /> Panel</Button></div></div></header>
	<div class="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-10">
		<section class="space-y-2"><p class="text-sm text-muted-foreground">Staging solamente</p><h1 class="text-3xl font-semibold tracking-tight">Servidor</h1><p class="max-w-3xl text-sm text-muted-foreground">Edita propiedades permitidas de Bedrock. Cada guardado crea un respaldo en staging; la mayoría de estas propiedades se aplican al reiniciar staging.</p></section>
		{#if restartRequested}<Alert.Root><LoaderCircle class="animate-spin" /><Alert.Title>Reinicio de staging en curso</Alert.Title><Alert.Description>La orden ya fue enviada. Bedrock está guardando y arrancará de nuevo con la configuración guardada. Esta página se actualizará automáticamente; no pulses nada de nuevo.</Alert.Description></Alert.Root>{:else if error}<Alert.Root variant="destructive"><TriangleAlert /><Alert.Title>No se pudo completar la operación</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
		{#if notice}<Alert.Root><Alert.Title>Configuración guardada</Alert.Title><Alert.Description>{notice}</Alert.Description></Alert.Root>{/if}
		{#if loading}<div class="grid min-h-56 place-items-center text-sm text-muted-foreground"><LoaderCircle class="mr-2 size-4 animate-spin" /> Leyendo staging…</div>{:else if !serverAvailable}<Card.Root><Card.Header><Card.Title>{restartRequested ? 'Reinicio de staging en curso' : 'Staging no está disponible'}</Card.Title><Card.Description>{restartRequested ? 'La orden ya fue enviada y esta página seguirá intentando conectarse. No vuelvas a aplicar los cambios.' : 'No se muestran valores de configuración porque no hay una respuesta confirmada del servidor.'}</Card.Description></Card.Header></Card.Root>{:else}
			<Card.Root><Card.Header class="flex-row items-start justify-between gap-4"><div><Card.Title>Configuración aplicada ahora</Card.Title><Card.Description>Lectura tomada cuando Bedrock staging arrancó. La configuración guardada después queda pendiente hasta su próximo reinicio.</Card.Description></div><Badge variant={hasPendingChanges ? 'secondary' : 'outline'}>{hasPendingChanges ? 'Cambios pendientes' : 'Coincide con el archivo'}</Badge></Card.Header><Card.Content><dl class="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{#each currentRows as [label, value]}<div class="space-y-1"><dt class="text-muted-foreground">{label}</dt><dd class="font-medium capitalize">{value}</dd></div>{/each}</dl>{#if hasPendingChanges}<div class="mt-5 flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground sm:flex-row sm:items-center"><p class="flex-1">El archivo <code>server.properties</code> ya cambió, pero Bedrock staging sigue usando la configuración indicada arriba. Puedes aplicarlo o descartarlo.</p>{#if restartRequested}<Badge variant="outline"><LoaderCircle class="animate-spin" /> Reinicio solicitado</Badge>{:else}<div class="flex flex-wrap gap-2"><Button type="button" variant="outline" onclick={() => void cancelPendingChanges()} disabled={cancelling || applying}>{#if cancelling}<LoaderCircle class="animate-spin" /> Descartando…{:else}Descartar cambios{/if}</Button><Button type="button" onclick={() => void apply()} disabled={applying || cancelling}>{#if applying}<LoaderCircle class="animate-spin" /> Reiniciando…{:else}<RefreshCw /> Aplicar y reiniciar staging{/if}</Button></div>{/if}</div>{/if}</Card.Content></Card.Root>
			<Card.Root class="border-destructive/40"><Card.Header><Card.Title>Reiniciar mundo de staging</Card.Title><Card.Description>Se crea y verifica un respaldo cifrado en R2 antes de archivar el mundo actual y generar otro. Producción nunca participa.</Card.Description></Card.Header><Card.Content class="grid gap-4 md:grid-cols-2">{#if worldOperation.state === 'backing-up' || worldOperation.state === 'replacing-world'}<div class="md:col-span-2 flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><LoaderCircle class="size-5 animate-spin" /><div><p class="font-medium">{worldOperation.state === 'backing-up' ? 'Respaldando y verificando en R2' : 'Reemplazando el mundo de staging'}</p><p class="text-muted-foreground">Operación en curso. No cierres ni repitas esta acción; el estado se actualiza solo.</p></div></div>{:else if worldOperation.state === 'complete'}<div class="md:col-span-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"><p class="font-medium text-emerald-400">Mundo reiniciado correctamente</p><p class="mt-1 text-muted-foreground">Respaldo verificado antes del reemplazo{worldOperation.completedAt ? ` · Finalizó ${new Date(worldOperation.completedAt).toLocaleString()}` : ''}.</p></div>{:else if worldOperation.state === 'failed'}<div class="md:col-span-2 rounded-md border border-destructive/40 p-4 text-sm"><p class="font-medium">El reinicio no se completó</p><p class="mt-1 text-muted-foreground">{worldOperation.error ?? 'El respaldo y los archivos existentes se conservaron.'}</p></div>{/if}<div class="grid gap-2"><Label for="reset-mode">Nuevo mundo</Label><select id="reset-mode" class="h-9 rounded-md border bg-background px-3 text-sm text-foreground" bind:value={resetMode} disabled={worldOperation.state === 'backing-up' || worldOperation.state === 'replacing-world'}><option class="bg-background text-foreground" value="random">Seed aleatoria</option><option class="bg-background text-foreground" value="seed">Usar una seed</option></select></div>{#if resetMode === 'seed'}<div class="grid gap-2"><Label for="reset-seed">Seed del nuevo mundo</Label><Input id="reset-seed" bind:value={resetSeed} maxlength={64} disabled={worldOperation.state === 'backing-up' || worldOperation.state === 'replacing-world'} /></div>{/if}<div class="grid gap-2 md:col-span-2"><Label for="reset-confirmation">Para confirmar, escribe exactamente <code>{activeProperties['level-name']}</code></Label><Input id="reset-confirmation" bind:value={resetConfirmation} autocomplete="off" disabled={worldOperation.state === 'backing-up' || worldOperation.state === 'replacing-world'} /></div>{#if resetStatus}<p class="md:col-span-2 rounded-md border p-3 text-sm text-muted-foreground">{resetStatus}</p>{/if}</Card.Content><Card.Footer><Button type="button" variant="destructive" onclick={() => void resetWorld()} disabled={resettingWorld || worldOperation.state === 'backing-up' || worldOperation.state === 'replacing-world' || !activeProperties['level-name'] || resetConfirmation !== activeProperties['level-name'] || (resetMode === 'seed' && !resetSeed.trim())}>{#if resettingWorld}<LoaderCircle class="animate-spin" /> Preparando…{:else}<RotateCcw /> Respaldar y reiniciar mundo{/if}</Button></Card.Footer></Card.Root>
			<form class="space-y-6" onsubmit={(event) => { event.preventDefault(); void save(); }}>
				<Card.Root><Card.Header><Card.Title>Identidad y mundo</Card.Title><Card.Description>El nombre de mundo cambia qué carpeta de mundo usará Bedrock tras reiniciar; no copia ni elimina mundos.</Card.Description></Card.Header><Card.Content class="grid gap-4 md:grid-cols-2"><div class="grid gap-2"><Label for="server-name">Nombre del servidor</Label><Input id="server-name" bind:value={settings.serverName} maxlength={64} /></div><div class="grid gap-2"><Label for="level-name">Nombre del mundo</Label><Input id="level-name" bind:value={settings.levelName} maxlength={64} /></div><div class="grid gap-2 md:col-span-2"><Label for="level-seed">Seed para mundos nuevos</Label><Input id="level-seed" bind:value={settings.levelSeed} maxlength={64} placeholder="Vacío = aleatoria" /></div></Card.Content></Card.Root>
				<Card.Root><Card.Header><Card.Title>Jugabilidad</Card.Title></Card.Header><Card.Content class="grid gap-4 md:grid-cols-2"><div class="grid gap-2"><Label for="gamemode">Modo de juego</Label><select id="gamemode" class="h-9 rounded-md border bg-background px-3 text-sm text-foreground" bind:value={settings.gamemode}><option class="bg-background text-foreground" value="survival">Survival</option><option class="bg-background text-foreground" value="creative">Creative</option><option class="bg-background text-foreground" value="adventure">Adventure</option></select></div><div class="grid gap-2"><Label for="difficulty">Dificultad</Label><select id="difficulty" class="h-9 rounded-md border bg-background px-3 text-sm text-foreground" bind:value={settings.difficulty}><option class="bg-background text-foreground" value="peaceful">Pacífico</option><option class="bg-background text-foreground" value="easy">Fácil</option><option class="bg-background text-foreground" value="normal">Normal</option><option class="bg-background text-foreground" value="hard">Difícil</option></select></div><label class="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" bind:checked={settings.allowCheats} /> Permitir trucos <span class="text-muted-foreground">Puede afectar logros del mundo.</span></label><label class="flex items-center gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" bind:checked={settings.allowList} /> Activar lista blanca</label><div class="grid gap-2"><Label for="permission">Permiso predeterminado</Label><select id="permission" class="h-9 rounded-md border bg-background px-3 text-sm text-foreground" bind:value={settings.permissionLevel}><option class="bg-background text-foreground" value="visitor">Visitante</option><option class="bg-background text-foreground" value="member">Miembro</option><option class="bg-background text-foreground" value="operator">Operador</option></select></div><div class="grid gap-2"><Label for="idle">Expulsar por inactividad (minutos, 0 desactiva)</Label><Input id="idle" type="number" min="0" max="1440" bind:value={settings.idleTimeout} /></div></Card.Content></Card.Root>
				<Card.Root><Card.Header><Card.Title>Capacidad y rendimiento</Card.Title><Card.Description>Más distancia consume más CPU y memoria. Empieza conservadoramente en staging.</Card.Description></Card.Header><Card.Content class="grid gap-4 md:grid-cols-3"><div class="grid gap-2"><Label for="players">Máximo de jugadores</Label><Input id="players" type="number" min="1" max="100" bind:value={settings.maxPlayers} /></div><div class="grid gap-2"><Label for="view">Distancia de vista</Label><Input id="view" type="number" min="5" max="32" bind:value={settings.viewDistance} /></div><div class="grid gap-2"><Label for="tick">Distancia de simulación</Label><Input id="tick" type="number" min="4" max="12" bind:value={settings.tickDistance} /></div></Card.Content></Card.Root>
				<div class="flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm md:flex-row md:items-center"><TriangleAlert class="size-5 shrink-0 text-amber-500" /><p class="flex-1">Guardar no reinicia el servidor. El cambio queda preparado en <code>server.properties</code>; reiniciar staging será una acción separada y visible.</p><Button type="submit" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" /> Guardando…{:else}<Save /> Guardar en staging{/if}</Button></div>
			</form>
		{/if}
	</div>
</main>
