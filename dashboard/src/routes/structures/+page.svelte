<script lang="ts">
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import FileUp from '@lucide/svelte/icons/file-up';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import MapPinned from '@lucide/svelte/icons/map-pinned';
	import PackagePlus from '@lucide/svelte/icons/package-plus';
	import Upload from '@lucide/svelte/icons/upload';
	import { toast } from 'svelte-sonner';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	type Structure = { name: string; size: number; sha: string; path: string };

	let structures = $state<Structure[]>([]);
	let error = $state('');
	let loading = $state(true);
	let exporting = $state(false);
	let importing = $state(false);
	let placing = $state(false);
	let source = $state('mystructure:');
	let target = $state('');
	let selected = $state('');
	let x = $state('');
	let y = $state('');
	let z = $state('');
	let rotation = $state('0_degrees');
	let mirror = $state('none');
	let confirmation = $state('');
	let fileInput: HTMLInputElement;
	let selectedFiles = $state<FileList | undefined>(undefined);
	let environment = $state<'staging' | 'production'>('staging');

	function activeEnvironment() {
		return document.cookie
			.split('; ')
			.find((item) => item.startsWith('spb_environment='))
			?.endsWith('production')
			? 'production'
			: 'staging';
	}

	function formatSize(bytes: number) {
		return bytes < 1024 * 1024
			? `${Math.max(1, Math.round(bytes / 1024))} KiB`
			: `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const response = await fetch('/api/structures');
			const body = (await response.json().catch(() => ({}))) as {
				structures?: Structure[];
				error?: string;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo leer la biblioteca.');
			structures = body.structures ?? [];
			if (!selected && structures[0]) selected = structures[0].name;
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo leer la biblioteca.';
		} finally {
			loading = false;
		}
	}

	async function exportSaved() {
		if (exporting) return;
		exporting = true;
		try {
			const response = await fetch('/api/structures/export', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source, target })
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				name?: string;
				deployment?: string;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo exportar.');
			toast.success(`Estructura ${body.name} publicada`, { description: body.deployment });
			await load();
		} catch (reason) {
			toast.error('No se pudo exportar la estructura', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			exporting = false;
		}
	}

	async function importFile() {
		const file = selectedFiles?.[0];
		if (importing) return;
		if (!file) {
			toast.error('Selecciona un archivo .mcstructure antes de publicar.');
			return;
		}
		if (!file.name.toLowerCase().endsWith('.mcstructure')) {
			toast.error('El archivo debe tener extensión .mcstructure.');
			return;
		}
		if (!file.size || file.size > 8 * 1024 * 1024) {
			toast.error('La estructura debe medir entre 1 byte y 8 MiB.');
			return;
		}
		importing = true;
		try {
			const response = await fetch(`/api/structures?name=${encodeURIComponent(target)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: file
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				name?: string;
				deployment?: string;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo importar.');
			toast.success(`Archivo ${body.name} publicado`, { description: body.deployment });
			fileInput.value = '';
			selectedFiles = new DataTransfer().files;
			await load();
		} catch (reason) {
			toast.error('No se pudo importar el archivo', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			importing = false;
		}
	}

	function expectedConfirmation() {
		return selected && x && y && z ? `spb:${selected} @ ${x} ${y} ${z}` : '';
	}

	async function place() {
		if (placing || !expectedConfirmation()) return;
		placing = true;
		try {
			const response = await fetch('/api/structures/place', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: selected,
					x: Number(x),
					y: Number(y),
					z: Number(z),
					rotation,
					mirror,
					confirmation
				})
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				environment?: string;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo colocar.');
			toast.success('Comando de colocación enviado', {
				description: `Revisa la terminal de ${body.environment === 'production' ? 'producción' : 'staging'} para confirmar el resultado.`
			});
			confirmation = '';
		} catch (reason) {
			toast.error('No se pudo colocar la estructura', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			placing = false;
		}
	}

	onMount(() => {
		environment = activeEnvironment();
		void load();
	});
</script>

<svelte:head><title>Estructuras · SPB</title></svelte:head>

<main class="min-h-full bg-background text-foreground">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-10">
		<section class="space-y-2">
			<p class="text-sm text-muted-foreground">
				Entorno seleccionado: {environment === 'production' ? 'Producción' : 'Staging'}
			</p>
			<h1 class="text-3xl font-semibold tracking-tight md:text-4xl">Estructuras</h1>
			<p class="max-w-3xl text-sm text-muted-foreground">
				La biblioteca vive en GitHub, dentro de <code>BP/structures/spb</code>. Exportar o importar
				publica una plantilla; colocarla en un mundo es una acción distinta y confirmada.
			</p>
		</section>
		{#if error}<Alert.Root variant="destructive"
				><Alert.Title>No se pudo abrir la biblioteca</Alert.Title><Alert.Description
					>{error}</Alert.Description
				></Alert.Root
			>{/if}
		<section class="grid gap-4 lg:grid-cols-2">
			<Card.Root
				><Card.Header
					><Card.Title class="flex items-center gap-2"
						><PackagePlus class="size-5" /> Exportar desde el mundo</Card.Title
					><Card.Description
						>Primero guarda mediante Structure Block en <strong>Save to Disk</strong>. Se copia una
						instantánea temporal; el mundo no se reemplaza.</Card.Description
					></Card.Header
				><Card.Content class="grid gap-4"
					><div class="grid gap-2">
						<Label for="source">Nombre guardado</Label><Input
							id="source"
							bind:value={source}
							placeholder="mystructure:mi_casa"
						/>
					</div>
					<div class="grid gap-2">
						<Label for="target">Nombre en biblioteca SPB</Label><Input
							id="target"
							bind:value={target}
							placeholder="mi_casa"
						/>
					</div></Card.Content
				><Card.Footer
					><Button
						onclick={() => void exportSaved()}
						disabled={exporting || !source.trim() || !target.trim()}
						>{#if exporting}<LoaderCircle class="animate-spin" /> Extrayendo…{:else}<Upload /> Exportar
							y publicar{/if}</Button
					></Card.Footer
				></Card.Root
			>
			<Card.Root
				><Card.Header
					><Card.Title class="flex items-center gap-2"
						><FileUp class="size-5" /> Importar archivo</Card.Title
					><Card.Description
						>Publica un archivo <code>.mcstructure</code> ya existente en la misma biblioteca versionada.</Card.Description
					></Card.Header
				><Card.Content class="grid gap-4"
					><div class="grid gap-2">
						<Label for="file">Archivo .mcstructure</Label><Input
							id="file"
							bind:this={fileInput}
							bind:files={selectedFiles}
							type="file"
							accept=".mcstructure,application/octet-stream"
						/>
					</div>
					<div class="grid gap-2">
						<Label for="upload-name">Nombre en biblioteca SPB</Label><Input
							id="upload-name"
							bind:value={target}
							placeholder="mi_casa"
						/>
					</div></Card.Content
				><Card.Footer
					><Button
						variant="outline"
						onclick={() => void importFile()}
						disabled={importing || !target.trim() || !selectedFiles?.length}
						>{#if importing}<LoaderCircle class="animate-spin" /> Publicando…{:else}<FileUp /> Importar
							y publicar{/if}</Button
					></Card.Footer
				></Card.Root
			>
		</section>
		<Card.Root
			><Card.Header
				><Card.Title>Biblioteca versionada</Card.Title><Card.Description
					>{loading
						? 'Consultando GitHub…'
						: `${structures.length} estructura${structures.length === 1 ? '' : 's'} disponible${structures.length === 1 ? '' : 's'}.`}</Card.Description
				></Card.Header
			><Card.Content
				>{#if structures.length}<div class="divide-y rounded-md border">
						{#each structures as structure}<div class="flex flex-wrap items-center gap-3 px-4 py-3">
								<code class="min-w-0 flex-1 truncate">spb:{structure.name}</code><span
									class="text-sm text-muted-foreground">{formatSize(structure.size)}</span
								><Button
									size="sm"
									variant="outline"
									href={`/api/structures?download=${encodeURIComponent(structure.name)}`}
									><Download /> Descargar</Button
								>
							</div>{/each}
					</div>{:else if !loading}<div
						class="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
					>
						Todavía no hay estructuras publicadas.
					</div>{/if}</Card.Content
			></Card.Root
		>
		<Card.Root class="border-amber-500/30"
			><Card.Header
				><Card.Title
					>Colocar en {environment === 'production' ? 'producción' : 'staging'}</Card.Title
				><Card.Description
					>Esto modifica el mundo seleccionado. La plantilla debe haber llegado ya a este entorno
					mediante el despliegue correspondiente.</Card.Description
				></Card.Header
			><Card.Content class="grid gap-4 md:grid-cols-3"
				><div class="grid gap-2 md:col-span-3">
					<Label for="structure">Estructura</Label><select
						id="structure"
						class="h-9 rounded-md border bg-background px-3 text-sm"
						bind:value={selected}
						>{#each structures as structure}<option value={structure.name}
								>spb:{structure.name}</option
							>{/each}</select
					>
				</div>
				<div class="grid gap-2">
					<Label for="x">X</Label><Input id="x" bind:value={x} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="y">Y</Label><Input id="y" bind:value={y} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="z">Z</Label><Input id="z" bind:value={z} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="rotation">Giro</Label><select
						id="rotation"
						class="h-9 rounded-md border bg-background px-3 text-sm"
						bind:value={rotation}
						><option value="0_degrees">0°</option><option value="90_degrees">90°</option><option
							value="180_degrees">180°</option
						><option value="270_degrees">270°</option></select
					>
				</div>
				<div class="grid gap-2">
					<Label for="mirror">Espejo</Label><select
						id="mirror"
						class="h-9 rounded-md border bg-background px-3 text-sm"
						bind:value={mirror}
						><option value="none">Ninguno</option><option value="x">Eje X</option><option value="z"
							>Eje Z</option
						><option value="xz">X y Z</option></select
					>
				</div>
				<div class="grid gap-2 md:col-span-3">
					<Label for="confirm"
						>Para confirmar, escribe exactamente <code
							>{expectedConfirmation() || 'spb:nombre @ X Y Z'}</code
						></Label
					><Input id="confirm" bind:value={confirmation} autocomplete="off" />
				</div></Card.Content
			><Card.Footer
				><Button
					variant="destructive"
					onclick={() => void place()}
					disabled={placing || !selected || confirmation !== expectedConfirmation()}
					>{#if placing}<LoaderCircle class="animate-spin" /> Enviando…{:else}<MapPinned /> Colocar estructura{/if}</Button
				></Card.Footer
			></Card.Root
		>
	</div>
</main>
