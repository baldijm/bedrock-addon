<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Server from '@lucide/svelte/icons/server';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Alert } from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	type PlayerSnapshot = { online: number; capacity: number; players: string[]; observedAt: string; source: string };
	let loading = $state(true);
	let refreshing = $state(false);
	let snapshot = $state<PlayerSnapshot | null>(null);
	let error = $state('');

	async function load() {
		refreshing = true;
		error = '';
		try {
			const response = await fetch('/api/players');
			const body = await response.json() as PlayerSnapshot & { error?: string };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo consultar a Bedrock.');
			snapshot = body;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'No se pudo consultar a Bedrock.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		void load();
		const refreshWhenVisible = () => { if (!document.hidden) void load(); };
		document.addEventListener('visibilitychange', refreshWhenVisible);
		const timer = window.setInterval(refreshWhenVisible, 15000);
		return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshWhenVisible); };
	});
</script>

<svelte:head><title>Miembros · SPB</title></svelte:head>

<main class="min-h-full bg-background text-foreground">
	<div class="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6 md:py-10">
		<section class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div class="space-y-2"><p class="text-sm text-muted-foreground">Comunidad de staging</p><h1 class="text-3xl font-semibold tracking-tight">Miembros</h1><p class="max-w-2xl text-sm text-muted-foreground">Aquí vivirá el registro de participantes. Por ahora, la lista mostrada es la respuesta real y en vivo de Bedrock.</p></div><Button variant="outline" onclick={() => void load()} disabled={refreshing}>{#if refreshing}<LoaderCircle class="animate-spin" /> Actualizando…{:else}<RefreshCw /> Actualizar{/if}</Button></section>
		{#if error}<Alert.Root variant="destructive"><Alert.Title>No se pudo consultar a los miembros en línea</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
		<section class="grid gap-4 md:grid-cols-2"><Card.Root><Card.Header><Card.Description>En línea ahora</Card.Description><Card.Title class="flex items-center gap-2 text-3xl"><UsersRound class="size-6" /> {snapshot?.online ?? '—'}{#if snapshot?.capacity !== undefined}<span class="text-base font-normal text-muted-foreground">/ {snapshot.capacity}</span>{/if}</Card.Title></Card.Header><Card.Content class="text-sm text-muted-foreground">Consulta directa del comando <code>list</code> de Bedrock, actualizada automáticamente.</Card.Content></Card.Root><Card.Root><Card.Header><Card.Description>Miembros registrados</Card.Description><Card.Title class="text-3xl">Pendiente</Card.Title></Card.Header><Card.Content class="text-sm text-muted-foreground">Aún no existe un registro histórico independiente. Se añadirá cuando definamos “miembro” y guardemos esa información fuera del mundo.</Card.Content></Card.Root></section>
		<Card.Root><Card.Header><Card.Title class="flex items-center gap-2"><Server class="size-5" /> Jugadores conectados</Card.Title><Card.Description>{snapshot?.observedAt ? `Última consulta: ${new Date(snapshot.observedAt).toLocaleString()}` : 'Esperando respuesta de Bedrock.'}</Card.Description></Card.Header><Card.Content>{#if loading}<div class="grid min-h-32 place-items-center text-sm text-muted-foreground"><LoaderCircle class="mr-2 size-4 animate-spin" /> Consultando Bedrock…</div>{:else if snapshot?.players.length}<ul class="divide-y rounded-md border">{#each snapshot.players as player}<li class="flex items-center gap-3 px-4 py-3"><span class="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{player.slice(0, 1).toUpperCase()}</span><span class="font-medium">{player}</span><Badge class="ml-auto" variant="outline">En línea</Badge></li>{/each}</ul>{:else}<div class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No hay jugadores conectados en este momento.</div>{/if}</Card.Content></Card.Root>
	</div>
</main>
