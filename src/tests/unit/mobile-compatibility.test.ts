import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

/**
 * These are source-level guardrails for a plugin whose manifest advertises mobile support.
 * They do not replace testing in Obsidian itself, but they catch two easy regressions:
 * accidentally importing desktop-only Node/Electron modules and reintroducing regex
 * lookbehind, which older iOS WebViews cannot parse.
 */
function runtimeSourceFiles(root:string):string[]{
  const files:string[]=[];
  for(const entry of readdirSync(root,{withFileTypes:true})){
    if(entry.name==='tests') continue;
    const path=join(root,entry.name);
    if(entry.isDirectory()) files.push(...runtimeSourceFiles(path));
    else if(entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

test('runtime source does not import Node or Electron modules',()=>{
  const root=resolve(process.cwd(),'src');
  if(!existsSync(root)) throw new Error(`Source directory not found: ${root}`);
  const forbidden=/from\s+['"](?:node:)?(?:fs|path|os|crypto|electron)(?:['"]|\/)|require\(\s*['"](?:node:)?(?:fs|path|os|crypto|electron)/u;
  const offenders=runtimeSourceFiles(root).filter(file=>forbidden.test(readFileSync(file,'utf8')));
  assert.deepEqual(offenders,[],`Desktop-only imports found in: ${offenders.join(', ')}`);
});

test('runtime source does not use JavaScript regex lookbehind',()=>{
  const root=resolve(process.cwd(),'src');
  const lookbehind=/\(\?<=[=!]/u;
  const offenders=runtimeSourceFiles(root).filter(file=>lookbehind.test(readFileSync(file,'utf8')));
  assert.deepEqual(offenders,[],`Regex lookbehind found in: ${offenders.join(', ')}`);
});
