<script lang="ts">
	import { onMount } from 'svelte';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';

	let password = $state('');
	let error = $state('');
	let checking = $state(true);
	let submitting = $state(false);
	let returnTo = $state('/');

	function requestedReturnTo() {
		const candidate = new URLSearchParams(window.location.search).get('returnTo') ?? '/';
		return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/';
	}

	async function signIn() {
		if (submitting) return;
		submitting = true;
		error = '';
		try {
			const response = await fetch('/api/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error || 'No se pudo iniciar sesión.');
			password = '';
			location.replace(returnTo);
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.';
		} finally {
			submitting = false;
		}
	}

	onMount(async () => {
		returnTo = requestedReturnTo();
		try {
			const response = await fetch('/api/commands', { cache: 'no-store' });
			if (response.ok) location.replace(returnTo);
		} finally {
			checking = false;
		}
	});
</script>

<svelte:head><title>Iniciar sesión · SPB</title></svelte:head>

<main class="dark grid min-h-svh place-items-center bg-background text-foreground">
	{#if checking}
		<div class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Comprobando sesión…</div>
	{:else}
		<Card.Root class="w-full max-w-md shadow-xl">
			<Card.Header class="space-y-3">
				<div class="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground"><KeyRound class="size-5" /></div>
				<div class="space-y-1"><Card.Title>Consola de SPB</Card.Title><Card.Description>Inicia sesión para administrar tu servidor.</Card.Description></div>
			</Card.Header>
			<Card.Content>
				<form class="grid gap-4" onsubmit={(event) => { event.preventDefault(); void signIn(); }}>
					<div class="grid gap-2"><Label for="password">Contraseña</Label><Input id="password" bind:value={password} type="password" autocomplete="current-password" autofocus /></div>
					<Button type="submit" class="w-full" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</Button>
				</form>
				{#if error}<Alert.Root variant="destructive" class="mt-4"><Alert.Title>No se pudo iniciar sesión</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</main>
