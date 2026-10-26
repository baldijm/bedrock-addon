<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	type Promotion = {
		state?: string; operation?: string; sourceWorld?: string; stagingWorld?: string; productionWorld?: string;
		snapshot?: string; backupSha256?: string; completedAt?: string; error?: string;
	};

	let loading = $state(true);
	let starting = $state(false);
	let confirmation = $state('');
	let error = $state('');
	let promotion = $state<Promotion>({ state: 'idle' });
	let requestedOperation = $state<string | null>(null);
	let promotionStatus = $state('');
	let resettingWorld = $state(false);
	let resetMode = $state<'random' | 'seed'>('random');
	let resetSeed = $state('');
	let resetConfirmation = $state('');
	let resetStatus = $state('');
	let worldOperation = $state<{ state?: string; operation?: string; world?: string; completedAt?: string; error?: string }>({ state: 'idle' });
	let requestedWorldOperation = $state<string | null>(null);

	const active = $derived(['queued', 'copying-staging-world', 'backing-up-production', 'replacing-production-world', 'starting-production'].includes(promotion.state ?? ''));
	const canPromote = $derived(Boolean(promotion.productionWorld) && confirmation === promotion.productionWorld && !active && !starting);
	const resetting = $derived(['backing-up', 'replacing-world'].includes(worldOperation.state ?? ''));
	const stagingWorld = $derived(promotion.stagingWorld || promotion.sourceWorld || '');
	const canReset = $derived(Boolean(stagingWorld) && resetConfirmation === stagingWorld && !resetting && !resettingWorld && !(resetMode === 'seed' && !resetSeed.trim()));

	async function load() {
		try {
			const response = await fetch('/api/world-promotion');
			if (response.status === 401) { location.replace('/terminal?returnTo=/releases'); return; }
			const body = await response.json() as Promotion;
			if (!response.ok) throw new Error(body.error ?? 'No se pudo consultar la promoción.');
			const previousState = promotion.state;
			const previousOperation = promotion.operation;
			promotion = body;
			const justFinished = Boolean(requestedOperation && body.operation === requestedOperation && (body.state === 'complete' || body.state === 'failed') && (body.state !== previousState || body.operation !== previousOperation));
			if (justFinished && body.state === 'complete') {
				toast.success('Mundo promovido correctamente', { description: 'Producción volvió a arrancar después de verificar su respaldo en R2.' });
				promotionStatus = 'Mundo de staging promovido correctamente. El respaldo previo de producción fue verificado en R2.';
				requestedOperation = null;
				sessionStorage.removeItem('spb-production-world-promotion-operation');
				confirmation = '';
			} else if (justFinished && body.state === 'failed') {
				toast.error('La promoción no terminó', { description: body.error ?? 'Se conservó el respaldo y se intentó restaurar el mundo anterior.' });
				requestedOperation = null;
				sessionStorage.removeItem('spb-production-world-promotion-operation');
			}
			error = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo consultar la promoción.';
		} finally {
			loading = false;
		}
	}

	async function promote() {
		if (!canPromote || !confirm('Producción se detendrá brevemente y su mundo actual será reemplazado por el mundo activo de staging. Se creará y verificará un respaldo en R2 antes. ¿Continuar?')) return;
		starting = true; error = ''; promotionStatus = '';
		try {
			const response = await fetch('/api/world-promotion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
			const body = await response.json() as Promotion;
			if (!response.ok) throw new Error(body.error ?? 'No se pudo iniciar la promoción.');
			requestedOperation = body.operation ?? null;
			if (requestedOperation) sessionStorage.setItem('spb-production-world-promotion-operation', requestedOperation);
			promotion = { ...promotion, ...body };
			confirmation = '';
			promotionStatus = 'Solicitud aceptada. Se copiará staging, se respaldará y verificará producción en R2, y después se reemplazará el mundo. Puede tardar varios minutos.';
			toast.info('Promoción de mundo solicitada', { description: 'El progreso y resultado aparecerán en esta tarjeta.' });
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo iniciar la promoción.';
		} finally {
			starting = false;
		}
	}

	async function loadWorldOperation() {
		try {
			const response = await fetch('/api/world');
			if (response.status === 401) { location.replace('/terminal?returnTo=/releases'); return; }
			if (!response.ok) return;
			const status = await response.json() as typeof worldOperation;
			const previousState = worldOperation.state;
			const previousOperation = worldOperation.operation;
			worldOperation = status;
			const justFinished = Boolean(requestedWorldOperation && status.operation === requestedWorldOperation && (status.state === 'complete' || status.state === 'failed') && (status.state !== previousState || status.operation !== previousOperation));
			if (justFinished && status.state === 'complete') {
				toast.success('Mundo de staging reiniciado', { description: 'El respaldo se verificó antes de reemplazarlo.' });
				requestedWorldOperation = null;
				sessionStorage.removeItem('spb-staging-world-reset-operation');
				resetConfirmation = '';
				resetStatus = 'Mundo de staging reiniciado correctamente. El respaldo fue verificado antes del reemplazo.';
				void load();
			} else if (justFinished && status.state === 'failed') {
				toast.error('El reinicio del mundo no se completó', { description: status.error ?? 'El respaldo y los archivos existentes se conservaron.' });
				requestedWorldOperation = null;
				sessionStorage.removeItem('spb-staging-world-reset-operation');
			}
		} catch { /* El estado del reinicio no debe ocultar la promoción disponible. */ }
	}

	async function resetWorld() {
		if (!canReset || !confirm('Esto archivará el mundo actual de staging después de crear y verificar un respaldo en R2. Producción no participa. ¿Continuar?')) return;
		resettingWorld = true; error = ''; resetStatus = '';
		try {
			const response = await fetch('/api/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: resetMode, seed: resetSeed, confirmation: resetConfirmation }) });
			const body = await response.json() as { error?: string; localDevelopment?: boolean; operation?: string };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo iniciar el reinicio del mundo.');
			if (!body.localDevelopment && body.operation) {
				requestedWorldOperation = body.operation;
				sessionStorage.setItem('spb-staging-world-reset-operation', body.operation);
			}
			worldOperation = body.localDevelopment ? { state: 'idle' } : { state: 'backing-up', operation: body.operation, world: stagingWorld };
			resetStatus = body.localDevelopment ? 'Vista local: no se modificó ningún mundo.' : 'Solicitud aceptada. Staging realizará respaldo, verificación en R2 y reemplazo del mundo; esta operación puede tardar varios minutos.';
			toast.info(body.localDevelopment ? 'Vista local' : 'Reinicio de mundo solicitado', { description: body.localDevelopment ? 'No se modificó ningún mundo.' : 'El progreso y resultado aparecerán en esta tarjeta.' });
		} catch (reason) { error = reason instanceof Error ? reason.message : 'No se pudo iniciar el reinicio del mundo.'; toast.error('No se pudo iniciar el reinicio', { description: error }); }
		finally { resettingWorld = false; }
	}

	onMount(() => {
		requestedOperation = sessionStorage.getItem('spb-production-world-promotion-operation');
		requestedWorldOperation = sessionStorage.getItem('spb-staging-world-reset-operation');
		void load();
		void loadWorldOperation();
		const timer = window.setInterval(() => { if (!document.hidden && (active || requestedOperation)) void load(); if (!document.hidden && (resetting || requestedWorldOperation)) void loadWorldOperation(); }, 3000);
		return () => window.clearInterval(timer);
	});
</script>

<svelte:head><title>Promover mundo · SPB</title></svelte:head>

<main class="min-h-full bg-background text-foreground">
	<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6 md:py-10">
		<section class="space-y-2"><p class="text-sm text-muted-foreground">Mantenimiento de producción</p><h1 class="text-3xl font-semibold tracking-tight">Promover mundo de staging</h1><p class="max-w-2xl text-sm text-muted-foreground">Reemplaza el mundo activo de producción con una copia consistente del mundo activo de staging y publica sus ajustes de /server. No fusiona progreso.</p></section>
		{#if error}<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>No se pudo completar la promoción</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
		{#if loading}<div class="grid min-h-48 place-items-center text-sm text-muted-foreground"><LoaderCircle class="animate-spin" /> Leyendo estado…</div>{:else}
			<Card.Root class="border-destructive/40"><Card.Header><Card.Title>Reiniciar mundo de staging</Card.Title><Card.Description>Se crea y verifica un respaldo cifrado en R2 antes de archivar el mundo actual y generar otro. Producción no participa.</Card.Description></Card.Header><Card.Content class="grid gap-4 md:grid-cols-2">{#if resetting}<div class="md:col-span-2 flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm"><LoaderCircle class="size-5 animate-spin" /><div><p class="font-medium">{worldOperation.state === 'backing-up' ? 'Respaldando y verificando en R2' : 'Reemplazando el mundo de staging'}</p><p class="text-muted-foreground">Puedes salir de esta página; el reinicio continuará. No repitas la acción. Vuelve después para consultar el resultado.</p></div></div>{:else if worldOperation.state === 'complete'}<div class="md:col-span-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm"><p class="font-medium text-emerald-400">Mundo reiniciado correctamente</p><p class="mt-1 text-muted-foreground">Respaldo verificado antes del reemplazo{worldOperation.completedAt ? ` · Finalizó ${new Date(worldOperation.completedAt).toLocaleString()}` : ''}.</p></div>{:else if worldOperation.state === 'failed'}<div class="md:col-span-2 rounded-md border border-destructive/40 p-4 text-sm"><p class="font-medium">El reinicio no se completó</p><p class="mt-1 text-muted-foreground">{worldOperation.error ?? 'El respaldo y los archivos existentes se conservaron.'}</p></div>{/if}<div class="grid gap-2"><Label for="reset-mode">Nuevo mundo</Label><select id="reset-mode" class="h-9 rounded-md border bg-background px-3 text-sm text-foreground" bind:value={resetMode} disabled={resetting}><option class="bg-background text-foreground" value="random">Seed aleatoria</option><option class="bg-background text-foreground" value="seed">Usar una seed</option></select></div>{#if resetMode === 'seed'}<div class="grid gap-2"><Label for="reset-seed">Seed del nuevo mundo</Label><Input id="reset-seed" bind:value={resetSeed} maxlength={64} disabled={resetting} /></div>{/if}<div class="grid gap-2 md:col-span-2"><Label for="reset-confirmation">Para confirmar, escribe exactamente <code>{stagingWorld || 'el mundo activo de staging'}</code></Label><Input id="reset-confirmation" bind:value={resetConfirmation} autocomplete="off" disabled={resetting || !stagingWorld} /></div>{#if resetStatus}<p class="md:col-span-2 rounded-md border p-3 text-sm text-muted-foreground">{resetStatus}</p>{/if}</Card.Content><Card.Footer><Button type="button" variant="destructive" onclick={() => void resetWorld()} disabled={!canReset}>{#if resettingWorld}<LoaderCircle class="animate-spin" /> Preparando…{:else}<RotateCcw /> Respaldar y reiniciar mundo{/if}</Button></Card.Footer></Card.Root>
			<Card.Root class="border-amber-500/30"><Card.Header><Card.Title>Promover mundo a producción</Card.Title><Card.Description>Producción se respaldará y verificará en R2 antes del reemplazo. Se publicarán el mundo y sus ajustes de /server, como dificultad y distancia de vista. Los puertos y ajustes propios de producción se conservarán. No existe fusión automática de inventarios, cofres o progreso.</Card.Description></Card.Header><Card.Content class="space-y-5">
				<div class="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2"><div><p class="text-muted-foreground">Mundo de staging que se promoverá</p><p class="mt-1 font-medium">{promotion.stagingWorld || promotion.sourceWorld || 'No disponible'}</p></div><div><p class="text-muted-foreground">Mundo de producción que se reemplazará</p><p class="mt-1 font-medium">{promotion.productionWorld || 'No disponible'}</p></div></div>
				{#if active}<Alert.Root><LoaderCircle class="animate-spin" /><Alert.Title>{promotion.state === 'queued' ? 'Solicitud aceptada' : promotion.state === 'copying-staging-world' ? 'Copiando staging' : promotion.state === 'backing-up-production' ? 'Respaldando producción en R2' : promotion.state === 'replacing-production-world' ? 'Reemplazando mundo de producción' : 'Iniciando producción'}</Alert.Title><Alert.Description>Puedes salir de esta página; la promoción continuará. No repitas la acción. Vuelve después para consultar el resultado.</Alert.Description></Alert.Root>{:else if promotion.state === 'complete'}<Alert.Root><Alert.Title>Mundo promovido correctamente</Alert.Title><Alert.Description>Producción volvió a arrancar. El respaldo previo se verificó en R2{promotion.completedAt ? ` · ${new Date(promotion.completedAt).toLocaleString()}` : ''}.</Alert.Description></Alert.Root>{:else if promotion.state === 'failed'}<Alert.Root variant="destructive"><Alert.Title>La promoción no terminó</Alert.Title><Alert.Description>{promotion.error ?? 'Se conservó el respaldo y se intentó restaurar el mundo anterior.'}</Alert.Description></Alert.Root>{/if}
				<div class="grid gap-2"><Label for="confirmation">Para confirmar que reemplazarás <code>{promotion.productionWorld}</code>, escribe exactamente ese nombre</Label><Input id="confirmation" bind:value={confirmation} autocomplete="off" disabled={active || starting || !promotion.productionWorld} /></div>
				{#if promotionStatus}<p class="rounded-md border p-3 text-sm text-muted-foreground">{promotionStatus}</p>{/if}
			</Card.Content><Card.Footer><Button type="button" variant="destructive" onclick={() => void promote()} disabled={!canPromote}>{#if starting}<LoaderCircle class="animate-spin" /> Preparando…{:else}<Upload /> Respaldar y promover a producción{/if}</Button></Card.Footer></Card.Root>
		{/if}
	</div>
</main>
