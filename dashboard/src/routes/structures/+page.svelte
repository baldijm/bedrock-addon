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
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import {
		resolveStructureOrigin,
		type StructureAnchor,
		type StructureMirror,
		type StructureRotation
	} from '#lib/structure-placement';

	type Structure = {
		name: string;
		size: number;
		sha: string;
		path: string;
		dimensions: { x: number; y: number; z: number } | null;
		source?: 'github' | 'r2';
	};

	type PendingPlacement = {
		name: string;
		x: number;
		y: number;
		z: number;
		rotation: string;
		mirror: string;
		mode: 'instant' | 'layers';
		includeBlocks: boolean;
		includeAir: boolean;
		protectBlocks: boolean;
		protectPlace: boolean;
		protectEnvironment: boolean;
		anchor: StructureAnchor;
		origin: { x: number; y: number; z: number };
	};
	type PendingErase = {
		x: number;
		y: number;
		z: number;
		width: number;
		height: number;
		depth: number;
	};
	type StaticCandidate = { id: string; replacement: string; label: string };

	let structures = $state<Structure[]>([]);
	let error = $state('');
	let loading = $state(true);
	let exporting = $state(false);
	let importing = $state(false);
	let importProgress = $state<number | null>(null);
	let importPhase = $state<'preparing' | 'uploading' | 'publishing' | null>(null);
	let importFileSize = $state(0);
	let activating = $state(false);
	let activationNeeded = $state(false);
	let staticSource = $state('');
	let staticTarget = $state('');
	let staticCandidates = $state<StaticCandidate[]>([]);
	let staticBlocks = $state<string[]>([]);
	let analyzingStatic = $state(false);
	let creatingStatic = $state(false);
	let savingUploadLimit = $state(false);
	let uploadLimitMiB = $state(20);
	let savedUploadLimitMiB = $state(20);
	let placing = $state(false);
	let erasing = $state(false);
	let toolMode = $state<'place' | 'erase'>('place');
	let source = $state('mystructure:');
	let target = $state('');
	let selected = $state('');
	let x = $state('');
	let y = $state('');
	let z = $state('');
	let rotation = $state('0_degrees');
	let mirror = $state('none');
	let placementMode = $state<'instant' | 'layers'>('instant');
	let includeBlocks = $state(true);
	let includeAir = $state(true);
	let protectBlocks = $state(false);
	let protectPlace = $state(false);
	let protectEnvironment = $state(false);
	let anchor = $state<StructureAnchor>('center');
	let pendingPlacement = $state<PendingPlacement | null>(null);
	let eraseWidth = $state('');
	let eraseHeight = $state('');
	let eraseDepth = $state('');
	let pendingErase = $state<PendingErase | null>(null);
	let fileInput = $state<HTMLInputElement | undefined>(undefined);
	let selectedFiles = $state<FileList | undefined>(undefined);
	let activeImport: XMLHttpRequest | null = null;
	let activeMultipartSession = '';
	let environment = $state<'staging' | 'production'>('staging');
	let libraryExpanded = $state(false);
	let libraryQuery = $state('');
	const filteredStructures = $derived(
		structures.filter((structure) =>
			structure.name.toLowerCase().includes(libraryQuery.trim().toLowerCase())
		)
	);

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

	function formatDimensions(dimensions: Structure['dimensions']) {
		return dimensions
			? `${dimensions.x} × ${dimensions.y} × ${dimensions.z} bloques`
			: 'Dimensiones no disponibles';
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const response = await fetch('/api/structures');
			const body = (await response.json().catch(() => ({}))) as {
				structures?: Structure[];
				maxBytes?: number;
				error?: string;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo leer la biblioteca.');
			structures = body.structures ?? [];
			if (typeof body.maxBytes === 'number') {
				uploadLimitMiB = Math.round(body.maxBytes / 1024 / 1024);
				savedUploadLimitMiB = uploadLimitMiB;
			}
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
		if (!file.size || file.size > savedUploadLimitMiB * 1024 * 1024) {
			toast.error(`La estructura debe medir entre 1 byte y ${savedUploadLimitMiB} MiB.`);
			return;
		}
		importing = true;
		importProgress = 0;
		importPhase = 'preparing';
		importFileSize = file.size;
		try {
			const prepared = await requestJson('/api/structures/multipart', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: target, size: file.size })
			});
			const setup = prepared.body as {
				sessionId?: string;
				partBytes?: number;
				parts?: number;
				error?: string;
			};
			if (!prepared.ok || !setup.sessionId || !setup.partBytes || !setup.parts)
				throw new Error(uploadError(prepared.status, setup.error));
			activeMultipartSession = setup.sessionId;
			importPhase = 'uploading';
			const parts: Array<{ partNumber: number; etag: string }> = [];
			for (let index = 0; index < setup.parts; index += 1) {
				const start = index * setup.partBytes;
				const chunk = file.slice(start, Math.min(start + setup.partBytes, file.size));
				const uploaded = await uploadPart(setup.sessionId, index + 1, chunk, start, file.size);
				const result = uploaded.body as { etag?: string; error?: string };
				if (!uploaded.ok || !result.etag)
					throw new Error(uploadError(uploaded.status, result.error));
				parts.push({ partNumber: index + 1, etag: result.etag });
			}
			importProgress = 100;
			importPhase = 'publishing';
			const response = await requestJson(`/api/structures/multipart/${setup.sessionId}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ parts })
			});
			const body = response.body as {
				error?: string;
				name?: string;
				deployment?: string;
			};
			if (!response.ok) throw new Error(uploadError(response.status, body.error));
			toast.success(`Archivo ${body.name} publicado`, { description: body.deployment });
			activationNeeded = true;
			if (fileInput) fileInput.value = '';
			selectedFiles = new DataTransfer().files;
			await load();
		} catch (reason) {
			toast.error('No se pudo importar el archivo', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			importing = false;
			importProgress = null;
			importPhase = null;
			importFileSize = 0;
			activeImport = null;
			activeMultipartSession = '';
		}
	}

	function cancelImport() {
		const sessionId = activeMultipartSession;
		activeImport?.abort();
		if (sessionId) void fetch(`/api/structures/multipart/${sessionId}`, { method: 'DELETE' });
	}

	function uploadError(status: number, message?: string) {
		if (message) return message;
		return status
			? `La carga fue rechazada por el servidor (HTTP ${status}).`
			: 'No se recibió respuesta del servidor.';
	}

	async function requestJson(url: string, options: RequestInit) {
		const response = await fetch(url, options);
		const body = await response.json().catch(() => ({}));
		return { ok: response.ok, status: response.status, body };
	}

	function uploadPart(
		sessionId: string,
		partNumber: number,
		chunk: Blob,
		offset: number,
		total: number
	) {
		return new Promise<{ ok: boolean; status: number; body: unknown }>((resolve, reject) => {
			const upload = new XMLHttpRequest();
			activeImport = upload;
			upload.open('PUT', `/api/structures/multipart/${sessionId}/part/${partNumber}`);
			upload.setRequestHeader('content-type', 'application/octet-stream');
			upload.setRequestHeader('x-spb-part-size', String(chunk.size));
			upload.upload.onprogress = (event) => {
				if (!event.lengthComputable) return;
				importProgress = Math.min(100, Math.round(((offset + event.loaded) / total) * 100));
			};
			upload.onerror = () => reject(new Error('La conexión se interrumpió durante la carga.'));
			upload.onabort = () => reject(new Error('La carga fue cancelada.'));
			upload.onload = () => {
				let body: unknown = {};
				try {
					body = JSON.parse(upload.responseText);
				} catch {
					// uploadError adds the HTTP status when a proxy does not return JSON.
				}
				resolve({ ok: upload.status >= 200 && upload.status < 300, status: upload.status, body });
			};
			upload.send(chunk);
		});
	}

	async function activateStagingStructures() {
		if (activating) return;
		activating = true;
		try {
			const response = await fetch('/api/structures/activate', { method: 'POST' });
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				structures?: number;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo activar la biblioteca.');
			activationNeeded = false;
			toast.success('Activación de Staging iniciada', {
				description: `${body.structures ?? 0} estructura(s) se sincronizaron. Staging se reiniciará brevemente para leerlas.`
			});
		} catch (reason) {
			toast.error('No se pudieron activar las estructuras', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			activating = false;
		}
	}

	async function analyzeStaticVariant() {
		if (!staticSource || analyzingStatic) return;
		analyzingStatic = true;
		try {
			const response = await fetch(
				`/api/structures/static-variant?source=${encodeURIComponent(staticSource)}`
			);
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				candidates?: StaticCandidate[];
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo analizar la estructura.');
			staticCandidates = body.candidates ?? [];
			staticBlocks = staticCandidates.map((candidate) => candidate.id);
			if (!staticTarget) staticTarget = `${staticSource}_static`;
			if (!staticCandidates.length)
				toast.message('No se detectaron bloques con gravedad que tengan una variante estática.');
		} catch (reason) {
			toast.error('No se pudo analizar la estructura', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			analyzingStatic = false;
		}
	}

	function toggleStaticBlock(id: string, checked: boolean) {
		staticBlocks = checked
			? [...new Set([...staticBlocks, id])]
			: staticBlocks.filter((current) => current !== id);
	}

	async function createStaticVariant() {
		if (creatingStatic || !staticSource || !staticTarget || !staticBlocks.length) return;
		creatingStatic = true;
		try {
			const response = await fetch('/api/structures/static-variant', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ source: staticSource, target: staticTarget, blocks: staticBlocks })
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				name?: string;
				replacements?: number;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo crear la variante.');
			toast.success(`Variante ${body.name} creada`, {
				description: `${body.replacements ?? 0} referencias se cambiaron. El original sigue intacto.`
			});
			selected = body.name ?? selected;
			activationNeeded = true;
			await load();
		} catch (reason) {
			toast.error('No se pudo crear la variante estática', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			creatingStatic = false;
		}
	}

	async function saveUploadLimit() {
		if (savingUploadLimit || uploadLimitMiB === savedUploadLimitMiB) return;
		savingUploadLimit = true;
		try {
			const response = await fetch('/api/structures/upload-limit', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ mebibytes: uploadLimitMiB })
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				maxBytes?: number;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo guardar el límite.');
			savedUploadLimitMiB = Math.round((body.maxBytes ?? 0) / 1024 / 1024);
			uploadLimitMiB = savedUploadLimitMiB;
			toast.success('Límite de importación actualizado', {
				description: `Ahora permite archivos de hasta ${savedUploadLimitMiB} MiB.`
			});
		} catch (reason) {
			toast.error('No se pudo guardar el límite', {
				description: reason instanceof Error ? reason.message : undefined
			});
			uploadLimitMiB = savedUploadLimitMiB;
		} finally {
			savingUploadLimit = false;
		}
	}

	function selectedDimensions() {
		return structures.find((structure) => structure.name === selected)?.dimensions ?? null;
	}

	function requestedPosition() {
		if (!x || !y || !z) return null;
		const position = { x: Number(x), y: Number(y), z: Number(z) };
		return Object.values(position).every(Number.isInteger) ? position : null;
	}

	function placementOrigin() {
		const position = requestedPosition();
		const dimensions = selectedDimensions();
		if (!position || !dimensions) return null;
		return resolveStructureOrigin(
			position,
			dimensions,
			rotation as StructureRotation,
			mirror as StructureMirror,
			anchor
		);
	}

	function placementRequest() {
		const position = requestedPosition();
		const origin = placementOrigin();
		if (!selected || !position || !origin) return null;
		return {
			name: selected,
			...position,
			rotation,
			mirror,
			mode: placementMode,
			includeBlocks,
			includeAir,
			protectBlocks,
			protectPlace,
			protectEnvironment,
			anchor,
			origin
		};
	}

	function preparePlacement() {
		const request = placementRequest();
		if (!request) {
			toast.error('Completa una estructura y coordenadas enteras antes de continuar.');
			return;
		}
		pendingPlacement = request;
	}

	async function place() {
		const request = pendingPlacement;
		if (placing || !request) return;
		placing = true;
		try {
			const response = await fetch('/api/structures/place', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...request,
					confirmed: true
				})
			});
			const body = (await response.json().catch(() => ({}))) as {
				error?: string;
				environment?: string;
				confirmed?: boolean;
			};
			if (!response.ok) throw new Error(body.error ?? 'No se pudo colocar.');
			if (body.confirmed) {
				toast.success('Estructura colocada correctamente', {
					description:
						request.mode === 'layers'
							? `Bedrock terminó la colocación capa por capa y retiró el área temporal de ${body.environment === 'production' ? 'producción' : 'staging'}.`
							: `Bedrock confirmó la carga y retiró el área temporal de ${body.environment === 'production' ? 'producción' : 'staging'}.`
				});
			} else {
				toast.success('Comando de colocación enviado', {
					description:
						'Producción aún no tiene el flujo de carga temporal; confirma el resultado en la terminal.'
				});
			}
			pendingPlacement = null;
		} catch (reason) {
			toast.error('No se pudo colocar la estructura', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			placing = false;
		}
	}

	function eraseRequest() {
		const position = requestedPosition();
		const dimensions = {
			width: Number(eraseWidth),
			height: Number(eraseHeight),
			depth: Number(eraseDepth)
		};
		if (
			!position ||
			!Object.values(dimensions).every((value) => Number.isInteger(value) && value > 0 && value <= 512) ||
			dimensions.width * dimensions.height * dimensions.depth > 8_000_000
		)
			return null;
		return { ...position, ...dimensions };
	}

	function prepareErase() {
		const request = eraseRequest();
		if (!request) {
			toast.error('Completa coordenadas y dimensiones válidas antes de continuar.', {
				description: 'Cada dimensión admite de 1 a 512 bloques y el volumen máximo es 8,000,000.'
			});
			return;
		}
		pendingErase = request;
	}

	async function eraseArea() {
		const request = pendingErase;
		if (erasing || !request) return;
		erasing = true;
		try {
			const response = await fetch('/api/structures/erase', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...request, confirmed: true })
			});
			const body = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) throw new Error(body.error ?? 'No se pudo borrar el área.');
			toast.success('Área borrada correctamente', {
				description: `${request.width} × ${request.height} × ${request.depth} bloques desde ${request.x}, ${request.y}, ${request.z}.`
			});
			pendingErase = null;
		} catch (reason) {
			toast.error('No se pudo borrar el área', {
				description: reason instanceof Error ? reason.message : undefined
			});
		} finally {
			erasing = false;
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
				Las estructuras nuevas se guardan de forma privada en R2. Las entradas heredadas de
				<code>BP/structures/spb</code> siguen disponibles mientras se migra la biblioteca. Colocarlas
				en un mundo es una acción distinta y confirmada.
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
						>Guarda el binario privado en R2; el archivo no modifica ningún mundo hasta colocarlo.</Card.Description
					></Card.Header
				><Card.Content class="grid gap-4"
					><div class="grid gap-3 rounded-md border p-3">
						<div class="flex items-baseline justify-between gap-3">
							<Label for="upload-limit">Límite de importación</Label><span
								class="text-sm font-medium tabular-nums">{uploadLimitMiB} MiB</span
							>
						</div>
						<Slider
							id="upload-limit"
							type="single"
							min={1}
							max={150}
							step={1}
							bind:value={uploadLimitMiB}
						/>
						<div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
							<span>1 MiB</span><span>150 MiB</span>
						</div>
						<Button
							size="sm"
							variant="outline"
							onclick={() => void saveUploadLimit()}
							disabled={savingUploadLimit || uploadLimitMiB === savedUploadLimitMiB}
							>{#if savingUploadLimit}<LoaderCircle class="animate-spin" /> Guardando…{:else}Guardar
								límite{/if}</Button
						>
					</div>
					<div class="grid gap-2">
						<Label for="file">Archivo .mcstructure</Label><Input
							id="file"
							bind:this={fileInput}
							bind:files={selectedFiles}
							type="file"
							accept=".mcstructure,application/octet-stream"
						/>
					</div>
					{#if importing && importProgress !== null}<div class="grid gap-2 rounded-md border p-3">
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="font-medium"
									>{importPhase === 'preparing'
										? 'Preparando carga segura'
										: importPhase === 'uploading'
											? 'Subiendo archivo por partes'
											: 'Verificando y publicando en R2'}</span
								>
								<span class="tabular-nums">{importProgress}%</span>
							</div>
							<div
								class="h-2 overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-label="Progreso de carga"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={importProgress}
							>
								<div
									class="h-full bg-primary transition-[width]"
									style={`width: ${importProgress}%`}
								></div>
							</div>
							<p class="text-xs text-muted-foreground">
								{importPhase === 'preparing'
									? 'Creando una sesión temporal para enviar el archivo de forma segura.'
									: importPhase === 'uploading'
										? `${formatSize(Math.round((importFileSize * importProgress) / 100))} de ${formatSize(importFileSize)} enviados.`
										: 'El archivo llegó al servidor; se está validando y guardando antes de aparecer en la biblioteca.'}
							</p>
							<Button size="sm" variant="outline" onclick={cancelImport}>Cancelar carga</Button>
						</div>{/if}
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
						disabled={importing ||
							savingUploadLimit ||
							uploadLimitMiB !== savedUploadLimitMiB ||
							!target.trim() ||
							!selectedFiles?.length}
						>{#if importing}<LoaderCircle class="animate-spin" /> Publicando…{:else}<FileUp /> Importar
							y publicar{/if}</Button
					></Card.Footer
				></Card.Root
			>
		</section>
		{#if environment === 'staging' && activationNeeded}<Alert.Root>
				<PackagePlus />
				<Alert.Title>Activa las estructuras en Staging</Alert.Title>
				<Alert.Description class="flex flex-wrap items-center justify-between gap-3">
					<span
						>Bedrock sólo descubre archivos nuevos del behavior pack al arrancar. Esto sincroniza la
						biblioteca R2 y reinicia únicamente Staging.</span
					>
					<Button
						size="sm"
						variant="outline"
						onclick={() => void activateStagingStructures()}
						disabled={activating}
					>
						{#if activating}<LoaderCircle class="animate-spin" /> Activando…{:else}<PackagePlus /> Activar
							en Staging{/if}
					</Button>
				</Alert.Description>
			</Alert.Root>{/if}
		{#if environment === 'staging'}<Card.Root class="border-amber-500/30"
				><Card.Header
					><Card.Title>Crear variante sin gravedad</Card.Title><Card.Description
						>Analiza una estructura de la biblioteca y crea una copia. Los bloques que selecciones
						se reemplazan por sus equivalentes SPB estáticos; el archivo original nunca se modifica.</Card.Description
					></Card.Header
				><Card.Content class="grid gap-4"
					><div class="grid gap-2">
						<Label for="static-source">Estructura original</Label><select
							id="static-source"
							class="h-9 rounded-md border bg-background px-3 text-sm"
							bind:value={staticSource}
							onchange={() => {
								staticCandidates = [];
								staticBlocks = [];
								staticTarget = staticSource ? `${staticSource}_static` : '';
							}}
							><option value="">Selecciona una estructura</option
							>{#each structures as structure}<option value={structure.name}
									>spb:{structure.name}</option
								>{/each}</select
						>
					</div>
					<div class="flex flex-wrap gap-2">
						<Button
							variant="outline"
							onclick={() => void analyzeStaticVariant()}
							disabled={!staticSource || analyzingStatic}
							>{#if analyzingStatic}<LoaderCircle class="animate-spin" /> Analizando…{:else}Analizar
								bloques con gravedad{/if}</Button
						>
					</div>
					{#if staticCandidates.length}<div class="grid gap-3 rounded-md border p-4">
							<div class="grid gap-2">
								<Label for="static-target">Nombre de la variante</Label><Input
									id="static-target"
									bind:value={staticTarget}
									placeholder="finn_static"
								/>
							</div>
							<p class="text-sm text-muted-foreground">
								Selecciona los bloques que deben permanecer fijos en la copia.
							</p>
							<div class="grid gap-2 sm:grid-cols-2">
								{#each staticCandidates as candidate}<label
										class="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
									>
										<input
											type="checkbox"
											checked={staticBlocks.includes(candidate.id)}
											onchange={(event) =>
												toggleStaticBlock(
													candidate.id,
													(event.currentTarget as HTMLInputElement).checked
												)}
										/>
										<span
											><strong>{candidate.label}</strong><br /><code
												class="text-xs text-muted-foreground"
												>{candidate.id} → {candidate.replacement}</code
											></span
										>
									</label>{/each}
							</div>
							<Button
								onclick={() => void createStaticVariant()}
								disabled={creatingStatic || !staticTarget.trim() || !staticBlocks.length}
								>{#if creatingStatic}<LoaderCircle class="animate-spin" /> Creando copia…{:else}<PackagePlus
									/> Crear variante estática{/if}</Button
							>
						</div>{/if}</Card.Content
				></Card.Root
			>{/if}
		<Card.Root
			><Card.Header class="flex-row items-center justify-between gap-4"
				><div><Card.Title>Biblioteca versionada</Card.Title><Card.Description
					>{loading
						? 'Consultando la biblioteca…'
						: `${structures.length} estructura${structures.length === 1 ? '' : 's'} disponible${structures.length === 1 ? '' : 's'}.`}</Card.Description
				></div><Button size="sm" variant="outline" onclick={() => (libraryExpanded = !libraryExpanded)}
					>{libraryExpanded ? 'Ocultar biblioteca' : 'Ver biblioteca'}</Button
				></Card.Header
			>{#if libraryExpanded}<Card.Content class="grid gap-3"
				><Input bind:value={libraryQuery} placeholder="Buscar estructura…" aria-label="Buscar en la biblioteca" />
				{#if filteredStructures.length}<div class="max-h-[28rem] divide-y overflow-y-auto rounded-md border">
						{#each filteredStructures as structure}<div class="flex flex-wrap items-center gap-3 px-4 py-3">
								<div class="min-w-0 flex-1">
									<code class="block truncate">spb:{structure.name}</code>
									<span class="text-sm text-muted-foreground"
										>{formatDimensions(structure.dimensions)}</span
									>
									{#if structure.source === 'r2'}<span class="text-xs text-muted-foreground"
											>R2 privado</span
										>{/if}
								</div>
								<span class="text-sm text-muted-foreground">{formatSize(structure.size)}</span
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
						{structures.length ? 'No hay estructuras que coincidan con la búsqueda.' : 'Todavía no hay estructuras publicadas.'}
					</div>{/if}</Card.Content
			>{/if}</Card.Root
		>
		<div class="flex w-fit gap-1 rounded-md border bg-muted/30 p-1">
			<Button
				size="sm"
				variant={toolMode === 'place' ? 'default' : 'ghost'}
				onclick={() => {
					toolMode = 'place';
					pendingErase = null;
				}}>Colocar</Button
			>
			<Button
				size="sm"
				variant={toolMode === 'erase' ? 'destructive' : 'ghost'}
				disabled={environment === 'production'}
				onclick={() => {
					toolMode = 'erase';
					pendingPlacement = null;
				}}>Borrador</Button
			>
		</div>
		{#if environment === 'production'}<p class="-mt-4 text-sm text-muted-foreground">
			El borrador y las protecciones nuevas se habilitarán en producción después de validarlas en Staging.
		</p>{/if}
		{#if toolMode === 'place'}<Card.Root class="border-amber-500/30"
			><Card.Header
				><Card.Title
					>Colocar en {environment === 'production' ? 'producción' : 'staging'}</Card.Title
				><Card.Description
					>Esto modifica el mundo seleccionado. El dashboard cubre temporalmente toda la huella y
					espera la confirmación real de Bedrock. Antes de colocar en una zona remota, llega o
					teletranspórtate allí con un jugador para que Bedrock pueda cargarla.</Card.Description
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
				<div class="grid gap-2 md:col-span-3">
					<Label for="anchor">Anclar coordenada en</Label><select
						id="anchor"
						class="h-9 rounded-md border bg-background px-3 text-sm"
						bind:value={anchor}
						><option value="center">Centro horizontal (recomendado)</option><option value="origin"
							>Origen/esquina nativa de Minecraft</option
						></select
					>{#if anchor === 'center'}<p class="text-sm text-muted-foreground">
							La X y Z indican el centro de la construcción. La Y sigue siendo su base.
						</p>{:else}<p class="text-sm text-muted-foreground">
							La X, Y y Z son el origen nativo: una esquina inferior de la estructura.
						</p>{/if}
					{#if placementOrigin() && anchor === 'center'}<p class="text-sm text-muted-foreground">
							Bedrock la colocará desde el origen calculado <code
								>{placementOrigin()!.x} {placementOrigin()!.y} {placementOrigin()!.z}</code
							>, respetando el giro y el espejo.
						</p>{/if}
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
					<Label for="placement-mode">Forma de colocación</Label><select
						id="placement-mode"
						class="h-9 rounded-md border bg-background px-3 text-sm"
						bind:value={placementMode}
						><option value="instant">Instantánea</option><option value="layers"
							>Capa por capa (12 segundos)</option
						></select
					>
					{#if placementMode === 'layers'}<p class="text-sm text-muted-foreground">
							Bedrock construye desde la base hacia arriba; es la opción indicada para arena, grava
							u otros bloques afectados por gravedad.
						</p>{:else}<p class="text-sm text-muted-foreground">
							Bedrock coloca todos los bloques inmediatamente. En estructuras grandes el cliente
							puede tardar un momento adicional en dibujar los chunks.
						</p>{/if}
				</div>
				<div class="flex items-center justify-between gap-4 rounded-md border p-4 md:col-span-3">
					<div class="grid gap-1">
						<Label for="include-blocks">Colocar bloques</Label>
						<p class="text-sm text-muted-foreground">
							{includeBlocks
								? 'Sí. Se cargarán los bloques guardados en la estructura.'
								: 'No. Sólo se cargarán las entidades guardadas; el terreno permanecerá intacto.'}
						</p>
					</div>
					<Switch id="include-blocks" bind:checked={includeBlocks} aria-label="Colocar bloques" />
				</div>
				<div class="flex items-center justify-between gap-4 rounded-md border p-4 md:col-span-3">
					<div class="grid gap-1">
						<Label for="include-air">Incluir aire</Label>
						<p class="text-sm text-muted-foreground">
							{includeBlocks
								? includeAir
									? 'Los huecos de la estructura reemplazan los bloques existentes.'
									: 'Los huecos se conservan: sólo se colocan los bloques reales de la estructura.'
								: 'No aplica porque esta carga no colocará bloques.'}
						</p>
					</div>
					<Switch
						id="include-air"
						bind:checked={includeAir}
						disabled={!includeBlocks}
						aria-label="Incluir aire"
					/>
				</div>
				<div class="flex items-center justify-between gap-4 rounded-md border p-4 md:col-span-3">
					<div class="grid gap-1">
						<Label for="protect-blocks">Bloques se rompen</Label>
						<p class="text-sm text-muted-foreground">
							{includeBlocks && protectBlocks
								? 'No. SPB protegerá toda la huella contra minería de jugadores.'
								: 'Sí. Esta colocación no tendrá protección de bloques.'}
						</p>
					</div>
					<Switch
						id="protect-blocks"
						checked={includeBlocks && !protectBlocks}
						onCheckedChange={(checked) => (protectBlocks = !checked)}
						disabled={!includeBlocks}
						aria-label="Bloques se rompen"
					/>
				</div>
				<div class="flex items-center justify-between gap-4 rounded-md border p-4 md:col-span-3">
					<div class="grid gap-1">
						<Label for="allow-place-blocks">Jugadores pueden colocar bloques</Label>
						<p class="text-sm text-muted-foreground">
							{includeBlocks && protectPlace
								? 'No. SPB bloqueará la colocación dentro de toda la región.'
								: 'Sí. Los jugadores podrán colocar bloques normalmente.'}
						</p>
					</div>
					<Switch
						id="allow-place-blocks"
						checked={includeBlocks && !protectPlace}
						onCheckedChange={(checked) => (protectPlace = !checked)}
						disabled={!includeBlocks || environment === 'production'}
						aria-label="Jugadores pueden colocar bloques"
					/>
				</div>
				<div class="flex items-center justify-between gap-4 rounded-md border p-4 md:col-span-3">
					<div class="grid gap-1">
						<Label for="allow-environment-damage">Fuego, fluidos y explosiones afectan la región</Label>
						<p class="text-sm text-muted-foreground">
							{includeBlocks && protectEnvironment
								? 'No. Se bloquearán ignición, cubetas y destrucción por explosiones dentro de la región.'
								: 'Sí. La región conservará el comportamiento normal del mundo.'}
						</p>
					</div>
					<Switch
						id="allow-environment-damage"
						checked={includeBlocks && !protectEnvironment}
						onCheckedChange={(checked) => (protectEnvironment = !checked)}
						disabled={!includeBlocks || environment === 'production'}
						aria-label="Fuego, fluidos y explosiones afectan la región"
					/>
				</div>
				{#if pendingPlacement}<div
						class="grid gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4 md:col-span-3"
					>
						<div class="space-y-1">
							<p class="font-medium">Confirmar colocación</p>
							<p class="text-sm text-muted-foreground">
								<strong>spb:{pendingPlacement.name}</strong> se colocará en {pendingPlacement.x}, {pendingPlacement.y},
								{pendingPlacement.z}
								({pendingPlacement.anchor === 'center' ? 'centro' : 'origen'}; origen real {pendingPlacement
									.origin.x}, {pendingPlacement.origin.y}, {pendingPlacement.origin.z}). Modo: {pendingPlacement.mode ===
								'layers'
									? 'capa por capa durante 12 segundos'
									: 'instantáneo'}.
								{pendingPlacement.includeBlocks
									? pendingPlacement.includeAir
										? ' Los huecos sí reemplazarán el terreno existente.'
										: ' Los huecos conservarán el terreno existente.'
									: ' Esta carga no modificará bloques.'}
								{pendingPlacement.includeBlocks && pendingPlacement.protectBlocks
									? ' Los bloques de esta colocación quedarán protegidos.'
									: ' Sus bloques podrán romperse normalmente.'}
								{pendingPlacement.includeBlocks && pendingPlacement.protectPlace
									? ' No se permitirá colocar bloques dentro de la región.'
									: ' Se permitirá colocar bloques normalmente.'}
								{pendingPlacement.includeBlocks && pendingPlacement.protectEnvironment
									? ' La región quedará protegida contra ignición, fluidos y explosiones.'
									: ' Fuego, fluidos y explosiones conservarán su comportamiento normal.'}
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<Button variant="outline" onclick={() => (pendingPlacement = null)} disabled={placing}
								>Cancelar</Button
							>
							<Button variant="destructive" onclick={() => void place()} disabled={placing}
								>{#if placing}<LoaderCircle class="animate-spin" />
									{pendingPlacement.mode === 'layers'
										? 'Construyendo capa por capa…'
										: 'Colocando…'}{:else}<MapPinned /> Confirmar y colocar{/if}</Button
							>
						</div>
					</div>{/if}</Card.Content
			><Card.Footer
				><Button
					variant="destructive"
					onclick={preparePlacement}
					disabled={placing || !!pendingPlacement || !placementRequest()}
					><MapPinned /> Revisar colocación</Button
				></Card.Footer
			></Card.Root
		>{:else}<Card.Root class="border-destructive/40"
			><Card.Header
				><Card.Title>Borrar un área en Staging</Card.Title><Card.Description
					>Convierte toda el área en aire y elimina las protecciones de estructuras que la
					intersecten. X, Y y Z son la esquina mínima del volumen.</Card.Description
				></Card.Header
			><Card.Content class="grid gap-4 md:grid-cols-3"
				><div class="grid gap-2">
					<Label for="erase-x">X inicial</Label><Input id="erase-x" bind:value={x} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="erase-y">Y inicial</Label><Input id="erase-y" bind:value={y} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="erase-z">Z inicial</Label><Input id="erase-z" bind:value={z} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="erase-width">Ancho (X)</Label><Input id="erase-width" bind:value={eraseWidth} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="erase-height">Alto (Y)</Label><Input id="erase-height" bind:value={eraseHeight} inputmode="numeric" />
				</div>
				<div class="grid gap-2">
					<Label for="erase-depth">Profundidad (Z)</Label><Input id="erase-depth" bind:value={eraseDepth} inputmode="numeric" />
				</div>
				<p class="text-sm text-muted-foreground md:col-span-3">
					Máximo: 512 bloques por eje y 8,000,000 de bloques por operación. SPB cargará
					temporalmente la huella completa antes de borrar.
				</p>
				{#if pendingErase}<div
						class="grid gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4 md:col-span-3"
					>
						<div class="space-y-1">
							<p class="font-medium">Confirmar borrado irreversible</p>
							<p class="text-sm text-muted-foreground">
								Se reemplazarán por aire <strong>{pendingErase.width} × {pendingErase.height} × {pendingErase.depth}</strong>
								bloques desde <strong>{pendingErase.x}, {pendingErase.y}, {pendingErase.z}</strong>.
							</p>
						</div>
						<div class="flex flex-wrap gap-2">
							<Button variant="outline" onclick={() => (pendingErase = null)} disabled={erasing}>Cancelar</Button>
							<Button variant="destructive" onclick={() => void eraseArea()} disabled={erasing}
								>{#if erasing}<LoaderCircle class="animate-spin" /> Borrando área…{:else}Confirmar y borrar{/if}</Button
							>
						</div>
					</div>{/if}</Card.Content
			><Card.Footer
				><Button
					variant="destructive"
					onclick={prepareErase}
					disabled={erasing || !!pendingErase || !eraseRequest()}>Revisar borrado</Button
				></Card.Footer
			></Card.Root
		>{/if}
	</div>
</main>
