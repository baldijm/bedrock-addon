import { consoleBridgeRequest, type ServerEnvironment } from './bridge';
import type { ArenaState } from '#lib/pvp-arenas';

type Result = { ok: boolean; error?: string; state: ArenaState; busy: boolean };
type Logs = { cursor: number; lines: { id: number; text: string }[] };

/** Use the existing authenticated console bridge, keeping each command under 512 characters. */
export async function arenaRequest(environment: ServerEnvironment, input: object): Promise<Result> {
	const request = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
	const payload = encodeURIComponent(JSON.stringify(input));
	if (payload.length > 6000) throw new Error('La solicitud supera el tamaño permitido.');
	const chunks = payload.match(/[\s\S]{1,350}/g) ?? [];
	let cursor = 0;
	for (let i = 0; i <= chunks.length; i++) {
		const sent = await consoleBridgeRequest(environment, '/commands', {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ command: `scriptevent spb:pvp_admin ${request} ${i} ${chunks[i] ?? 'COMMIT'}` })
		}) as { outputCursor: number };
		if (i === chunks.length) cursor = sent.outputCursor;
	}
	const parts = new Map<number, string>();
	let count = 0;
	const marker = new RegExp(`SPB_PVP ${request} (\\d+)/(\\d+) (\\S+)`);
	for (let attempt = 0; attempt < 16; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500));
		const logs = await consoleBridgeRequest(environment, `/logs?after=${cursor}`) as Logs;
		cursor = logs.cursor;
		for (const line of logs.lines) {
			const match = marker.exec(line.text);
			if (!match) continue;
			count = Number(match[2]);
			if (count > 100) throw new Error('Respuesta de arenas demasiado grande.');
			parts.set(Number(match[1]), match[3]);
		}
		if (count && parts.size === count) {
			const result = JSON.parse(decodeURIComponent(Array.from({ length: count }, (_, i) => parts.get(i)).join(''))) as Result;
			if (!result.ok) throw new Error(result.error || 'El add-on rechazó el cambio.');
			return result;
		}
	}
	throw new Error('Bedrock no confirmó la operación de arenas. Recarga para comprobar el estado antes de reintentar.');
}
