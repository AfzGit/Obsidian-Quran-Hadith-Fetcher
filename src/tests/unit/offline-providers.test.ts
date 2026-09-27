import assert from 'node:assert/strict';
import test from 'node:test';
import { QuranApiProvider } from '../../providers/quran-api/provider.js';
import { HadithUnlockedProvider } from '../../providers/hadith-unlocked/provider.js';
import { HadithApiProvider } from '../../providers/hadith-api/provider.js';
import { HadithJsonProvider } from '../../providers/hadith-json/provider.js';
import type { HttpClient } from '../../core/http.js';
import type { PersistentJsonStore } from '../../core/cache.js';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore, InstalledOfflineDatabase, OfflineInstallProgress } from '../../domain/offline.js';

class FakeOfflineStore implements OfflineDatabaseStore {
  constructor(private readonly values = new Map<string, unknown>()) {}
  async listInstalled(): Promise<InstalledOfflineDatabase[]> { return []; }
  async getJson<T>(databaseId:string, partId:string):Promise<T|null>{
    const value=this.values.get(`${databaseId}:${partId}`);
    return value===undefined ? null : value as T;
  }
  async install(_definition:OfflineDatabaseDefinition,_http:HttpClient,_signal:AbortSignal,_onProgress?:(progress:OfflineInstallProgress)=>void):Promise<InstalledOfflineDatabase>{ throw new Error('not used'); }
  async remove(_databaseId:string):Promise<void>{}
}

function abortSignal():AbortSignal { return new AbortController().signal; }


test('Quran API fetches targeted verse responses',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      if(url.endsWith('/ara-quranacademy/2/1.min.json')) return {status:200,json:{data:{sura:2,aya:1,text:'AR1'}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      if(url.endsWith('/eng-muhammadtaqiudd/2/1.min.json')) return {status:200,json:{data:{sura:2,aya:1,text:'EN1'}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      throw new Error(`unexpected URL: ${url}`);
    },
  };
  const provider=new QuranApiProvider(http,()=>false);
  const result=await provider.fetchQuran(
    {kind:'quran',surah:2,startAyah:1,endAyah:1},
    {id:'eng-muhammadtaqiudd',language:'en',name:'Hilali-Khan',providerId:'quran-api'},
    {signal:abortSignal()}
  );
  assert.equal(result.ayahs[0]?.arabic,'AR1');
  assert.equal(result.ayahs[0]?.translation?.text,'EN1');
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.includes('/2/1.min.json')));
});

test('Quran API uses a chapter request for sufficiently large missing ranges',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      const isArabic=url.includes('ara-quranacademy');
      return {status:200,json:{chapter:Array.from({length:9},(_,i)=>({chapter:104,verse:i+1,text:isArabic?`AR${i+1}`:`EN${i+1}`}))},headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new QuranApiProvider(http,()=>true);
  const translation={id:'eng-muhammadtaqiudd',language:'en',name:'Hilali-Khan',providerId:'quran-api'};
  const result=await provider.fetchQuran({kind:'quran',surah:104,startAyah:1,endAyah:5},translation,{signal:abortSignal()});
  assert.equal(result.ayahs.length,5);
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>url.endsWith('/104.min.json')));
});

test('Quran API cache is stored per ayah and satisfies a later range',async()=>{
  let calls=0;
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls++;
      const ayah=Number(url.match(/\/2\/(\d+)\.min\.json$/u)?.[1] ?? 1);
      const isArabic=url.includes('ara-quranacademy');
      if(url.includes('/104/')) return {status:200,json:{data:{sura:104,aya:ayah,text:isArabic?`AR${ayah}`:`EN${ayah}`}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
      return {status:200,json:{chapter:Array.from({length:4},(_,i)=>({chapter:2,verse:i+1,text:isArabic?`AR${i+1}`:`EN${i+1}`}))},headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new QuranApiProvider(http,()=>true);
  const translation={id:'eng-muhammadtaqiudd',language:'en',name:'Hilali-Khan',providerId:'quran-api'};
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:abortSignal()});
  assert.equal(calls,4);
  const before=calls;
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:abortSignal()});
  assert.equal(result.ayahs.length,2);
  assert.equal(calls,before);
});

