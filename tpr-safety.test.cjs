const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runTpr(getTopmostBlock, chunkLoaded = true) {
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const moves = [];
  const actionBars = [];
  const effects = [];
  const movementPermissions = [];
  const dimension = {
    id: 'minecraft:overworld',
    heightRange: { max: 320 },
    isChunkLoaded() { return chunkLoaded; },
    getTopmostBlock,
    getBlock() { return { isAir: true }; },
  };
  const player = {
    id: 'player-1',
    isValid: true,
    dimension,
    location: { x: 0, y: 70, z: 0 },
    onScreenDisplay: {
      setActionBar(value) {
        actionBars.push(value);
        if (value === '' || value.includes('No se encontró')) resolveResult(value);
      },
    },
    inputPermissions: {
      setPermissionCategory(_category, enabled) { movementPermissions.push(enabled); },
    },
    addEffect(effect, duration, options) { effects.push({ effect, duration, options }); },
    sendMessage() {},
    teleport(location, options) {
      moves.push({ location, options, type: 'temporary' });
    },
    tryTeleport(location, options) {
      moves.push({ location, options, type: 'landing' });
      return true;
    },
  };
  const compiled = fs.readFileSync(
    path.join(__dirname, 'BP', 'scripts', 'features', 'teleport', 'tpr.js'),
    'utf8',
  );
  const source = compiled
    .replace(/^import .* from '@minecraft\/server';\r?\n/m, '')
    .replace('export function teletransportarAleatoriamente', 'function teletransportarAleatoriamente');
  const start = vm.runInNewContext(`${source}\nteletransportarAleatoriamente`, {
    world: { getDimension() { return dimension; } },
    system: { runTimeout(callback) { setImmediate(callback); } },
    InputPermissionCategory: { Movement: 'Movement' },
    Date,
    Math,
    Set,
  });
  start(player);
  return { result, moves, actionBars, effects, movementPermissions };
}

test('TPR returns to the origin when terrain lookup fails', async () => {
  const run = runTpr(() => { throw new Error('LocationInUnloadedChunkError'); });
  assert.match(await run.result, /No se encontró un destino seguro/);
  assert.equal(run.moves.filter((move) => move.type === 'landing').length, 0);
  assert.equal(run.moves.at(-1).location.x, 0);
  assert.equal(run.moves.at(-1).location.y, 70);
});

test('TPR moves only after a solid landing block and clear headroom are found', async () => {
  const run = runTpr(() => ({
    typeId: 'minecraft:grass_block',
    isAir: false,
    isLiquid: false,
    location: { x: 412, y: 70, z: -381 },
  }));
  assert.equal(await run.result, '');
  assert.deepEqual(JSON.parse(JSON.stringify(run.actionBars.slice(0, 5))), ['§eTeletransportando en §f5', '§eTeletransportando en §f4', '§eTeletransportando en §f3', '§eTeletransportando en §f2', '§eTeletransportando en §f1']);
  assert.equal(run.moves.length, 2);
  assert.equal(run.moves[0].type, 'temporary');
  assert.equal(run.moves[0].options.checkForBlocks, false);
  assert.equal(run.moves[1].type, 'landing');
  assert.deepEqual(JSON.parse(JSON.stringify(run.moves[1].location)), { x: 412.5, y: 71, z: -380.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(run.effects.map(({ effect }) => effect))), ['minecraft:slow_falling', 'minecraft:resistance']);
  assert.deepEqual(JSON.parse(JSON.stringify(run.movementPermissions)), [false, true]);
});

test('TPR samples nearby loaded columns before making another high teleport', async () => {
  let calls = 0;
  const run = runTpr(() => {
    calls += 1;
    if (calls === 1) {
      return { typeId: 'minecraft:water', isAir: false, isLiquid: true, location: { x: 100, y: 62, z: 100 } };
    }
    return { typeId: 'minecraft:grass_block', isAir: false, isLiquid: false, location: { x: 101, y: 70, z: 100 } };
  });
  assert.equal(await run.result, '');
  assert.equal(calls, 2);
  assert.equal(run.moves.length, 2);
  assert.equal(run.moves[1].type, 'landing');
});

test('TPR keeps the player elevated until the destination chunk becomes available', async () => {
  let terrainQueries = 0;
  const run = runTpr(() => {
    terrainQueries += 1;
    return undefined;
  }, false);
  assert.match(await run.result, /No se encontró un destino seguro/);
  assert.equal(terrainQueries, 0);
  assert.ok(run.moves.length > 6);
  assert.equal(run.moves.filter((move) => move.type === 'landing').length, 0);
});
