import { App, normalizePath } from 'obsidian';
import type { PersistentJsonStore } from '../core/cache';

interface Adapter { exists(path:string):Promise<boolean>; mkdir(path:string):Promise<void>; read(path:string):Promise<string>; write(path:string,data:string):Promise<void>; remove(path:string,recursive?:boolean):Promise<void>; list(path:string):Promise<{files:string[];folders:string[]}>; }

/**
 * Produce a compact filesystem-safe filename component for a persistent cache key.
 * The original key is stored in the JSON payload and checked on read, so this hash
 * is a filename mechanism, not a cryptographic integrity or uniqueness guarantee.
 */
function hashKey(value:string):string{
  let hash=2166136261;
  for(let i=0;i<value.length;i++) hash=Math.imul(hash ^ value.charCodeAt(i),16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
}

export class ObsidianPersistentJsonStore implements PersistentJsonStore {
  private readonly adapter:Adapter;
  private readonly root:string;
  private rootReady=false;
  // Concurrent writes must share mkdir work so Vault adapters do not race on folders.
  private rootPromise?:Promise<void>;
  constructor(app:App,pluginId:string,subdir='provider-cache'){
    this.adapter=app.vault.adapter as unknown as Adapter;
    this.root=normalizePath(`${app.vault.configDir}/plugins/${pluginId}/${subdir}`);
  }
  private async ensureRoot():Promise<void>{
    if(this.rootReady) return;
    if(this.rootPromise) return this.rootPromise;
    const pending=(async()=>{
      const parts=this.root.split('/').filter(Boolean);
      let current=this.root.startsWith('/')?'/':'';
      for(const part of parts){ current=current?`${current}/${part}`:part; if(!(await this.adapter.exists(current))) await this.adapter.mkdir(current); }
      this.rootReady=true;
    })();
    this.rootPromise=pending;
    try{await pending;}finally{if(this.rootPromise===pending)this.rootPromise=undefined;}
  }
  private path(key:string):string{return normalizePath(`${this.root}/${hashKey(key)}.json`);}
  /**
   * Read a cached value and verify the embedded key. Because the filename uses a
   * small hash, a theoretical collision must become a cache miss rather than return
   * another provider's data.
   */
  async get<T>(key:string):Promise<T|null>{
    try{
      const path=this.path(key);
      if(!(await this.adapter.exists(path))) return null;
      const parsed=JSON.parse(await this.adapter.read(path)) as {version?:number;key?:string;value?:T};
      if(parsed.version!==1 || parsed.key!==key) return null;
      return parsed.value===undefined?null:parsed.value;
    }catch{
      // Cache storage is optional; unreadable or corrupt files should trigger a refetch.
      return null;
    }
  }
  async set<T>(key:string,value:T):Promise<void>{
    await this.ensureRoot();
    await this.adapter.write(this.path(key),JSON.stringify({version:1,key,value}));
  }
  async delete(key:string):Promise<void>{
    const path=this.path(key); if(await this.adapter.exists(path)) await this.adapter.remove(path);
  }
  async clear():Promise<void>{
    if(!(await this.adapter.exists(this.root))) return;
    const listing=await this.adapter.list(this.root);
    await Promise.all([...listing.files,...listing.folders].map(path=>this.adapter.remove(normalizePath(path),true).catch(()=>undefined)));
  }
}
