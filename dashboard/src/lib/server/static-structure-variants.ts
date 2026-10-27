import { readStructure, validateStructureName } from '#lib/server/structures';
import {
	readStoredStructure,
	storeStructureBytes,
	storedStructure
} from '#lib/server/structure-library';

const staticBlocks = [
	['minecraft:lime_concrete_powder', 'spb:lime_concrete_powder_fixed', 'Polvo de concreto lima'],
	['minecraft:green_concrete_powder', 'spb:green_concrete_powder_fixed', 'Polvo de concreto verde'],
	['minecraft:black_concrete_powder', 'spb:black_concrete_powder_fixed', 'Polvo de concreto negro'],
	['minecraft:light_gray_concrete_powder', 'spb:light_gray_concrete_powder_fixed', 'Polvo de concreto gris claro'],
	['minecraft:gray_concrete_powder', 'spb:gray_concrete_powder_fixed', 'Polvo de concreto gris'],
	['minecraft:brown_concrete_powder', 'spb:brown_concrete_powder_fixed', 'Polvo de concreto café'],
	['minecraft:red_concrete_powder', 'spb:red_concrete_powder_fixed', 'Polvo de concreto rojo'],
	['minecraft:orange_concrete_powder', 'spb:orange_concrete_powder_fixed', 'Polvo de concreto naranja'],
	['minecraft:yellow_concrete_powder', 'spb:yellow_concrete_powder_fixed', 'Polvo de concreto amarillo'],
	['minecraft:cyan_concrete_powder', 'spb:cyan_concrete_powder_fixed', 'Polvo de concreto cian'],
	['minecraft:light_blue_concrete_powder', 'spb:light_blue_concrete_powder_fixed', 'Polvo de concreto celeste'],
	['minecraft:red_sand', 'spb:red_sand_fixed', 'Arena roja'],
	['minecraft:gravel', 'spb:gravel_fixed', 'Grava']
] as const;

type StaticBlock = (typeof staticBlocks)[number];
const encoder = new TextEncoder();

export type StaticVariantCandidate = {
	id: string;
	replacement: string;
	label: string;
};

function bytesEqual(bytes: Uint8Array, offset: number, expected: Uint8Array) {
	if (offset + expected.byteLength > bytes.byteLength) return false;
	for (let index = 0; index < expected.byteLength; index += 1)
		if (bytes[offset + index] !== expected[index]) return false;
	return true;
}

function contains(bytes: Uint8Array, expected: Uint8Array) {
	for (let offset = 0; offset <= bytes.byteLength - expected.byteLength; offset += 1)
		if (bytesEqual(bytes, offset, expected)) return true;
	return false;
}

function replacementFor(id: string): StaticBlock | undefined {
	return staticBlocks.find(([vanilla]) => vanilla === id);
}

async function sourceBytes(name: string) {
	const stored = await readStoredStructure(name);
	if (stored) return new Uint8Array(await new Response(stored.object.body).arrayBuffer());
	return (await readStructure(name)).bytes;
}

export async function staticVariantCandidates(name: unknown): Promise<StaticVariantCandidate[]> {
	const bytes = await sourceBytes(validateStructureName(name));
	return staticBlocks
		.filter(([vanilla]) => contains(bytes, encoder.encode(vanilla)))
		.map(([id, replacement, label]) => ({ id, replacement, label }));
}

export async function createStaticVariant(source: unknown, target: unknown, selected: unknown) {
	const sourceName = validateStructureName(source);
	const targetName = validateStructureName(target);
	if (sourceName === targetName) throw new Error('La variante debe tener un nombre distinto al original.');
	if (!Array.isArray(selected) || !selected.every((id) => typeof id === 'string'))
		throw new Error('Indica al menos un bloque para fijar.');
	const selectedBlocks = [...new Set(selected)]
		.map(replacementFor)
		.filter((entry): entry is StaticBlock => Boolean(entry));
	if (!selectedBlocks.length) throw new Error('No seleccionaste bloques con una variante estática disponible.');
	const bytes = await sourceBytes(sourceName);
	let changed = 0;
	for (const [vanilla, fixed] of selectedBlocks) {
		const from = encoder.encode(vanilla);
		const to = encoder.encode(fixed);
		if (from.byteLength !== to.byteLength) throw new Error(`La sustitución de ${vanilla} no conserva el NBT.`);
		for (let offset = 0; offset <= bytes.byteLength - from.byteLength; offset += 1) {
			if (!bytesEqual(bytes, offset, from)) continue;
			bytes.set(to, offset);
			changed += 1;
			offset += from.byteLength - 1;
		}
	}
	if (!changed) throw new Error('La estructura no contiene los bloques seleccionados.');
	const existing = await storedStructure(targetName);
	const result = await storeStructureBytes(
		targetName,
		bytes,
		`variante estática de ${sourceName}${existing ? ' (reemplaza variante anterior)' : ''}`
	);
	return { ...result, replacements: changed };
}
