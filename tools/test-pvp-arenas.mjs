import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';

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
context.setTimeout = setTimeout;
context.crypto = { randomUUID };
const destinations = [];
const bridge = new vm.SyntheticModule(['consoleBridgeRequest'], function () {
  this.setExport('consoleBridgeRequest', async (environment, path, options) => {
    destinations.push(environment);
    if (path === '/properties') return { properties: { 'level-name': 'Forever World' } };
    if (path === '/commands') {
      const cursor = messages.length;
      const command = JSON.parse(options.body).command;
      assert.ok(command.length <= 512);
      assert.ok(!/[\r\n\0]/.test(command));
      handler({ id: 'spb:pvp_admin', sourceType: 'server', message: command.replace('scriptevent spb:pvp_admin ', '') });
      return { outputCursor: cursor };
    }
    const cursor = Number(new URL(path, 'http://bridge').searchParams.get('after'));
    return { cursor: messages.length, lines: messages.slice(cursor).map((text, index) => ({ id: cursor + index + 1, text })) };
  });
}, { context });
await bridge.link(() => { throw new Error('Unexpected import'); }); await bridge.evaluate();
async function dashboardModule(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText;
  const module = new vm.SourceTextModule(code, { context });
  await module.link(name => { assert.ok(dependencies[name], `Unexpected import: ${name}`); return dependencies[name]; });
  await module.evaluate(); return module;
}
const transport = await dashboardModule('dashboard/src/lib/server/pvp-arenas.ts', { './bridge': bridge });
const transported = await transport.namespace.arenaRequest('staging', { action: 'save', revision: 4, arena: unicode });
assert.equal(transported.state.arenas[0].name, unicode.name, 'dashboard transport preserves Unicode across command and response chunks');
let authenticated = true;
let environment = 'staging';
function synthetic(exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
}
const auth = synthetic({ isAuthenticated: async () => authenticated, json: (body, status = 200) => ({ body, status }), unauthorized: () => ({ status: 401 }) });
const environmentModule = synthetic({ resolveEnvironment: () => environment });
const dashboardSchema = await dashboardModule('dashboard/src/lib/pvp-arenas.ts', {
  '../../../src/scripts/features/games/arenaSchema': cache.get('./arenaSchema.js'),
});
const reversed = structuredClone(arena);
reversed.goal2 = { min: { x: -499, y: 201, z: 179 }, max: { x: -501, y: 201, z: 181 } };
[reversed.bounds.min, reversed.bounds.max] = [reversed.bounds.max, reversed.bounds.min];
[reversed.goal1.min, reversed.goal1.max] = [reversed.goal1.max, reversed.goal1.min];
const normalized = dashboardSchema.namespace.validateArena(reversed);
assert.equal(normalized.goal2.min.x, -501);
assert.equal(normalized.goal2.max.x, -499);
assert.equal(normalized.goal2.min.y, 201, 'a one-block-high region is valid');
assert.deepEqual(JSON.parse(JSON.stringify(normalized.bounds)), arena.bounds);
assert.equal(reversed.goal2.min.x, -499, 'normalization does not mutate the form');
const api = await dashboardModule('dashboard/src/routes/api/pvp/arenas/+server.ts', {
  '#lib/server/auth': auth, '#lib/server/environment': environmentModule,
  '#lib/server/bridge': bridge, '#lib/server/pvp-arenas': transport, '#lib/pvp-arenas': dashboardSchema,
});
authenticated = false;
assert.equal((await api.namespace.GET({ request: {} })).status, 401);
assert.equal((await api.namespace.POST({ request: {} })).status, 401);
authenticated = true; environment = 'production';
const before = properties.get('spb:pvp_arenas_v1');
let apiResult = await api.namespace.POST({ request: { text: async () => JSON.stringify({ action: 'save', revision: 5, arena: unicode, confirmation: 'wrong' }) } });
assert.equal(apiResult.status, 400);
assert.equal(properties.get('spb:pvp_arenas_v1'), before, 'wrong production confirmation cannot mutate the world');
destinations.length = 0;
apiResult = await api.namespace.GET({ request: {} });
assert.equal(apiResult.status, 200);
assert.equal(apiResult.body.world, 'Forever World');
assert.ok(destinations.every(item => item === 'production'), 'environment selection is preserved through every bridge call');
environment = 'staging';
apiResult = await api.namespace.POST({ request: { text: async () => JSON.stringify({ action: 'save', revision: 5, arena: reversed }) } });
assert.equal(apiResult.status, 200, 'API accepts unordered corners and sends canonical bounds to the unchanged add-on');
assert.equal(apiResult.body.state.arenas[0].goal2.min.x, -501);
// Exercise the actual page's action handler. Svelte runes are plain values
// here; no rendering is required to verify failure recovery and draft retention.
const pageSource = fs.readFileSync('dashboard/src/routes/pvp/+page.svelte', 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
context.$state = value => value;
context.$derived = value => value;
context.structuredClone = structuredClone;
const pageModule = new vm.SourceTextModule(ts.transpileModule(pageSource + `
  export function prepareTest(catalogValue, formValue, actionValue) {
    catalog = catalogValue; draft = formValue; selected = formValue.id;
    pending = actionValue; confirmation = 'Forever World';
  }
  export { apply, pending, working, error, notice, draft, catalog, confirmation };
`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2021 } }).outputText, { context });
const svelte = synthetic({ onMount: () => {} });
await pageModule.link(name => {
  if (name === 'svelte') return svelte;
  if (name === '#lib/pvp-arenas') return dashboardSchema;
  throw new Error(`Unexpected page import: ${name}`);
});
await pageModule.evaluate();
const savedCatalog = JSON.parse(JSON.stringify(apiResult.body.state));
const form = structuredClone(arena);
pageModule.namespace.prepareTest(savedCatalog, form, 'activate');
context.fetch = async () => ({ ok: false, json: async () => ({ error: 'NPC1: falta suelo sólido o espacio libre en -504, 204, 127.' }) });
await pageModule.namespace.apply();
assert.equal(pageModule.namespace.pending, '', 'failed activation releases the editor confirmation lock');
assert.equal(pageModule.namespace.working, '');
assert.equal(pageModule.namespace.confirmation, '');
assert.equal(pageModule.namespace.draft, form, 'failed activation does not discard form values');
assert.equal(pageModule.namespace.catalog, savedCatalog, 'failed activation retains saved configuration');
assert.match(pageModule.namespace.error, /^Activar arena guardada:/);
assert.match(pageModule.namespace.notice, /borrador guardado se conserva/);
console.log('PvP: schema, persistence, revisions, activation failures, concurrency, source permissions, match lock, deletion, dashboard transport, API authentication and Production confirmation passed.');