test('Quran API uses installed offline Arabic and translation data without chapter requests',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      calls.push(url);
      return {status:200,json: url.endsWith('editions.min.json') ? {
        hilali:{name:'eng-muhammadtaqiudd',author:'Muhammad Taqi Ud Din Al Hilali And Muhammad Muhsin Khan',language:'English'}
      } : {},headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const offline=new FakeOfflineStore(new Map([
    ['quran-api:arabic:arabic',[{sura:2,aya:1,text:'AR1'}]],
    ['quran-api:eng-muhammadtaqiudd:translation',[{sura:2,aya:1,text:'EN1'}]],
  ]));
  const provider=new QuranApiProvider(http,()=>false,offline);
  const translations=await provider.listTranslations({signal:abortSignal()});
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:1},translations[0]!,{signal:abortSignal()});
  assert.equal(result.ayahs[0]?.arabic,'AR1');
  assert.equal(result.ayahs[0]?.translation?.text,'EN1');
  assert.equal(calls.length,1);
});


test('Quran API reconstructs installed translation metadata when metadata is unavailable',async()=>{
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async()=>{throw new Error('network unavailable');},
  };
  const offline=new FakeOfflineStore(new Map([
    ['quran-api:arabic:arabic',[{sura:2,aya:1,text:'AR1'}]],
    ['quran-api:eng-muhammadtaqiudd:translation',[{sura:2,aya:1,text:'EN1'}]],
  ]));
  (offline as unknown as {listInstalled:()=>Promise<InstalledOfflineDatabase[]>}).listInstalled=async()=>[{
    id:'quran-api:eng-muhammadtaqiudd',providerId:'quran-api',kind:'quran',label:'Muhammad Taqi Ud Din Al Hilali And Muhammad Muhsin Khan — EN',description:'',installedAt:0,sizeBytes:3,parts:['translation']
  }];
  const provider=new QuranApiProvider(http,()=>false,offline);
  const translations=await provider.listTranslations({signal:abortSignal()});
  assert.equal(translations[0]?.id,'eng-muhammadtaqiudd');
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:1},translations[0]!,{signal:abortSignal()});
  assert.equal(result.ayahs[0]?.arabic,'AR1');
  assert.equal(result.ayahs[0]?.translation?.text,'EN1');
});

test('Hadith Unlocked uses installed book data without pinging the hadith endpoint',async()=>{
  const http:HttpClient={
    getText:async()=>{throw new Error('network should not be used');},
    getJson:async()=>{throw new Error('network should not be used');},
  };
  const offline=new FakeOfflineStore(new Map([
    ['hadith-unlocked:bukhari:book',[{ref:'bukhari:1',num:1,body:'AR',body_en:'EN'}]],
  ]));
  const provider=new HadithUnlockedProvider(http,()=>false,offline);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-unlocked'},{signal:abortSignal()});
  assert.equal(result.arabic,'AR');
  assert.equal(result.english,'EN');
});

test('Hadith API discovers all books exposed by its editions catalog',async()=>{
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{
      assert.equal(url,'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions.min.json');
      return {status:200,json:{bukhari:{name:'Sahih al Bukhari',collection:[{name:'ara-bukhari',language:'Arabic'},{name:'eng-bukhari',language:'English',author:'Muhsin Khan'}]},custom:{name:'Custom Collection',collection:[{name:'ara-custom',language:'Arabic'},{name:'eng-custom',language:'English',author:'Author'}]}},headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new HadithApiProvider(http,()=>false);
  const collections=await provider.listCollections({signal:abortSignal()});
  assert.equal(collections.length,2);
  assert.deepEqual(collections.find(c=>c.id==='custom'),{id:'custom',name:'Custom Collection',providerId:'hadith-api',author:'Author',arabicEdition:'ara-custom',englishEdition:'eng-custom'});
});

test('Hadith API uses installed English and Arabic editions without pinging edition URLs',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{ calls.push(url); return {status:200,json:url.endsWith('editions.min.json')?{}:{},headers:{}} as {status:number;json:T;headers:Record<string,string>}; },
  };
  const offline=new FakeOfflineStore(new Map([
    ['hadith-api:bukhari:eng:arabic',{hadiths:[{hadithnumber:1,text:'AR',grades:[]}]}],
    ['hadith-api:bukhari:eng:translation',{hadiths:[{hadithnumber:1,text:'EN',grades:[]}]}],
  ]));
  const provider=new HadithApiProvider(http,()=>false,offline);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'eng',language:'en',name:'English',providerId:'hadith-api'},{signal:abortSignal()});
  assert.equal(result.arabic,'AR');
  assert.equal(result.english,'EN');
  assert.equal(calls.length,0);
});


