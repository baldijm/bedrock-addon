import { readFile, writeFile } from 'node:fs/promises';

const source = process.argv[2];
const destination = process.argv[3];

if (!source || !destination) {
	throw new Error('Uso: node tools/create_structure_static_variant.mjs <origen.mcstructure> <destino.mcstructure>');
}

// These names deliberately have exactly the same byte length as their vanilla source.
// That lets us patch NBT string payloads without disturbing its offsets or structure.
const replacements = new Map([
	['minecraft:lime_concrete_powder', 'spb:lime_concrete_powder_fixed'],
	['minecraft:green_concrete_powder', 'spb:green_concrete_powder_fixed'],
	['minecraft:black_concrete_powder', 'spb:black_concrete_powder_fixed'],
	['minecraft:light_gray_concrete_powder', 'spb:light_gray_concrete_powder_fixed'],
	['minecraft:gray_concrete_powder', 'spb:gray_concrete_powder_fixed'],
	['minecraft:brown_concrete_powder', 'spb:brown_concrete_powder_fixed'],
	['minecraft:red_concrete_powder', 'spb:red_concrete_powder_fixed'],
	['minecraft:orange_concrete_powder', 'spb:orange_concrete_powder_fixed'],
	['minecraft:yellow_concrete_powder', 'spb:yellow_concrete_powder_fixed'],
	['minecraft:cyan_concrete_powder', 'spb:cyan_concrete_powder_fixed'],
	['minecraft:light_blue_concrete_powder', 'spb:light_blue_concrete_powder_fixed'],
	['minecraft:red_sand', 'spb:red_sand_fixed'],
	['minecraft:gravel', 'spb:gravel_fixed']
]);

const bytes = Buffer.from(await readFile(source));
let changed = 0;

for (const [vanilla, fixed] of replacements) {
	const from = Buffer.from(vanilla, 'utf8');
	const to = Buffer.from(fixed, 'utf8');
	if (from.length !== to.length) throw new Error(`Longitud distinta para ${vanilla}.`);
	for (let offset = 0; offset <= bytes.length - from.length; offset += 1) {
		if (!bytes.subarray(offset, offset + from.length).equals(from)) continue;
		to.copy(bytes, offset);
		changed += 1;
		offset += from.length - 1;
	}
}

if (!changed) throw new Error('No se encontraron bloques con gravedad compatibles en la estructura.');
await writeFile(destination, bytes);
console.log(`Variante creada: ${destination} (${changed} referencias de paleta reemplazadas).`);
