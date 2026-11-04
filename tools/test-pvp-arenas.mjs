import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const messages = [];
const properties = new Map();
let handler;
const context = vm.createContext({ console: { warn: line => messages.push(line) }, Date, Map, Set, encodeURIComponent, decodeURIComponent });
const minecraft = new vm.SyntheticModule(['world', 'system', 'ScriptEventSource'], function () {
  this.setExport('world', { getDynamicProperty: key => properties.get(key), setDynamicProperty: (key, value) => properties.set(key, value) });
  this.setExport('system', { afterEvents: { scriptEventReceive: { subscribe: callback => handler = callback } } });
  this.setExport('ScriptEventSource', { Server: 'server', Entity: 'entity' });
}, { context });
const cache = new Map();
async function load(name) {
  if (name === '@minecraft/server') return minecraft;
  if (cache.has(name)) return cache.get(name);
  const filename = `src/scripts/features/games/${name.replace('./', '').replace('.js', '.ts')}`;
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
  const module = new vm.SourceTextModule(source, { context, identifier: name });
  cache.set(name, module);
  await module.link(load);
  return module;
}
const control = await load('./arenaControl.js');
await control.evaluate();
const schema = cache.get('./arenaSchema.js').namespace;
const arena = structuredClone(schema.legacyArena);
assert.equal(schema.validateArena(arena).id, 'principal');
for (const mutate of [
  a => a.bounds.max.x = a.bounds.min.x - 1,
  a => a.bounds.max.x += 200,
  a => a.npc1.y = -100,
  a => a.goal2 = structuredClone(a.goal1),
  a => a.yaw1 = null,
  a => a.npc2 = structuredClone(a.npc1),
  a => a.dimension = '__proto__',
]) {
  const invalid = structuredClone(arena); mutate(invalid);
  assert.throws(() => schema.validateArena(invalid));
}
let busy = false;
let preparation;
let rejectPreparation = false;
const applied = [];
control.namespace.installArenaControl({ busy: () => busy, prepare: async () => { if (rejectPreparation) throw new Error('Sin suelo'); if (preparation) await preparation; }, apply: value => applied.push(value?.id ?? null) });
let sequence = 0;
async function request(input, sourceType = 'server', wait = true) {
  const id = (++sequence).toString(16).padStart(12, '0');
  const data = encodeURIComponent(JSON.stringify(input));
  const chunks = data.match(/.{1,350}/g);
  for (let i = 0; i <= chunks.length; i++) handler({ id: 'spb:pvp_admin', sourceType, message: `${id} ${i} ${chunks[i] ?? 'COMMIT'}` });
  if (wait) await new Promise(resolve => setImmediate(resolve));
  const parts = messages.filter(line => line.startsWith(`SPB_PVP ${id} `)).map(line => line.match(/ (\d+)\/(\d+) (\S+)$/)).sort((a, b) => Number(a[1]) - Number(b[1]));
  return parts.length ? JSON.parse(decodeURIComponent(parts.map(part => part[3]).join(''))) : null;
}
let result = await request({ action: 'list' });
assert.equal(result.state.active, null);
assert.equal(properties.size, 0, 'reading does not modify the world');
const unicode = { ...arena, name: 'Arena 🏟️ — Prueba Ñ' };
result = await request({ action: 'save', revision: 0, arena: unicode });
assert.equal(result.ok, true);
assert.equal(result.state.arenas[0].name, unicode.name);
assert.equal(result.state.active, null, 'saving a draft does not activate it');
assert.equal((await request({ action: 'save', revision: 0, arena })).ok, false, 'stale writes fail');
assert.equal(await request({ action: 'deactivate', revision: 1 }, 'entity'), null, 'players cannot use the control event');
rejectPreparation = true;
assert.equal((await request({ action: 'activate', revision: 1, id: arena.id })).ok, false);
assert.equal(control.namespace.arenaState().revision, 1, 'failed validation leaves the saved state unchanged');
rejectPreparation = false;
let release;
preparation = new Promise(resolve => release = resolve);
await request({ action: 'activate', revision: 1, id: arena.id }, 'server', false);
assert.equal(control.namespace.arenaChanging(), true);
assert.equal((await request({ action: 'list' })).busy, true);
assert.equal(control.namespace.arenaChanging(), true, 'reading during activation cannot clear its lock');
assert.equal((await request({ action: 'delete', revision: 1, id: arena.id })).ok, false);
assert.equal(control.namespace.arenaChanging(), true, 'a rejected mutation cannot clear another activation lock');
release(); await new Promise(resolve => setImmediate(resolve)); preparation = undefined;
assert.equal(control.namespace.arenaState().active.id, arena.id);
assert.equal(control.namespace.arenaState().revision, 2);
assert.equal((await request({ action: 'delete', revision: 2, id: arena.id })).ok, false);
busy = true;
assert.equal((await request({ action: 'deactivate', revision: 2 })).ok, false, 'match locks configuration');
busy = false;
result = await request({ action: 'deactivate', revision: 2 });
assert.equal(result.state.active, null);
assert.deepEqual(applied, ['principal', null]);
assert.equal((await request({ action: 'delete', revision: 3, id: arena.id })).state.arenas.length, 0);
console.log('PvP: schema, Unicode transport, persistence, revisions, activation failures, concurrency, source authorization, match lock and deletion passed.');