test('Hadith API offline fetch does not require the editions catalog',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string)=>{ calls.push(url); throw new Error(`unexpected network request: ${url}`); },
  };
  const offline=new FakeOfflineStore(new Map([
    ['hadith-api:bukhari:eng:arabic',{hadiths:[{hadithnumber:1,text:'AR',grades:[]}]}],
    ['hadith-api:bukhari:eng:translation',{hadiths:[{hadithnumber:1,text:'EN',grades:[]}]}],
  ]));
  const provider=new HadithApiProvider(http,()=>false,offline);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'eng',language:'en',name:'English',providerId:'hadith-api'},{signal:abortSignal()});
  assert.equal(result.arabic,'AR');
  assert.equal(result.english,'EN');
  assert.deepEqual(calls,[]);
});


test('Hadith API falls back to English translation metadata when edition metadata is unavailable',async()=>{
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async()=>{throw new Error('network unavailable');},
  };
  const offline=new FakeOfflineStore();
  (offline as unknown as {listInstalled:()=>Promise<InstalledOfflineDatabase[]>}).listInstalled=async()=>[{
    id:'hadith-api:bukhari:eng',providerId:'hadith-api',kind:'hadith',label:'Sahih Al-Bukhari — English',description:'',installedAt:0,sizeBytes:1,parts:['arabic','translation']
  }];
  const provider=new HadithApiProvider(http,()=>false,offline);
  const translations=await provider.listTranslations({signal:abortSignal()});
  assert.deepEqual(translations,[{id:'eng',language:'en',name:'English',providerId:'hadith-api'}]);
});

test('Hadith JSON uses idInBook before global id when selecting a book reference',async()=>{
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const offline=new FakeOfflineStore(new Map([
    ['hadith-json:ibnmajah:book',[
      {id:9001,idInBook:1,arabic:'WRONG',english:{narrator:'',text:'WRONG'}},
      {id:1,idInBook:2,arabic:'RIGHT',english:{narrator:'Narrator',text:'RIGHT EN'}},
    ]],
  ]));
  const provider=new HadithJsonProvider(http,()=>false,offline);
  const result=await provider.fetchHadith(
    {kind:'hadith',collectionId:'ibnmajah',hadithNumber:2},
    {id:'en',language:'en',name:'English',providerId:'hadith-json'},
    {signal:abortSignal()}
  );
  assert.equal(result.arabic,'RIGHT');
  assert.equal(result.english,'RIGHT EN');
});

test('Hadith JSON exposes all 17 books from the pinned v1.2.0 dataset',async()=>{
  const provider=new HadithJsonProvider({getText:async()=>{throw new Error('not used');},getJson:async()=>{throw new Error('not used');}},()=>false);
  const books=await provider.listCollections({signal:new AbortController().signal});
  assert.equal(books.length,17);
  assert.deepEqual(books.map(book=>book.id),[
    'bukhari','muslim','abudawud','tirmidhi','nasai','ibnmajah','malik','ahmad','darimi',
    'nawawi40','qudsi40','shahwaliullah40','riyadussalihin','mishkat_almasabih','aladab_almufrad','shamail_muhammadiyah','bulugh_almaram',
  ]);
  const definitions=await provider.listOfflineDatabases({signal:new AbortController().signal});
  assert.equal(definitions.length,17);
  assert.ok(definitions.every(definition=>definition.parts.length===1 && definition.parts[0]!.url.includes('/db/by_book/')));
});

test('Hadith JSON uses installed combined Arabic and English book data',async()=>{
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const offline=new FakeOfflineStore(new Map([
    ['hadith-json:bukhari:book',[{id:1,arabic:'AR',english:{narrator:'Narrator',text:'EN'}}]],
  ]));
  const provider=new HadithJsonProvider(http,()=>false,offline);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:abortSignal()});
  assert.equal(result.arabic,'AR');
  assert.equal(result.english,'EN');
  assert.equal(result.englishIsnad,'Narrator');
});

