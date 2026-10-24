<script lang="ts">
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	type Promotion = {
		state?: string; operation?: string; sourceWorld?: string; productionWorld?: string;
		snapshot?: string; backupSha256?: string; completedAt?: string; error?: string;
	};

	let loading = $state(true);
	let starting = $state(false);
	let confirmation = $state('');
	let error = $state('');
	let promotion = $state<Promotion>({ state: 'idle' });
	let requestedOperation = $state<string | null>(null);

	const active = $derived(['copying-staging-world', 'backing-up-production', 'replacing-production-world', 'starting-production'].includes(promotion.state ?? ''));
	const canPromote = $derived(Boolean(promotion.productionWorld) && confirmation === promotion.productionWorld && !active && !starting);

	async function load() {
		try {
			const response = await fetch('/api/world-promotion');
			if (response.status === 401) { location.replace('/terminal?returnTo=/releases'); return; }
			const body = await response.json() as Promotion;
			if (!response.ok) throw new Error(body.error ?? 'No se pudo consultar la promoción.');
			promotion = body;
			if (requestedOperation && body.operation === requestedOperation && (body.state === 'complete' || body.state === 'failed')) requestedOperation = null;
			error = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo consultar la promoción.';
		} finally {
			loading = false;
		}
	}

	async function promote() {
		if (!canPromote || !confirm('Producción se detendrá brevemente y su mundo actual será reemplazado por el mundo activo de staging. Se creará y verificará un respaldo en R2 antes. ¿Continuar?')) return;
		starting = true; error = '';
		try {
			const response = await fetch('/api/world-promotion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
			const body = await response.json() as Promotion;
			if (!response.ok) throw new Error(body.error ?? 'No se pudo iniciar la promoción.');
			requestedOperation = body.operation ?? null;
			promotion = body;
			confirmation = '';
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo iniciar la promoción.';
		} finally {
			starting = false;
		}
	}

	onMount(() => {
		void load();
		const timer = window.setInterval(() => { if (!document.hidden && (active || requestedOperation)) void load(); }, 3000);
		return () => window.clearInterval(timer);
	});
</script>

<svelte:head><title>Promover mundo · SPB</title></svelte:head>

<main class="dark min-h-svh bg-background text-foreground">
	<header class="border-b"><div class="mx-auto flex h-16 w-full max-w-3xl items-center gap-3 px-4 md:px-6"><div><p class="text-sm font-semibold">SPB</p><p class="text-xs text-muted-foreground">Promoción de mundo</p></div><Button class="ml-auto" variant="outline" size="sm" href="/server"><ArrowLeft /> Servidor</Button></div></header>
	<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-6 md:py-10">
		<section class="space-y-2"><p class="text-sm text-muted-foreground">Mantenimiento de producción</p><h1 class="text-3xl font-semibold tracking-tight">Promover mundo de staging</h1><p class="max-w-2xl text-sm text-muted-foreground">Reemplaza el mundo activo de producción con una copia consistente del mundo activo de staging. Úsalo solo cuando quieras publicar el mundo completo, no para fusionar progreso.</p></section>
		{#if error}<Alert.Root variant="destructive"><ShieldAlert /><Alert.Title>No se pudo completar la promoción</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
		{#if loading}<div class="grid min-h-48 place-items-center text-sm text-muted-foreground"><LoaderCircle class="animate-spin" /> Leyendo estado…</div>{:else}
			<Card.Root class="border-amber-500/30"><Card.Header><Card.Title>Reemplazo completo de mundo</Card.Title><Card.Description>Producción se respaldará y verificará en R2 antes de cualquier reemplazo. No existe fusión automática de inventarios, cofres o progreso entre los dos mundos.</Card.Description></Card.Header><Card.Content class="space-y-5">
				<div class="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2"><div><p class="text-muted-foreground">Mundo de staging</p><p class="mt-1 font-medium">Se toma al iniciar la promoción</p></div><div><p class="text-muted-foreground">Mundo de producción</p><p class="mt-1 font-medium">{promotion.productionWorld || 'No disponible'}</p></div></div>
				{#if active}<Alert.Root><LoaderCircle class="animate-spin" /><Alert.Title>{promotion.state === 'copying-staging-world' ? 'Copiando staging' : promotion.state === 'backing-up-production' ? 'Respaldando producción en R2' : promotion.state === 'replacing-production-world' ? 'Reemplazando mundo de producción' : 'Iniciando producción'}</Alert.Title><Alert.Description>La operación está en curso. No cierres ni repitas esta acción; el estado se actualiza automáticamente.</Alert.Description></Alert.Root>{:else if promotion.state === 'complete'}<Alert.Root><Alert.Title>Mundo promovido correctamente</Alert.Title><Alert.Description>Producción volvió a arrancar. El respaldo previo se verificó en R2{promotion.completedAt ? ` · ${new Date(promotion.completedAt).toLocaleString()}` : ''}.</Alert.Description></Alert.Root>{:else if promotion.state === 'failed'}<Alert.Root variant="destructive"><Alert.Title>La promoción no terminó</Alert.Title><Alert.Description>{promotion.error ?? 'Se conservó el respaldo y se intentó restaurar el mundo anterior.'}</Alert.Description></Alert.Root>{/if}
				<div class="grid gap-2"><Label for="confirmation">Para habilitar la promoción, escribe exactamente <code>{promotion.productionWorld}</code></Label><Input id="confirmation" bind:value={confirmation} autocomplete="off" disabled={active || starting || !promotion.productionWorld} /></div>
			</Card.Content><Card.Footer><Button type="button" variant="destructive" onclick={() => void promote()} disabled={!canPromote}>{#if starting}<LoaderCircle class="animate-spin" /> Preparando…{:else}<Upload /> Respaldar y promover a producción{/if}</Button></Card.Footer></Card.Root>
		{/if}
	</div>
</main>
