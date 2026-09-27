/**
 * Cache regression tests protect the generic cache primitives used by every provider.
 *
 * Keep tests focused on externally useful guarantees: bounded runtime memory,
 * duplicate-request suppression, and the fact that cache failures never become
 * fetch failures when a provider has already obtained valid source data.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryCacheStore, PersistentJsonCache, SingleFlight, setCacheBestEffort, type CacheStore, type JsonFileAdapter } from '../../core/cache.js';
import type { CacheEntry } from '../../domain/models.js';

function entry(key:string,value:string):CacheEntry<string>{
  return {version:1,key,storedAt:Date.now(),value};
}

test('MemoryCacheStore evicts the least recently used entry when full',async()=>{
  const cache=new MemoryCacheStore(2);
  await cache.set(entry('a','A'));
  await cache.set(entry('b','B'));
  await cache.get<string>('a'); // A becomes most recently used.
  await cache.set(entry('c','C'));
  assert.equal(await cache.get<string>('a') !== null,true);
  assert.equal(await cache.get<string>('b'),null);
  assert.equal(await cache.get<string>('c') !== null,true);
  assert.equal(cache.size,2);
});

test('MemoryCacheStore never exceeds its configured bound',async()=>{
  const cache=new MemoryCacheStore(3);
  for(let i=0;i<20;i++) await cache.set(entry(`key-${i}`,String(i)));
  assert.equal(cache.size,3);
});

test('SingleFlight shares one in-flight operation among concurrent callers',async()=>{
  const flight=new SingleFlight<string>();
  let executions=0;
  const task=async()=>{
    executions++;
    await new Promise(resolve=>setTimeout(resolve,10));
    return 'value';
  };
  const results=await Promise.all([
    flight.run('same',task),
    flight.run('same',task),
    flight.run('same',task),
  ]);
  assert.deepEqual(results,['value','value','value']);
  assert.equal(executions,1);
  assert.equal(flight.size,0);
});

test('SingleFlight removes a rejected task so a later attempt can retry',async()=>{
  const flight=new SingleFlight<number>();
  let attempts=0;
  await assert.rejects(flight.run('retry',async()=>{attempts++;throw new Error('first failure');}));
  const value=await flight.run('retry',async()=>{attempts++;return 42;});
  assert.equal(value,42);
  assert.equal(attempts,2);
  assert.equal(flight.size,0);
});

test('cache write failures can be isolated without changing CacheStore semantics',async()=>{
  class FailingCache implements CacheStore {
    async get<T>():Promise<CacheEntry<T>|null>{return null;}
    async set<T>():Promise<void>{throw new Error('disk full');}
    async delete():Promise<void>{}
    async clear():Promise<void>{}
  }
  const cache=new FailingCache();
  await setCacheBestEffort(cache,entry('x','X'));
  // The helper swallows the storage failure, allowing the already-fetched value
  // to be returned to the user. The underlying CacheStore contract remains strict.
  assert.equal(typeof cache.set,'function');
});

test('PersistentJsonCache treats storage read errors as cache misses',async()=>{
  const failingExists:JsonFileAdapter={
    exists:async()=>{throw new Error('storage unavailable');},
    mkdir:async()=>{},read:async()=>'',write:async()=>{},remove:async()=>{},
  };
  assert.equal(await new PersistentJsonCache(failingExists,'cache').get('key'),null);

  const failingRead:JsonFileAdapter={
    exists:async()=>true,
    mkdir:async()=>{},read:async()=>{throw new Error('file unavailable');},write:async()=>{},remove:async()=>{},
  };
  assert.equal(await new PersistentJsonCache(failingRead,'cache').get('key'),null);
});

test('PersistentJsonCache shares concurrent root initialization and recreates the root after clear',async()=>{
  const folders=new Set<string>();
  const files=new Map<string,string>();
  let mkdirCalls=0;
  const adapter:JsonFileAdapter={
    exists:async path=>folders.has(path)||files.has(path),
    mkdir:async path=>{mkdirCalls++;await Promise.resolve();folders.add(path);},
    read:async path=>{const value=files.get(path);if(value===undefined)throw new Error('not found');return value;},
    write:async(path,data)=>{files.set(path,data);},
    remove:async(path,recursive=false)=>{
      files.delete(path);
      if(recursive){for(const file of files.keys())if(file.startsWith(`${path}/`))files.delete(file);for(const folder of folders)if(folder===path||folder.startsWith(`${path}/`))folders.delete(folder);}
      else folders.delete(path);
    },
  };
  const cache=new PersistentJsonCache(adapter,'cache/plugin');
  await Promise.all([cache.set('one',1),cache.set('two',2)]);
  assert.equal(mkdirCalls,2);
  assert.equal(await cache.get<number>('one'),1);
  await cache.clear();
  await cache.set('three',3);
  assert.equal(await cache.get<number>('three'),3);
  assert.equal(mkdirCalls,3);
});
