import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinecraftBlockTypes } from '@minecraft/vanilla-data';

const output = fileURLToPath(new URL('../dashboard/src/lib/data/blocks.json', import.meta.url));
const vanillaBlocks = [...new Set(Object.values(MinecraftBlockTypes))].sort();
const customBlocks = ['spb:bloque_rojo', 'spb:bloque_verde'];

await mkdir(dirname(output), { recursive: true });
await writeFile(
	output,
	JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			vanillaDataVersion: '1.26.51',
			vanillaBlocks,
			customBlocks
		},
		null,
		2
	) + '\n'
);

console.log(`Generated ${vanillaBlocks.length + customBlocks.length} block identifiers.`);
