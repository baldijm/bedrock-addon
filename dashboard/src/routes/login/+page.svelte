<script lang="ts">
	import { onMount } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	onMount(async () => {
		try {
			const response = await fetch('/api/commands', { cache: 'no-store' });
			location.replace(response.ok ? '/' : '/terminal');
		} catch {
			location.replace('/terminal');
		}
	});
</script>

<svelte:head><title>Comprobando sesión · SPB</title></svelte:head>

<main class="dark grid min-h-svh place-items-center bg-background text-foreground">
	<div class="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" /> Comprobando sesión…</div>
</main>
