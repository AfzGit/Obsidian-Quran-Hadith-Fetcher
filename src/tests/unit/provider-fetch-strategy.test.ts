import assert from 'node:assert/strict';
import test from 'node:test';
import type { HttpClient } from '../../core/http.js';
import { AlQuranCloudProvider } from '../../providers/alquran-cloud/provider.js';
import { QuranApiProvider } from '../../providers/quran-api/provider.js';
import { QuranProjectProvider } from '../../providers/quran-project/provider.js';
import { HadithJsonProvider } from '../../providers/hadith-json/provider.js';
import type { OfflineDatabaseStore, OfflineDatabaseDefinition, InstalledOfflineDatabase, OfflineInstallProgress } from '../../domain/offline.js';
import type { PersistentJsonStore } from '../../core/cache.js';
import { shouldFetchWholeQuranSurah } from '../../core/fetch.js';

function signal():AbortSignal{return new AbortController().signal;}

class FakeOffline implements OfflineDatabaseStore {
  constructor(private readonly values=new Map<string,unknown>()){}
  async listInstalled():Promise<InstalledOfflineDatabase[]>{return [];}
  async getJson<T>(databaseId:string,partId:string):Promise<T|null>{const value=this.values.get(`${databaseId}:${partId}`);return value===undefined?null:value as T;}
  async install(_definition:OfflineDatabaseDefinition,_http:HttpClient,_signal:AbortSignal,_onProgress?:(progress:OfflineInstallProgress)=>void):Promise<InstalledOfflineDatabase>{throw new Error('not used');}
  async remove(_databaseId:string):Promise<void>{}
}

class FakePersistent implements PersistentJsonStore {
  readonly values=new Map<string,unknown>();
  async get<T>(key:string):Promise<T|null>{return this.values.has(key)?this.values.get(key) as T:null;}
  async set<T>(key:string,value:T):Promise<void>{this.values.set(key,value);}
  async delete(key:string):Promise<void>{this.values.delete(key);}
  async clear():Promise<void>{this.values.clear();}
}

function alCloudResponse(url:string):unknown {
  const match=url.match(/ayah\/(\d+):(\d+)\/([^/?]+)$/u)!;
  const surah=Number(match[1]); const ayah=Number(match[2]); const edition=decodeURIComponent(match[3]!);
  return {
    code:200,
    status:'OK',
    data:{
      numberInSurah:ayah,
      text:edition==='quran-uthmani'?`AR${ayah}`:`EN${ayah}`,
      edition:{identifier:edition},
      surah:{englishName:`Surah ${surah}`},
    },
  };
}



test('whole-surah strategy does not download a large surah for a few missing ayahs',()=>{
  // Surah Al-Baqarah has 286 ayahs. Four missing ayahs are far below the coverage threshold,
  // so targeted requests remain preferable even though four ayahs would take more than one request.
  assert.equal(shouldFetchWholeQuranSurah({surah:2,startAyah:1,endAyah:4},4,2,2,4),false);
  assert.equal(shouldFetchWholeQuranSurah({surah:104,startAyah:1,endAyah:5},5,2,2,4),true);
});

test('Al Quran Cloud targets short requests and reuses per-ayah cache',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{calls.push(url);return{status:200,json:alCloudResponse(url) as T,headers:{}};},
  };
  const provider=new AlQuranCloudProvider(http,()=>true);
  const translation={id:'en.sahih',language:'en',name:'Saheeh International',providerId:'alquran-cloud'};
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:signal()});
  assert.equal(calls.length,4);
  assert.ok(calls.every(url=>url.includes('/ayah/2:')));
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:2,endAyah:3},translation,{signal:signal()});
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.includes('/ayah/2:3/')));
});

test('Al Quran Cloud switches to whole-surah retrieval for large missing ranges and seeds individual ayahs',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      if(url.includes('/surah/104/quran-uthmani')) return {status:200,json:{data:{englishName:'Al-Humazah',ayahs:Array.from({length:9},(_,i)=>({numberInSurah:i+1,text:`AR${i+1}`}))}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      if(url.includes('/surah/104/en.sahih')) return {status:200,json:{data:{englishName:'Al-Humazah',ayahs:Array.from({length:9},(_,i)=>({numberInSurah:i+1,text:`EN${i+1}`}))}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      return {status:200,json:alCloudResponse(url) as T,headers:{}};
    },
  };
  const provider=new AlQuranCloudProvider(http,()=>true);
  const translation={id:'en.sahih',language:'en',name:'Saheeh International',providerId:'alquran-cloud'};
  await provider.fetchQuran({kind:'quran',surah:104,startAyah:1,endAyah:5},translation,{signal:signal()});
  assert.deepEqual(calls.map(url=>url.includes('/quran-uthmani')?'arabic':'translation'),['arabic','translation']);
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:104,startAyah:5,endAyah:6},translation,{signal:signal()});
  assert.equal(calls.length,0);
});

