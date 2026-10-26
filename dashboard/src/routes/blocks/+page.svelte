<script lang="ts">
	import Blocks from '@lucide/svelte/icons/blocks';
	import Copy from '@lucide/svelte/icons/copy';
	import Search from '@lucide/svelte/icons/search';
	import blockCatalog from '#lib/data/blocks.json';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	type BlockSource = 'vanilla' | 'spb';
	type Block = { id: string; source: BlockSource };

	const blocks: Block[] = [
		...blockCatalog.vanillaBlocks.map((id) => ({ id, source: 'vanilla' as const })),
		...blockCatalog.customBlocks.map((id) => ({ id, source: 'spb' as const }))
	];

	let query = $state('');
	let copied = $state('');
	const visibleBlocks = $derived(
		blocks.filter((block) => block.id.includes(query.trim().toLowerCase()))
	);

	async function copyId(id: string) {
		await navigator.clipboard.writeText(id);
		copied = id;
		window.setTimeout(() => {
			if (copied === id) copied = '';
		}, 1600);
	}
</script>

<svelte:head><title>Bloques · SPB</title></svelte:head>

<main class="min-h-full bg-background text-foreground">

	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
		<section class="space-y-2">
			<p class="text-sm text-muted-foreground">Referencia para comandos</p>
			<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Bloques disponibles</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">{blocks.length.toLocaleString()} identificadores: {blockCatalog.vanillaBlocks.length.toLocaleString()} vanilla del catálogo de datos {blockCatalog.vanillaDataVersion} y {blockCatalog.customBlocks.length} propios de SPB. Usa el ID copiado, por ejemplo, en <code class="rounded bg-muted px-1 py-0.5">give @s minecraft:stone</code>.</p>
		</section>

		<Card.Root>
			<Card.Content class="pt-6">
				<div class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input class="pl-9" bind:value={query} placeholder="Buscar por ID: stone, spb:, copper…" autofocus /></div>
				<p class="mt-3 text-sm text-muted-foreground">{visibleBlocks.length.toLocaleString()} resultado{visibleBlocks.length === 1 ? '' : 's'}</p>
			</Card.Content>
		</Card.Root>

		<section class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
			{#each visibleBlocks as block (block.id)}
				<button class="group flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:bg-accent" onclick={() => void copyId(block.id)} title={`Copiar ${block.id}`}>
					<span class="flex size-9 shrink-0 items-center justify-center rounded-sm bg-muted"><Blocks class="size-4 text-muted-foreground" /></span>
					<span class="min-w-0 flex-1 truncate font-mono text-sm">{block.id}</span>
					<span class="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">{block.source}</span>
					<Copy class="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
				</button>
			{:else}
				<p class="col-span-full py-12 text-center text-sm text-muted-foreground">No hay bloques que coincidan con esa búsqueda.</p>
			{/each}
		</section>
		{#if copied}<p class="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-full border bg-popover px-4 py-2 text-sm shadow-lg">Copiado: <span class="font-mono">{copied}</span></p>{/if}
	</div>
</main>
