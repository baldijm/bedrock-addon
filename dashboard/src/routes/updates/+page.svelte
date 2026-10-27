<script lang="ts">
	import { onMount } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Download from '@lucide/svelte/icons/download';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	type Update = { environment: 'staging' | 'production'; installedVersion?: string; official?: { version: string; source: string; url: string }; state?: string; operation?: string; error?: string; updateAvailable?: boolean };
	const busyStates = new Set(['preparing', 'downloading', 'validating', 'backing-up', 'stopping', 'installing', 'starting']);
	const stateLabels: Record<string, string> = { idle: 'Sin actualizaciones en curso', preparing: 'Preparando actualización', downloading: 'Descargando paquete oficial', validating: 'Validando paquete', 'backing-up': 'Respaldando producción en R2', stopping: 'Deteniendo Bedrock', installing: 'Instalando nueva versión', starting: 'Iniciando Bedrock', complete: 'Actualización completada', failed: 'La actualización falló' };
	let update = $state<Update | null>(null);
	let loading = $state(true);
	let starting = $state(false);
	let confirmUpdate = $state(false);
	let environment = $state<'staging' | 'production'>('staging');
	let poll: ReturnType<typeof setInterval> | undefined;
	function activeEnvironment() { return document.cookie.split('; ').find((part) => part.startsWith('spb_environment='))?.endsWith('production') ? 'production' : 'staging'; }
	function label(value?: string) { return stateLabels[value ?? 'idle'] ?? value ?? 'Sin estado'; }
	function isBusy() { return Boolean(update?.state && busyStates.has(update.state)); }
	async function load(silent = false) {
		if (!silent) loading = true;
		try { const response = await fetch('/api/updates'); const body = (await response.json().catch(() => ({}))) as Update; if (!response.ok) throw new Error(body.error ?? 'No se pudo consultar las actualizaciones.'); update = body; if (!isBusy() && poll) { clearInterval(poll); poll = undefined; } }
		catch (reason) { update = { environment, state: 'failed', error: reason instanceof Error ? reason.message : 'No se pudo consultar las actualizaciones.' }; }
		finally { loading = false; }
	}
	async function begin() {
		if (starting || !confirmUpdate) return;
		starting = true;
		try { const response = await fetch('/api/updates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }); const body = (await response.json().catch(() => ({}))) as Update; if (!response.ok) throw new Error(body.error ?? 'No se pudo iniciar la actualización.'); confirmUpdate = false; toast.success('Actualización iniciada', { description: 'Puedes salir de esta página: la operación continúa en la VM y su estado quedará registrado.' }); await load(true); if (!poll) poll = setInterval(() => void load(true), 5000); }
		catch (reason) { toast.error('No se pudo iniciar la actualización', { description: reason instanceof Error ? reason.message : undefined }); }
		finally { starting = false; }
	}
	onMount(() => { environment = activeEnvironment(); void load(); return () => { if (poll) clearInterval(poll); }; });
</script>

<svelte:head><title>Actualizaciones · SPB</title></svelte:head>
<main class="min-h-full bg-background text-foreground"><div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
	<section class="space-y-2"><p class="text-sm text-muted-foreground">Entorno seleccionado: {environment === 'production' ? 'Producción' : 'Staging'}</p><h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Actualizaciones</h1><p class="max-w-2xl text-sm text-muted-foreground">Compara tu Bedrock instalado con el paquete estable oficial de Microsoft. Sólo revisa cuando abres esta ruta; durante una actualización consulta su avance cada 5 segundos.</p></section>
	{#if update?.error}<Alert.Root variant="destructive"><CircleAlert /><Alert.Title>No se pudo consultar o completar la actualización</Alert.Title><Alert.Description>{update.error}</Alert.Description></Alert.Root>{/if}
	<Card.Root><Card.Header><Card.Title class="flex items-center gap-2"><ShieldCheck class="size-5" /> Estado de Bedrock</Card.Title><Card.Description>Fuente: Microsoft, paquete Linux estable.</Card.Description></Card.Header><Card.Content class="grid gap-5 sm:grid-cols-2"><div class="rounded-md border p-4"><p class="text-sm text-muted-foreground">Instalada</p><p class="mt-1 font-mono text-xl font-semibold">{loading ? 'Consultando…' : update?.installedVersion ?? 'No se pudo determinar'}</p></div><div class="rounded-md border p-4"><p class="text-sm text-muted-foreground">Disponible</p><p class="mt-1 font-mono text-xl font-semibold">{loading ? 'Consultando…' : update?.official?.version ?? 'No disponible'}</p></div><div class="sm:col-span-2 rounded-md border p-4"><p class="text-sm text-muted-foreground">Estado</p><p class="mt-1 font-medium">{label(update?.state)}</p>{#if update?.state === 'complete'}<p class="mt-1 text-sm text-emerald-500">Bedrock volvió a quedar activo con la versión instalada indicada.</p>{/if}</div></Card.Content><Card.Footer class="flex flex-wrap gap-3"><Button variant="outline" onclick={() => void load()} disabled={loading || isBusy()}>{#if loading}<LoaderCircle class="animate-spin" /> Consultando…{:else}<RefreshCw /> Revisar ahora{/if}</Button>{#if update?.updateAvailable && !isBusy()}<Button onclick={() => (confirmUpdate = true)}><Download /> Actualizar {environment === 'production' ? 'producción' : 'staging'}</Button>{:else if !loading && !update?.updateAvailable && !isBusy()}<span class="text-sm text-muted-foreground">Este entorno ya está al día.</span>{/if}</Card.Footer></Card.Root>
	{#if confirmUpdate}<Card.Root class="border-amber-500/40"><Card.Header><Card.Title>Confirmar actualización de {environment === 'production' ? 'producción' : 'staging'}</Card.Title><Card.Description>{#if environment === 'production'}Se creará y verificará un respaldo cifrado en R2 antes de cambiar archivos. Los jugadores se desconectarán durante la actualización.{:else}Staging se reiniciará brevemente. Se conservan mundo, configuración y los paquetes SPB.{/if}</Card.Description></Card.Header><Card.Footer class="gap-3"><Button variant="outline" onclick={() => (confirmUpdate = false)}>Cancelar</Button><Button onclick={() => void begin()} disabled={starting}>{#if starting}<LoaderCircle class="animate-spin" /> Iniciando…{:else}Confirmar y actualizar{/if}</Button></Card.Footer></Card.Root>{/if}
</div></main>
