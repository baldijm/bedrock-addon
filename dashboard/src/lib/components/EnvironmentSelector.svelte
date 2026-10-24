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

<select aria-label="Entorno global" value={environment} onchange={change} disabled={changing} class="h-8 rounded-md border border-input bg-background px-2 text-sm font-medium text-foreground">
	<option value="staging">Staging</option>
	<option value="production">Producción</option>
</select>
