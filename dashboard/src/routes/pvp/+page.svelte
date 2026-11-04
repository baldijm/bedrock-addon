<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { legacyArena, validateArena, type Arena, type ArenaState, type Point, type Region } from '#lib/pvp-arenas';
	let catalog = $state<ArenaState>({ revision: 0, arenas: [], active: null, history: [] });
	let draft = $state<Arena>(structuredClone(legacyArena));
	let selected = $state('');
	let environment = $state('');
	let world = $state('');
	let confirmation = $state('');
	let working = $state('Consultando arenas…');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let ready = $state(false);
	let pending = $state<'save' | 'activate' | 'deactivate' | 'delete' | ''>('');
	const pointFields = [ ['p1', 'Jugador 1'], ['p2', 'Jugador 2'], ['returnPoint', 'Centro de retorno'], ['npc1', 'NPC del jugador 1'], ['npc2', 'NPC del jugador 2'] ] as const;
	const regionFields = [ ['bounds', 'Área segura y protegida'], ['goal1', 'Portería del jugador 1'], ['goal2', 'Portería del jugador 2'] ] as const;
	const actionNames = { save: 'Guardar borrador', activate: 'Activar arena guardada', deactivate: 'Desactivar arena', delete: 'Eliminar borrador' };
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(catalog.arenas.find(item => item.id === selected)));
	function edit(arena: Arena) { draft = structuredClone(arena); selected = arena.id; pending = ''; error = ''; notice = ''; }
	function create() {
		const arena = structuredClone(draft);
		arena.id = `arena-${Date.now().toString(36)}`; arena.name = 'Nueva arena';
		draft = arena; selected = ''; pending = ''; error = ''; notice = '';
	}
	async function load() {
		working = 'Consultando configuración y partida…'; error = ''; pending = '';
		try {
			const response = await fetch('/api/pvp/arenas');
			const result = await response.json() as { error?: string; state: ArenaState; environment: string; world: string; busy: boolean };
			if (!response.ok) throw new Error(result.error);
			catalog = result.state; environment = result.environment; world = result.world; busy = result.busy; ready = true;
			const arena = catalog.arenas.find(item => item.id === selected) ?? catalog.arenas[0];
			if (arena) edit(arena); else create();
		} catch (reason) { ready = false; error = String(reason instanceof Error ? reason.message : reason); }
		finally { working = ''; }
	}
	function requestAction(action: typeof pending) {
		error = ''; notice = '';
		try { if (action === 'save') validateArena(draft); pending = action; confirmation = ''; }
		catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
	}
	async function apply() {
		if (!pending) return;
		const action = pending;
		working = action === 'activate' ? 'Cargando zona y comprobando suelo y espacio libre…' : 'Guardando y esperando confirmación de Bedrock…';
		error = ''; notice = '';
		try {
			const response = await fetch('/api/pvp/arenas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, revision: catalog.revision, arena: draft, id: selected, confirmation }) });
			const result = await response.json() as { error?: string; state: ArenaState; busy: boolean };
			if (!response.ok) throw new Error(result.error);
			catalog = result.state; busy = result.busy;
			if (action === 'save') selected = draft.id;
			if (action === 'delete') { const next = catalog.arenas[0]; if (next) edit(next); else create(); }
			pending = ''; confirmation = '';
			notice = action === 'save' ? 'Borrador guardado. Actívalo para utilizar estas coordenadas en las partidas.' : action === 'activate' ? 'Arena activada. Los NPC aparecerán únicamente durante el lobby de una partida.' : action === 'deactivate' ? 'Arena desactivada. No se pueden iniciar partidas.' : 'Borrador eliminado.';
		} catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
		finally { working = ''; }
	}
	onMount(load);
</script>

<svelte:head><title>Arenas PvP · SPB</title></svelte:head>
<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-8">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div><h1 class="text-2xl font-semibold">Arenas PvP</h1><p class="mt-1 text-sm text-muted-foreground">Crea y configura hasta 12 arenas por mundo. Una arena activa y una partida a la vez.</p></div>
		<Button variant="outline" onclick={load} disabled={!!working}>Actualizar</Button>
	</div>
	{#if working}<p role="status" class="rounded-lg border p-4 text-sm">{working}</p>{/if}
	{#if error}<p role="alert" class="rounded-lg border border-destructive p-4 text-sm text-destructive">{error}</p>{/if}
	{#if notice}<p role="status" class="rounded-lg border border-green-600 p-4 text-sm">{notice}</p>{/if}
	{#if ready}
		<div class="rounded-lg border bg-card p-4">
			<p class="font-medium">{environment === 'production' ? 'Producción' : 'Staging'} · {world}</p>
			<p class="mt-1 text-sm">{catalog.active ? `Activa: ${catalog.active.name} (${catalog.active.id})` : 'Sin arena activa. Las partidas están deshabilitadas.'}</p>
			{#if busy}<p class="mt-2 text-sm text-amber-500">Hay una partida o activación en curso. Actualiza al terminar para editar.</p>{/if}
		</div>
		<div class="grid items-start gap-6 md:grid-cols-[230px_1fr]">
			<aside class="flex flex-col gap-2 rounded-lg border p-3">
				{#each catalog.arenas as arena}
					<Button variant={selected === arena.id ? 'secondary' : 'ghost'} class="justify-start" disabled={!!working || !!pending} onclick={() => edit(arena)}>{arena.name}{catalog.active?.id === arena.id ? ' · Activa' : ''}</Button>
				{/each}
				<Button variant="outline" disabled={!!working || busy || !!pending || catalog.arenas.length >= 12} onclick={create}>Crear arena</Button>
				<p class="mt-2 text-xs text-muted-foreground">Crear una arena registra las reglas y coordenadas. Construye el mapa en el juego o colócalo desde Estructuras.</p>
			</aside>
			<div class="flex flex-col gap-5 rounded-lg border bg-card p-4 md:p-6">
				<fieldset disabled={!!working || busy || !!pending} class="flex flex-col gap-5 disabled:opacity-60">
					<div class="grid gap-4 sm:grid-cols-2">
						<label class="text-sm">Nombre<Input bind:value={draft.name} maxlength={60} /></label>
						<label class="text-sm">Identificador<Input bind:value={draft.id} disabled={!!selected} maxlength={32} /></label>
					</div>
					<label class="text-sm">Dimensión<select bind:value={draft.dimension} class="mt-1 h-10 w-full rounded-md border bg-background px-3"><option value="minecraft:overworld">Overworld</option><option value="minecraft:nether">Nether</option><option value="minecraft:the_end">The End</option></select></label>
					{#each pointFields as [key, label]}
						{@render pointEditor(label, draft[key])}
						{#if key === 'npc1' || key === 'npc2'}
							<label class="text-sm">Orientación {key === 'npc1' ? 'NPC 1' : 'NPC 2'} (grados)<Input type="number" min={-180} max={180} bind:value={draft[key === 'npc1' ? 'yaw1' : 'yaw2']} /></label>
						{/if}
					{/each}
					<p class="text-xs text-muted-foreground">Orientación: 0° → +Z · 90° → −X · 180° / −180° → −Z · −90° → +X. Las posiciones son los pies del jugador o NPC.</p>
					{#each regionFields as [key, label]}
						<div class="rounded-md border p-3"><h3 class="mb-3 text-sm font-medium">{label}</h3>{@render regionEditor(draft[key])}</div>
					{/each}
					<p class="text-xs text-muted-foreground">Área segura: máximo 128 × 128 bloques y 64 chunks. Las porterías y posiciones deben quedar dentro. Al activar se comprueba suelo sólido y espacio libre.</p>
				</fieldset>
				{#if dirty}<p class="text-sm text-amber-500">Hay cambios sin guardar. Guardar el borrador no modifica las coordenadas de la arena activa.</p>{/if}
				<div class="flex flex-wrap gap-2">
					<Button disabled={!!working || busy || !!pending || !dirty} onclick={() => requestAction('save')}>Guardar borrador</Button>
					<Button variant="outline" disabled={!!working || busy || !!pending || !selected || dirty} onclick={() => requestAction('activate')}>Activar arena</Button>
					<Button variant="outline" disabled={!!working || busy || !!pending || !catalog.active} onclick={() => requestAction('deactivate')}>Desactivar</Button>
					<Button variant="destructive" disabled={!!working || busy || !!pending || !selected || catalog.active?.id === selected} onclick={() => requestAction('delete')}>Eliminar</Button>
				</div>
				{#if pending}
					<div class="flex flex-col gap-3 rounded-md border p-4">
						<p class="font-medium">{actionNames[pending]} · {environment === 'production' ? 'Producción' : 'Staging'}</p>
						<p class="text-sm">{pending === 'save' ? 'Se guardarán los datos del formulario como borrador en este mundo.' : pending === 'activate' ? 'Se utilizará la versión guardada para las próximas partidas. Los NPC sólo aparecerán durante el lobby.' : pending === 'delete' ? 'Se eliminará la configuración guardada. La construcción del mapa permanece.' : 'Se impedirán nuevas partidas y se retirarán los NPC de esta arena.'}</p>
						{#if environment === 'production'}<label class="text-sm">Escribe {world} para confirmar<Input bind:value={confirmation} autocomplete="off" /></label>{/if}
						<div class="flex gap-2"><Button onclick={apply} disabled={!!working || (environment === 'production' && confirmation !== world)}>Confirmar</Button><Button variant="outline" onclick={() => pending = ''} disabled={!!working}>Cancelar</Button></div>
					</div>
				{/if}
			</div>
		</div>
		<section class="rounded-lg border p-4"><h2 class="mb-3 font-medium">Historial del mundo</h2><p class="mb-3 text-xs text-muted-foreground">Las acciones se atribuyen a la sesión administrativa compartida del dashboard.</p>{#each catalog.history as event}<p class="py-1 text-sm">{new Date(event.at).toLocaleString()} · {actionNames[event.action as keyof typeof actionNames] ?? event.action} · {event.arena}</p>{:else}<p class="text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>{/each}</section>
	{/if}
</div>

{#snippet pointEditor(label: string, point: Point)}
	<div><p class="mb-2 text-sm font-medium">{label}</p><div class="grid grid-cols-3 gap-2">{#each ['x', 'y', 'z'] as axis}<label class="text-xs text-muted-foreground">{axis.toUpperCase()}<Input type="number" step={1} bind:value={point[axis as keyof Point]} /></label>{/each}</div></div>
{/snippet}
{#snippet regionEditor(region: Region)}
	<div class="flex flex-col gap-3">{@render pointEditor('Esquina mínima', region.min)}{@render pointEditor('Esquina máxima', region.max)}</div>
{/snippet}