test('Quran API targets short requests and caches each ayah separately',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      const match=url.match(/\/(\d+)\/(\d+)\.min\.json$/u);
      if(match) return {status:200,json:{chapter:[{chapter:Number(match[1]!),verse:Number(match[2]!),text:url.includes('ara-quranacademy')?`AR${match[2]}`:`EN${match[2]}`}]},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      throw new Error(`unexpected URL: ${url}`);
    },
  };
  const provider=new QuranApiProvider(http,()=>true);
  const translation={id:'eng-muhammadtaqiudd',language:'en',name:'Hilali-Khan',providerId:'quran-api'};
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:signal()});
  assert.equal(calls.length,4);
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:2,endAyah:3},translation,{signal:signal()});
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.endsWith('/2/3.min.json')));
});

test('Quran Project uses per-ayah endpoints for short ranges and caches by ayah',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      const match=url.match(/\/api\/(\d+)\/(\d+)\.json$/u)!;
      return {status:200,json:{surahName:'Al-Baqarah',ayahNo:Number(match[2]),arabic1:`AR${match[2]}`,english:`EN${match[2]}`,bengali:`BN${match[2]}`,urdu:`UR${match[2]}`},headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new QuranProjectProvider(http,()=>true);
  const translation={id:'en',language:'en',name:'English',providerId:'quran-project'};
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:signal()});
  assert.equal(calls.length,2);
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:2,endAyah:3},translation,{signal:signal()});
  assert.deepEqual(calls,['https://quranapi.pages.dev/api/2/3.json']);
});

test('Quran Project uses a whole surah for a sufficiently large missing range and then reuses its ayah cache',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      if(url==='https://quranapi.pages.dev/api/104.json') return {status:200,json:{surahName:'Al-Humazah',arabic1:Array.from({length:9},(_,i)=>`AR${i+1}`),english:Array.from({length:9},(_,i)=>`EN${i+1}`),bengali:[],urdu:[]},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      throw new Error(`unexpected URL: ${url}`);
    },
  };
  const provider=new QuranProjectProvider(http,()=>true);
  const translation={id:'en',language:'en',name:'English',providerId:'quran-project'};
  await provider.fetchQuran({kind:'quran',surah:104,startAyah:1,endAyah:5},translation,{signal:signal()});
  assert.deepEqual(calls,['https://quranapi.pages.dev/api/104.json']);
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:104,startAyah:5,endAyah:6},translation,{signal:signal()});
  assert.deepEqual(calls,[]);
});


test('Hadith JSON keeps only a bounded number of full books in memory',async()=>{
  const persistent=new FakePersistent();
  let calls=0;
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls++;
      const book=url.split('/').at(-1)?.replace('.json','') ?? 'book';
      return {status:200,json:[{id:1,idInBook:1,arabic:book,english:{text:book}}],headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new HadithJsonProvider(http,()=>true,undefined,persistent);
  const translation={id:'en',language:'en',name:'English',providerId:'hadith-json'};
  for(const id of ['bukhari','muslim','abudawud','tirmidhi']) await provider.fetchHadith({kind:'hadith',collectionId:id,hadithNumber:1},translation,{signal:signal()});
  assert.equal(calls,4);
  await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},translation,{signal:signal()});
  // Bukhari is the least-recently-used book after four distinct books, so it is read from
  // the persistent cache rather than forcing another network download.
  assert.equal(calls,4);
});

test('Hadith JSON persistent book cache survives provider recreation',async()=>{
  const persistent=new FakePersistent();
  let calls=0;
  const makeHttp=():HttpClient=>({
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>()=>{calls++;return{status:200,json:[{id:1,idInBook:1,arabic:'AR',english:{narrator:'N',text:'EN'}}],headers:{}} as {status:number;json:T;headers:Record<string,string>};},
  });
  const translation={id:'en',language:'en',name:'English',providerId:'hadith-json'};
  const first=new HadithJsonProvider(makeHttp(),()=>true,undefined,persistent);
  await first.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},translation,{signal:signal()});
  assert.equal(calls,1);
  const second=new HadithJsonProvider(makeHttp(),()=>true,undefined,persistent);
  await second.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},translation,{signal:signal()});
  assert.equal(calls,1);
});

test('Hadith JSON uses installed database before persistent cache',async()=>{
  const persistent=new FakePersistent();
  await persistent.set('hadith-json:v1.2.0:bukhari:book',[{id:1,idInBook:1,arabic:'CACHED AR',english:{text:'CACHED EN'}}]);
  const offline=new FakeOffline(new Map([['hadith-json:bukhari:book',[{id:1,idInBook:1,arabic:'OFFLINE AR',english:{text:'OFFLINE EN'}}]]]));
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const provider=new HadithJsonProvider(http,()=>true,offline,persistent);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:signal()});
  assert.equal(result.arabic,'OFFLINE AR');
  assert.equal(result.english,'OFFLINE EN');
});
