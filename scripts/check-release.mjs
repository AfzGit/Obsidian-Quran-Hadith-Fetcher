import { readFile } from 'node:fs/promises';

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const [manifest, packageJson, lockfile, versions] = await Promise.all([
  readJson('manifest.json'),
  readJson('package.json'),
  readJson('package-lock.json'),
  readJson('versions.json'),
]);

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error(`manifest.version must be a stable x.y.z version: ${manifest.version}`);
}
if (packageJson.version !== manifest.version || lockfile.version !== manifest.version || lockfile.packages?.['']?.version !== manifest.version) {
  throw new Error('manifest.json, package.json, and package-lock.json versions must match');
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error(`versions.json must map ${manifest.version} to minAppVersion ${manifest.minAppVersion}`);
}
if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== manifest.version) {
  throw new Error(`Release tag ${process.env.GITHUB_REF_NAME} must exactly match manifest version ${manifest.version}`);
}

console.log(`Release metadata is consistent for ${manifest.id} ${manifest.version}.`);
