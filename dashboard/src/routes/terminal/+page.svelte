<script lang="ts">
	import { onMount } from 'svelte';
	import Activity from '@lucide/svelte/icons/activity';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Send from '@lucide/svelte/icons/send';
	import Terminal from '@lucide/svelte/icons/terminal';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as ScrollArea from '#lib/components/ui/scroll-area/index.js';

	type ConsoleLine = { id: number; at: string; text: string };

	let authenticated = $state(false);
	let loading = $state(true);
	let password = $state('');
	let command = $state('');
	let error = $state('');
	let sending = $state(false);
	let logs = $state<ConsoleLine[]>([]);
	let bedrockRunning = $state(false);
	let localDevelopment = $state(false);
	let environment = $state<'staging' | 'production'>('staging');

	function isLocalPreview() {
		return import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('preview');
	}

	async function api(path: string, options: RequestInit = {}) {
		const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
		const body = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(body.error || 'No se pudo completar la solicitud.');
		return body;
	}

	async function refresh() {
		try {
			const response = await fetch('/api/commands', { headers: { 'content-type': 'application/json' } });
			const body = await response.json().catch(() => ({}));
			if (response.status === 401) {
				authenticated = false;
				return;
			}
			if (!response.ok) {
				authenticated = true;
				error = body.error || `La sesión está activa, pero ${environment} no respondió.`;
				return;
			}
			logs = body.logs.lines;
			environment = body.environment === 'production' ? 'production' : 'staging';
			bedrockRunning = body.health.bedrockRunning === true;
			localDevelopment = body.health.localDevelopment === true;
			authenticated = true;
			error = '';
		} catch (reason) {
			authenticated = true;
			error = reason instanceof Error ? reason.message : `La sesión está activa, pero no se pudo contactar ${environment}.`;
		} finally {
			loading = false;
		}
	}

	async function signIn() {
		error = '';
		try {
			await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
			password = '';
			authenticated = true;
			await refresh();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.';
		}
	}

	async function submit() {
		if (!command.trim() || sending) return;
		if (isLocalPreview()) {
			logs = [...logs, { id: Date.now(), at: new Date().toISOString(), text: `> ${command}` }];
			command = '';
			return;
		}
		sending = true;
		error = '';
		try {
			await api('/api/commands', { method: 'POST', body: JSON.stringify({ command }) });
			command = '';
			await refresh();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo enviar el comando.';
		} finally {
			sending = false;
		}
	}

	onMount(() => {
		if (isLocalPreview()) {
			authenticated = true;
			bedrockRunning = true;
			localDevelopment = true;
			logs = [
				{ id: 1, at: new Date().toISOString(), text: '[Server] Local UI preview ready.' },
				{ id: 2, at: new Date().toISOString(), text: '[Server] No connection to staging was made.' }
			];
			loading = false;
			return;
		}
		void refresh();
		const refreshWhenVisible = () => { if (authenticated && !document.hidden) void refresh(); };
		document.addEventListener('visibilitychange', refreshWhenVisible);
		const timer = window.setInterval(refreshWhenVisible, 2500);
		return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshWhenVisible); };
	});
</script>

{#if loading}
	<main class="dark grid min-h-svh place-items-center bg-background p-6 text-foreground">
		<div class="flex items-center gap-3 text-sm text-muted-foreground"><Activity class="size-4 animate-pulse" /> Abriendo consola privada…</div>
	</main>
{:else if !authenticated}
	<main class="dark grid min-h-svh place-items-center bg-background p-6 text-foreground">
		<Card.Root class="w-full max-w-md shadow-xl">
			<Card.Header class="space-y-3">
				<div class="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Terminal class="size-5" /></div>
				<div class="space-y-1"><Card.Title>Consola de SPB</Card.Title><Card.Description>Staging permite comandos; Producción se muestra sólo en lectura.</Card.Description></div>
			</Card.Header>
			<Card.Content>
				<form class="grid gap-4" onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
					<div class="grid gap-2"><Label for="password">Contraseña</Label><Input id="password" bind:value={password} type="password" autocomplete="current-password" /></div>
					<Button type="submit" class="w-full">Entrar a consola</Button>
				</form>
				{#if error}<Alert.Root variant="destructive" class="mt-4"><Alert.Title>No se pudo iniciar sesión</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
			</Card.Content>
		</Card.Root>
	</main>
{:else}
	<main class="dark flex h-svh flex-col overflow-hidden bg-background text-foreground">
		<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4">
			<div class="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><Terminal class="size-4" /></div>
			<div class="min-w-0"><p class="truncate text-sm font-medium">Terminal de {environment === 'production' ? 'producción' : 'staging'}</p><p class="text-xs text-muted-foreground">{localDevelopment ? 'Vista local simulada' : environment === 'production' ? 'Observador de solo lectura' : 'Salida real de Bedrock'} · {logs.length} líneas</p></div>
			<div class="ml-auto mr-36 flex shrink-0 items-center gap-2 sm:mr-44"><Badge variant={localDevelopment ? 'outline' : bedrockRunning ? 'default' : 'destructive'}>{localDevelopment ? 'Vista local' : bedrockRunning ? 'En línea' : 'Sin conexión'}</Badge><Button variant="outline" size="sm" href="/"><ArrowLeft /> <span class="hidden sm:inline">Panel</span></Button></div>
		</header>

		<section class="min-h-0 flex-1 overflow-hidden" aria-label="Salida del servidor">
			<ScrollArea.Root class="h-full bg-black/30 p-4 font-mono text-xs">
				{#if logs.length === 0}
					<div class="grid h-full place-items-center text-center text-sm font-sans text-muted-foreground">Aún no hay salida disponible del servidor.</div>
				{:else}
					<div class="grid gap-1" aria-live="polite">{#each logs as line (line.id)}<div class="grid grid-cols-[auto_1fr] gap-3 break-words"><time class="text-muted-foreground">{new Date(line.at).toLocaleTimeString()}</time><code class="whitespace-pre-wrap text-foreground/90">{line.text}</code></div>{/each}</div>
				{/if}
			</ScrollArea.Root>
		</section>

		<form class="shrink-0 border-t bg-card p-3 sm:p-4" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
			{#if error}<Alert.Root variant="destructive" class="mb-3"><Alert.Title>{environment === 'production' ? 'Producción no está disponible' : 'Staging no está disponible'}</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
			{#if environment === 'production'}
				<p class="text-sm text-muted-foreground">Producción está en modo de solo lectura. Sus comandos, reinicios y despliegues no se pueden ejecutar desde aquí.</p>
			{:else}
				<div class="flex items-center gap-2"><span class="font-mono text-sm text-muted-foreground">›</span><Label class="sr-only" for="command">Comando de Minecraft</Label><Input id="command" bind:value={command} class="font-mono" placeholder="say Hola desde la consola" autocomplete="off" /><Button type="submit" disabled={sending} class="min-w-11 sm:min-w-28"><Send /> <span class="hidden sm:inline">{sending ? 'Enviando…' : 'Enviar'}</span></Button></div>
				<p class="mt-2 text-xs text-muted-foreground">Staging solamente · no ejecuta comandos de Linux ni afecta producción.</p>
			{/if}
		</form>
	</main>
{/if}
