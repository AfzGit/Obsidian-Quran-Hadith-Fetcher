import { mkdir, copyFile } from 'node:fs/promises';

const output = new URL('../release/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  await copyFile(new URL(`../${file}`, import.meta.url), new URL(file, output));
}
console.log('Packaged main.js, manifest.json, and styles.css in release/.');