test('Hadith JSON removes newline markers from fetched text',async()=>{
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const offline=new FakeOfflineStore(new Map([
    ['hadith-json:bukhari:book',[{id:1,arabic:'AR\\nTEXT',english:{narrator:'Narra\\ntor',text:'EN\\nTEXT'}}]],
  ]));
  const provider=new HadithJsonProvider(http,()=>false,offline);
  const result=await provider.fetchHadith(
    {kind:'hadith',collectionId:'bukhari',hadithNumber:1},
    {id:'en',language:'en',name:'English',providerId:'hadith-json'},
    {signal:abortSignal()}
  );
  assert.equal(result.arabic,'AR TEXT');
  assert.equal(result.english,'EN TEXT');
  assert.equal(result.englishIsnad,'Narra tor');
});

test('Hadith JSON collapses repeated whitespace',async()=>{
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const offline=new FakeOfflineStore(new Map([
    ['hadith-json:bukhari:book',[{id:1,arabic:'AR  TEXT',english:{narrator:'Narra  tor',text:'EN    TEXT'}}]],
  ]));
  const provider=new HadithJsonProvider(http,()=>false,offline);
  const result=await provider.fetchHadith(
    {kind:'hadith',collectionId:'bukhari',hadithNumber:1},
    {id:'en',language:'en',name:'English',providerId:'hadith-json'},
    {signal:abortSignal()}
  );
  assert.equal(result.arabic,'AR TEXT');
  assert.equal(result.english,'EN TEXT');
  assert.equal(result.englishIsnad,'Narra tor');
});

test('Quran Project uses installed complete surah data without network',async()=>{
  const http:HttpClient={getText:async()=>{throw new Error('network should not be used');},getJson:async()=>{throw new Error('network should not be used');}};
  const offline=new FakeOfflineStore(new Map([
    ['quran-project:complete:2',{surahName:'Al-Baqarah',arabic1:['AR1'],english:['EN1'],bengali:['BN1'],urdu:['UR1']}],
  ]));
  const { QuranProjectProvider } = await import('../../providers/quran-project/provider.js');
  const provider=new QuranProjectProvider(http,()=>false,offline);
  const translations=await provider.listTranslations({signal:abortSignal()});
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:1},translations[0]!,{signal:abortSignal()});
  assert.equal(result.ayahs[0]?.arabic,'AR1');
  assert.equal(result.ayahs[0]?.translation?.text,'EN1');
});


test('Hadith JSON range fetch reuses one downloaded book',async()=>{
  let calls=0;
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>()=>{
      calls++;
      return {status:200,json:[
        {id:100,idInBook:1,arabic:'AR1',english:{narrator:'N1',text:'EN1'}},
        {id:101,idInBook:2,arabic:'AR2',english:{narrator:'N2',text:'EN2'}},
        {id:102,idInBook:3,arabic:'AR3',english:{narrator:'N3',text:'EN3'}},
      ],headers:{}} as {status:number;json:T;headers:Record<string,string>};
    },
  };
  const provider=new HadithJsonProvider(http,()=>true);
  const results=await provider.fetchHadithRange({kind:'hadith',collectionId:'bukhari',hadithNumber:1,endHadithNumber:3},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:abortSignal()});
  assert.deepEqual(results.map(r=>r.english),['EN1','EN2','EN3']);
  assert.equal(calls,1);
});

class FakePersistentJsonStore implements PersistentJsonStore {
  private readonly values=new Map<string,unknown>();
  async get<T>(key:string):Promise<T|null>{return this.values.has(key)?this.values.get(key) as T:null;}
  async set<T>(key:string,value:T):Promise<void>{this.values.set(key,value);}
  async delete(key:string):Promise<void>{this.values.delete(key);}
  async clear():Promise<void>{this.values.clear();}
}

test('Hadith JSON persistent book cache survives provider recreation',async()=>{
  let calls=0;
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>():Promise<{status:number;json:T;headers:Record<string,string>}>=>{
      calls++;
      return {status:200,json:[{id:1,idInBook:1,arabic:'AR',english:{narrator:'N',text:'EN'}}] as unknown as T,headers:{}};
    },
  };
  const persistent=new FakePersistentJsonStore();
  const first=new HadithJsonProvider(http,()=>true,undefined,persistent);
  await first.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:abortSignal()});
  const second=new HadithJsonProvider(http,()=>true,undefined,persistent);
  const result=await second.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:abortSignal()});
  assert.equal(result.english,'EN');
  assert.equal(calls,1);
});

