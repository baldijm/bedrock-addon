const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runTpr(getBlockBelow) {
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const moves = [];
  let markersRemoved = 0;
  let markersCreated = 0;
  const dimension = {
    id: 'minecraft:overworld',
    heightRange: { max: 320 },
    spawnEntity(type) {
      assert.equal(type, 'minecraft:armor_stand');
      markersCreated += 1;
      return {
        isValid: true,
        location: { x: 412.5, y: 250, z: -380.5 },
        addTag() {},
        remove() { markersRemoved += 1; },
      };
    },
    runCommand(command) {
      assert.match(command, /spreadplayers .* @e\[type=armor_stand,tag=/);
      assert.doesNotMatch(command, /@a\[/);
    },
    isChunkLoaded() { return true; },
    getBlockBelow,
    getBlock() { return { isAir: true }; },
  };
  const player = {
    id: 'player-1',
    isValid: true,
    dimension,
    location: { x: 0, y: 70, z: 0 },
    sendMessage(message) {
      if (message.includes('ubicación segura') || message.includes('No se encontró')) {
        resolveResult(message);
      }
    },
    tryTeleport(location, options) {
      moves.push({ location, options });
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
  return { result, moves, get markersCreated() { return markersCreated; }, get markersRemoved() { return markersRemoved; } };
}

test('TPR never moves a player when terrain lookup fails after spread', async () => {
  const run = runTpr(() => { throw new Error('LocationInUnloadedChunkError'); });
  assert.match(await run.result, /No se encontró un destino seguro/);
  assert.equal(run.moves.length, 0);
  assert.equal(run.markersCreated, 6);
  assert.equal(run.markersRemoved, 6);
});

test('TPR moves only after a solid landing block and clear headroom are found', async () => {
  const run = runTpr(() => ({
    typeId: 'minecraft:grass_block',
    isAir: false,
    isLiquid: false,
    location: { x: 412, y: 70, z: -381 },
  }));
  assert.match(await run.result, /ubicación segura/);
  assert.equal(run.moves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(run.moves[0].location)), { x: 412.5, y: 71, z: -380.5 });
  assert.equal(run.moves[0].options.checkForBlocks, true);
  assert.equal(run.markersRemoved, 1);
});
