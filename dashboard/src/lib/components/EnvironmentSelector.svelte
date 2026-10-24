<script lang="ts">
	import { onMount } from 'svelte';

	let environment = $state<'staging' | 'production'>('staging');
	let changing = $state(false);

	function readEnvironment() {
		return document.cookie.split('; ').find((entry) => entry.startsWith('spb_environment='))?.split('=')[1];
	}

	onMount(() => {
		environment = readEnvironment() === 'production' ? 'production' : 'staging';
	});

	async function change(event: Event) {
		const next = (event.currentTarget as HTMLSelectElement).value === 'production' ? 'production' : 'staging';
		if (next === environment || changing) return;
		changing = true;
		const response = await fetch('/api/environment', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ environment: next })
		});
		if (response.ok) window.location.reload();
		else changing = false;
	}
</script>

<div class="fixed right-3 top-3 z-50 flex items-center gap-2 rounded-lg border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur sm:right-5 sm:top-5">
	<span class="hidden text-xs text-muted-foreground sm:inline">Entorno</span>
	<select aria-label="Entorno global" value={environment} onchange={change} disabled={changing} class="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground">
		<option value="staging">Staging</option>
		<option value="production">Producción</option>
	</select>
</div>