test('Hadith JSON offline data wins over a persistent online book cache',async()=>{
  let calls=0;
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>():Promise<{status:number;json:T;headers:Record<string,string>}>=>{calls++;return {status:200,json:[{id:1,arabic:'ONLINE',english:{text:'ONLINE'}}] as unknown as T,headers:{}};},
  };
  const persistent=new FakePersistentJsonStore();
  await persistent.set('hadith-json:v1.2.0:bukhari:book',[{id:1,idInBook:1,arabic:'CACHED',english:{text:'CACHED'}}]);
  const offline=new FakeOfflineStore(new Map([['hadith-json:bukhari:book',[{id:1,idInBook:1,arabic:'OFFLINE',english:{text:'OFFLINE'}}]]]));
  const provider=new HadithJsonProvider(http,()=>true,offline,persistent);
  const result=await provider.fetchHadith({kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'en',language:'en',name:'English',providerId:'hadith-json'},{signal:abortSignal()});
  assert.equal(result.arabic,'OFFLINE');
  assert.equal(calls,0);
});

test('Al Quran Cloud uses targeted ayah requests for short ranges',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string):Promise<{status:number;json:T;headers:Record<string,string>}>=>{
      calls.push(url);
          const match=url.match(/:(\d+)(?:\/|$)/u);
      const number=Number(match?.[1] ?? 1);
      const edition=url.includes('/quran-uthmani')?'quran-uthmani':'en.sahih';
      return {status:200,json:{data:{number,numberInSurah:number,text:edition==='quran-uthmani'?`AR${number}`:`EN${number}`,edition:{identifier:edition},surah:{englishName:'Al-Baqarah'}}} as unknown as T,headers:{}};
    },
  };
  const provider=new (await import('../../providers/alquran-cloud/provider.js')).AlQuranCloudProvider(http,()=>false);
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},{id:'en.sahih',language:'en',name:'Saheeh International',providerId:'alquran-cloud'},{signal:abortSignal()});
  assert.equal(result.ayahs.length,2);
  assert.equal(calls.length,4);
  assert.ok(calls.every(url=>url.includes('/ayah/2:')));
});

test('Quran Project uses one-ayah endpoint for short ranges and chapter endpoint for larger misses',async()=>{
  const calls:string[]=[];
  const http:HttpClient={
    getText:async()=>({status:200,text:'',headers:{}}),
    getJson:async<T>(url:string):Promise<{status:number;json:T;headers:Record<string,string>}>=>{
      calls.push(url);
      if(/\/\d+\/\d+\.json$/u.test(url)){
        const match=url.match(/\/(\d+)\/(\d+)\.json$/u)!;
        return {status:200,json:{surahName:'Al-Baqarah',surahNo:Number(match[1]),ayahNo:Number(match[2]),arabic1:`AR${match[2]}`,english:`EN${match[2]}`,bengali:`BN${match[2]}`,urdu:`UR${match[2]}`} as unknown as T,headers:{}};
      }
      return {status:200,json:{surahName:'Al-Baqarah',arabic1:['AR1','AR2','AR3','AR4','AR5','AR6','AR7','AR8','AR9','AR10'],english:['EN1','EN2','EN3','EN4','EN5','EN6','EN7','EN8','EN9','EN10'],bengali:[],urdu:[]} as unknown as T,headers:{}};
    },
  };
  const { QuranProjectProvider }=await import('../../providers/quran-project/provider.js');
  const provider=new QuranProjectProvider(http,()=>false);
  const translation={id:'en',language:'en',name:'English',providerId:'quran-project'};
  await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:2},translation,{signal:abortSignal()});
  assert.equal(calls.length,2);
  assert.ok(calls.every(url=>/\/2\/\d+\.json$/u.test(url)));
  calls.length=0;
  await provider.fetchQuran({kind:'quran',surah:104,startAyah:1,endAyah:5},translation,{signal:abortSignal()});
  assert.equal(calls.length,1);
  assert.ok(calls[0]?.endsWith('/api/104.json'));
});
