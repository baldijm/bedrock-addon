<script lang="ts">
	import '../app.css';
	import { Toaster } from 'svelte-sonner';
	import EnvironmentSelector from '#lib/components/EnvironmentSelector.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<title>SPB · Consola</title>
	<meta name="description" content="Consola privada de administración de SPB." />
</svelte:head>

{@render children()}
<EnvironmentSelector />
<Toaster theme="dark" position="top-right" richColors closeButton />
