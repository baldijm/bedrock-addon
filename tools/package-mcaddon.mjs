import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'builds');
const outputFile = path.join(outputDirectory, 'SPB-dev.mcaddon');

await mkdir(outputDirectory, { recursive: true });

const output = createWriteStream(outputFile);
const archive = archiver('zip', { zlib: { level: 9 } });

const finished = new Promise((resolve, reject) => {
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
});

archive.pipe(output);
archive.glob('**/*', {
  cwd: path.join(projectRoot, 'BP'),
  ignore: ['**/*.map']
}, { prefix: 'BP' });
archive.directory(path.join(projectRoot, 'RP'), 'RP');
await archive.finalize();
await finished;

console.log(`Created ${path.relative(projectRoot, outputFile)} (${archive.pointer()} bytes)`);
