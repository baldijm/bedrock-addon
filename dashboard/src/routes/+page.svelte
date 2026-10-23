<script lang="ts">
	import { onMount } from 'svelte';

	type Command = {
		id: string;
		command: string;
		status: 'queued' | 'running' | 'completed' | 'failed';
		createdAt: string;
		completedAt: string | null;
		result: string | null;
	};

	let authenticated = $state(false);
	let loading = $state(true);
	let password = $state('');
	let command = $state('');
	let error = $state('');
	let sending = $state(false);
	let history = $state<Command[]>([]);

	async function api(path: string, options: RequestInit = {}) {
		const response = await fetch(path, {
			...options,
			headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) throw new Error(body.error || 'No se pudo completar la solicitud.');
		return body;
	}

	async function refresh() {
		try {
			const body = await api('/api/commands');
			history = body.commands;
			authenticated = true;
			error = '';
		} catch {
			authenticated = false;
		} finally {
			loading = false;
		}
	}

	async function signIn() {
		error = '';
		try {
			await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
			password = '';
			await refresh();
		} catch (reason) {
			error = reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.';
		}
	}

	async function submit() {
		if (!command.trim() || sending) return;
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

	async function signOut() {
		await api('/api/logout', { method: 'POST' });
		authenticated = false;
		history = [];
	}

	onMount(() => {
		void refresh();
		const timer = window.setInterval(() => authenticated && void refresh(), 2500);
		return () => window.clearInterval(timer);
	});
</script>

{#if loading}
	<main class="shell"><p>Abriendo consola privada…</p></main>
{:else if !authenticated}
	<main class="shell login">
		<section>
			<p class="eyebrow">SPB · ADMINISTRACIÓN</p>
			<h1>Consola privada</h1>
			<p>Inicia sesión para administrar el entorno de staging.</p>
			<form
				onsubmit={(event) => {
					event.preventDefault();
					void signIn();
				}}
			>
				<label
					>Contraseña <input
						bind:value={password}
						type="password"
						autocomplete="current-password"
					/></label
				>
				<button type="submit">Entrar</button>
			</form>
			{#if error}<p class="error">{error}</p>{/if}
		</section>
	</main>
{:else}
	<main class="shell">
		<header>
			<div>
				<p class="eyebrow">SPB · CONSOLA</p>
				<h1>Staging</h1>
			</div>
			<div class="badge">Sólo pruebas</div>
			<button class="ghost" onclick={() => void signOut()}>Salir</button>
		</header>

		<section class="terminal" aria-label="Enviar comando">
			<label for="command">Comando de Minecraft</label>
			<div class="entry">
				<span>›</span><input
					id="command"
					bind:value={command}
					onkeydown={(event) => event.key === 'Enter' && void submit()}
					placeholder="say Hola desde la consola"
					autocomplete="off"
				/><button onclick={() => void submit()} disabled={sending}
					>{sending ? 'Enviando…' : 'Enviar'}</button
				>
			</div>
			<p>Se envía texto libre a staging. No tiene acceso a Linux ni a producción.</p>
		</section>

		{#if error}<p class="error">{error}</p>{/if}
		<section class="history">
			<div class="section-title">
				<h2>Actividad reciente</h2>
				<span>Actualiza automáticamente</span>
			</div>
			{#if history.length === 0}
				<p class="empty">Aún no hay comandos enviados.</p>
			{:else}
				{#each history as item (item.id)}
					<article>
						<div>
							<code>{item.command}</code><small>{new Date(item.createdAt).toLocaleString()}</small>
						</div>
						<div
							class:pending={item.status === 'queued' || item.status === 'running'}
							class="status"
						>
							{item.status === 'queued'
								? 'En cola'
								: item.status === 'running'
									? 'Ejecutando'
									: item.status === 'failed'
										? 'Error'
										: 'Listo'}
						</div>
						{#if item.result}<pre>{item.result}</pre>{/if}
					</article>
				{/each}
			{/if}
		</section>
	</main>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		background: #10130f;
		color: #edf2e9;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	.shell {
		width: min(920px, calc(100% - 32px));
		margin: 0 auto;
		padding: 64px 0;
	}
	.login {
		min-height: 100svh;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	.login section {
		width: min(420px, 100%);
		background: #1b2119;
		border: 1px solid #354432;
		border-radius: 18px;
		padding: 32px;
	}
	.eyebrow {
		color: #a9d38f;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.13em;
		margin: 0 0 8px;
	}
	h1 {
		margin: 0;
		font-size: clamp(2rem, 8vw, 3.25rem);
		letter-spacing: -0.05em;
	}
	form,
	.entry {
		display: flex;
		gap: 10px;
		margin-top: 24px;
	}
	label {
		display: grid;
		gap: 7px;
		font-weight: 700;
	}
	form label {
		flex: 1;
	}
	input {
		width: 100%;
		background: #0e120d;
		color: inherit;
		border: 1px solid #51664b;
		border-radius: 9px;
		padding: 13px;
		font: inherit;
		outline-offset: 2px;
	}
	button {
		background: #b7e49e;
		color: #162014;
		border: 0;
		border-radius: 9px;
		padding: 0 17px;
		font: inherit;
		font-weight: 800;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 32px;
	}
	.badge {
		margin-left: auto;
		color: #ffd17d;
		background: #342817;
		padding: 7px 10px;
		border-radius: 99px;
		font-size: 0.82rem;
		font-weight: 700;
	}
	.ghost {
		background: transparent;
		border: 1px solid #53604e;
		color: #dbe6d5;
		padding: 8px 12px;
	}
	.terminal,
	.history {
		background: #1b2119;
		border: 1px solid #354432;
		border-radius: 14px;
		padding: 22px;
	}
	.entry {
		margin: 10px 0;
		align-items: center;
		background: #0e120d;
		border: 1px solid #51664b;
		border-radius: 9px;
		padding-left: 14px;
		color: #a9d38f;
		font:
			1rem ui-monospace,
			monospace;
	}
	.entry input {
		border: 0;
		background: transparent;
		padding-left: 4px;
	}
	.entry button {
		align-self: stretch;
		border-radius: 0 8px 8px 0;
	}
	.terminal p,
	small,
	.section-title span {
		color: #aeb7a9;
		font-size: 0.86rem;
	}
	.history {
		margin-top: 18px;
	}
	.section-title {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	h2 {
		margin: 0 0 16px;
		font-size: 1.05rem;
	}
	article {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		padding: 13px 0;
		border-top: 1px solid #303a2d;
	}
	article code {
		display: block;
		word-break: break-word;
	}
	article small {
		display: block;
		margin-top: 4px;
	}
	.status {
		color: #a9d38f;
		font-weight: 700;
		font-size: 0.85rem;
	}
	.status.pending {
		color: #ffd17d;
	}
	pre {
		grid-column: 1 / -1;
		margin: 0;
		white-space: pre-wrap;
		color: #cbd6c4;
		font:
			0.84rem ui-monospace,
			monospace;
	}
	.error {
		color: #ffc0b5;
		margin-top: 14px;
	}
	.empty {
		color: #aeb7a9;
	}
	@media (max-width: 600px) {
		.shell {
			padding-top: 32px;
		}
		header {
			align-items: flex-start;
			flex-wrap: wrap;
		}
		.badge {
			margin-left: 0;
		}
		.entry {
			flex-wrap: wrap;
			padding: 8px 8px 8px 14px;
		}
		.entry input {
			width: calc(100% - 24px);
		}
		.entry button {
			border-radius: 8px;
			padding: 12px 17px;
			margin-left: auto;
		}
	}
</style>
