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
      setActionBar(value) { actionBars.push(value); },
    },
    addEffect(effect, duration, options) { effects.push({ effect, duration, options }); },
    sendMessage(message) {
      if (message.includes('ubicación segura') || message.includes('Regresaste')) {
        resolveResult(message);
      }
    },
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
    Date,
    Math,
    Set,
  });
  start(player);
  return { result, moves, actionBars, effects };
}

test('TPR returns to the origin when terrain lookup fails', async () => {
  const run = runTpr(() => { throw new Error('LocationInUnloadedChunkError'); });
  assert.match(await run.result, /Regresaste a tu posición anterior/);
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
  assert.match(await run.result, /ubicación segura/);
  assert.deepEqual(JSON.parse(JSON.stringify(run.actionBars.slice(0, 5))), ['§e5', '§e4', '§e3', '§e2', '§e1']);
  assert.equal(run.moves.length, 2);
  assert.equal(run.moves[0].type, 'temporary');
  assert.equal(run.moves[0].options.checkForBlocks, false);
  assert.equal(run.moves[1].type, 'landing');
  assert.deepEqual(JSON.parse(JSON.stringify(run.moves[1].location)), { x: 412.5, y: 71, z: -380.5 });
  assert.deepEqual(JSON.parse(JSON.stringify(run.effects.map(({ effect }) => effect))), ['minecraft:slow_falling', 'minecraft:resistance']);
});

test('TPR keeps the player elevated until the destination chunk becomes available', async () => {
  let terrainQueries = 0;
  const run = runTpr(() => {
    terrainQueries += 1;
    return undefined;
  }, false);
  assert.match(await run.result, /Regresaste a tu posición anterior/);
  assert.equal(terrainQueries, 0);
  assert.ok(run.moves.length > 6);
  assert.equal(run.moves.filter((move) => move.type === 'landing').length, 0);
});
