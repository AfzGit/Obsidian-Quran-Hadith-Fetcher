import type { FetchContext, HadithProvider, ProviderHealth } from '../../domain/provider';
import type { CollectionDefinition, HadithReference, HadithResult, ProviderCapabilities, ProviderMetadata, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore } from '../../domain/offline';
import type { HttpClient } from '../../core/http';
import { AppError } from '../../core/errors';
import { normalizeHadithCollectionMetadata } from '../../core/catalog';
import { setPersistentCacheBestEffort, type PersistentJsonStore } from '../../core/cache';

const BASE='https://raw.githubusercontent.com/AhmedBaset/hadith-json/v1.2.0';
const DATASET_VERSION='v1.2.0';
const TRANSLATION:TranslationDefinition={id:'en',language:'en',name:'English',providerId:'hadith-json'};
const COLLECTIONS:readonly CollectionDefinition[]=[
  {id:'bukhari',name:'Sahih Al-Bukhari',providerId:'hadith-json',author:'Imam Muhammad Ibn Ismail Al-Bukhari'},
  {id:'muslim',name:'Sahih Muslim',providerId:'hadith-json',author:'Imam Muslim Ibn Al-Hajjaj Al-Naysaburi'},
  {id:'abudawud',name:'Sunan Abi Dawud',providerId:'hadith-json',author:'Imam Sulayman Ibn Al-Ashath Abu Dawud Al-Sijistani'},
  {id:'tirmidhi',name:"Jami' At-Tirmidhi",providerId:'hadith-json',author:'Imam Abu Isa Muhammad Ibn Isa At-Tirmidhi'},
  {id:'nasai',name:"Sunan An-Nasa'i",providerId:'hadith-json',author:"Imam Ahmad Ibn Shu'ayb An-Nasa'i"},
  {id:'ibnmajah',name:'Sunan Ibn Majah',providerId:'hadith-json',author:'Imam Muhammad Ibn Yazid Ibn Majah Al-Qazwini'},
  {id:'malik',name:'Muwatta Malik',providerId:'hadith-json',author:'Imam Malik Ibn Anas'},
  {id:'ahmad',name:'Musnad Ahmad Ibn Hanbal',providerId:'hadith-json',author:'Imam Ahmad Ibn Hanbal'},
  {id:'darimi',name:'Sunan Ad-Darimi',providerId:'hadith-json',author:'Imam Abu Muhammad Abd Al-Rahman Ibn Abd Allah Al-Darimi'},
  {id:'nawawi40',name:'The Forty Hadith of Imam Nawawi',providerId:'hadith-json',author:'Imam Yahya Ibn Sharaf Al-Nawawi'},
  {id:'qudsi40',name:'The Forty Hadith Qudsi',providerId:'hadith-json'},
  {id:'shahwaliullah40',name:'The Forty Hadith of Shah Waliullah',providerId:'hadith-json',author:'Shah Waliullah Dahlawi'},
  {id:'riyadussalihin',name:'Riyad As-Salihin',providerId:'hadith-json',author:'Imam Yahya Ibn Sharaf Al-Nawawi'},
  {id:'mishkat_almasabih',name:'Mishkat Al-Masabih',providerId:'hadith-json',author:'Al-Khatib Al-Tabrizi'},
  {id:'aladab_almufrad',name:'Al-Adab Al-Mufrad',providerId:'hadith-json',author:'Imam Muhammad Ibn Ismail Al-Bukhari'},
  {id:'shamail_muhammadiyah',name:"Shama'il Muhammadiyah",providerId:'hadith-json',author:'Imam Tirmidhi'},
  {id:'bulugh_almaram',name:'Bulugh Al-Maram',providerId:'hadith-json',author:'Ibn Hajar Al-Asqalani'},
];
const BOOK_PATHS:Readonly<Record<string,string>>={
  bukhari:'the_9_books/bukhari',muslim:'the_9_books/muslim',abudawud:'the_9_books/abudawud',tirmidhi:'the_9_books/tirmidhi',nasai:'the_9_books/nasai',ibnmajah:'the_9_books/ibnmajah',malik:'the_9_books/malik',ahmad:'the_9_books/ahmad',darimi:'the_9_books/darimi',
  nawawi40:'forties/nawawi40',qudsi40:'forties/qudsi40',shahwaliullah40:'forties/shahwaliullah40',
  riyadussalihin:'other_books/riyad_assalihin',mishkat_almasabih:'other_books/mishkat_almasabih',aladab_almufrad:'other_books/aladab_almufrad',shamail_muhammadiyah:'other_books/shamail_muhammadiyah',bulugh_almaram:'other_books/bulugh_almaram',
};

function asRecord(value:unknown):Record<string,unknown>|undefined{return typeof value==='object'&&value!==null?value as Record<string,unknown>:undefined;}
function cleanText(value:string):string{
  const normalized=value.replace(/\\n/gu,' ').replace(/\r?\n/gu,' ').replace(/\s+/gu,' ').trim();
  return normalized.replace(/:/gu,(colon,index,text)=>{
    const before=text[index-1]??'';
    const after=text[index+1]??'';
    if(/\d/u.test(before)&&/\d/u.test(after))return colon;
    return after&&!/\s/u.test(after)?`${colon} `:colon;
  });
}
function asText(value:unknown):string|undefined{if(typeof value!=='string')return undefined;const cleaned=cleanText(value);return cleaned||undefined;}
function pickBookData(raw:unknown):unknown[]{if(Array.isArray(raw))return raw;const r=asRecord(raw);if(!r)return [];for(const key of ['data','hadiths','items'])if(Array.isArray(r[key]))return r[key] as unknown[];return [];}
// This provider deliberately caches the complete downloaded book. The source format
// is book-oriented, so caching only one extracted Hadith would force an expensive
// whole-book download again for the next number. Book caching also naturally makes
// range extraction local once the initial book download succeeds.
export class HadithJsonProvider implements HadithProvider{
  readonly metadata:ProviderMetadata={id:'hadith-json',name:'Hadith JSON',kind:'hadith',baseUrl:BASE,projectUrl:'https://github.com/AhmedBaset/hadith-json'};
  readonly capabilities:ProviderCapabilities={arabicText:true,englishTranslation:true,multipleTranslations:false,collectionListing:true,rangeRetrieval:true,grading:false,metadata:true,directSourceUrls:true,search:false};
  private readonly bookMemoryCache=new Map<string,unknown>();
  private readonly bookIndexCache=new Map<string,{source:unknown;index:Map<number,unknown>}>();
  private readonly maxMemoryBooks=3;
  private readonly bookLoads=new Map<string,Promise<unknown>>();
  constructor(private readonly http:HttpClient,private readonly cacheEnabled:()=>boolean=()=>true,private readonly offline?:OfflineDatabaseStore,private readonly persistentCache?:PersistentJsonStore){}
  async listCollections(_ctx:FetchContext):Promise<CollectionDefinition[]>{return COLLECTIONS.map(x=>normalizeHadithCollectionMetadata(x));}
  async listTranslations(_ctx:FetchContext):Promise<TranslationDefinition[]>{return [{...TRANSLATION}];}
  async listOfflineDatabases(_ctx:FetchContext):Promise<OfflineDatabaseDefinition[]>{return COLLECTIONS.map(c=>({id:`hadith-json:${c.id}`,providerId:this.metadata.id,kind:'hadith',label:c.name,description:`Arabic and English hadith database for ${c.name}, pinned to hadith-json v1.2.0.`,parts:[{id:'book',label:c.name,url:`${BASE}/db/by_book/${BOOK_PATHS[c.id]}.json`,fileName:'book.json'}]}));}

  async fetchHadith(reference:HadithReference,translation:TranslationDefinition,ctx:FetchContext):Promise<HadithResult>{
    if(typeof reference.hadithNumber!=='number') throw new AppError('Alphabetic Hadith references are not supported by Hadith JSON.','validation');
    const collection=this.getCollection(reference.collectionId);
    this.validateTranslation(translation);
    const data=await this.loadBook(collection.id,ctx);
    return this.parseFromBook(reference,collection,translation,data);
  }
  async fetchHadithRange(reference:HadithReference,translation:TranslationDefinition,ctx:FetchContext):Promise<HadithResult[]>{
    const collection=this.getCollection(reference.collectionId);
    this.validateTranslation(translation);
    const end=reference.endHadithNumber??reference.hadithNumber;
    if(typeof reference.hadithNumber!=='number' || typeof end!=='number') throw new AppError('Alphabetic Hadith references are not supported by Hadith JSON.','validation');
    if(end<reference.hadithNumber)throw new AppError('Hadith range end must not be before its start.','validation');
    const data=await this.loadBook(collection.id,ctx);
    const results:HadithResult[]=[];
    for(let number=reference.hadithNumber;number<=end;number++)results.push(this.parseFromBook({kind:'hadith',collectionId:collection.id,hadithNumber:number},collection,translation,data));
    return results;
  }

  private getCollection(id:string):CollectionDefinition{const collection=COLLECTIONS.find(c=>c.id===id);if(!collection)throw new AppError('Unknown collection.','validation');return collection;}
  private validateTranslation(translation:TranslationDefinition):void{if(translation.providerId!==this.metadata.id||translation.id!=='en')throw new AppError('Translation is not supported by Hadith JSON.','validation');}
  private persistentKey(collectionId:string):string{return `hadith-json:${DATASET_VERSION}:${collectionId}:book`;}

  private rememberBook(collectionId:string,data:unknown):void{
    // A full Hadith JSON book can be much larger than an individual Hadith.
    // Keep only a few hot books in RAM while retaining all downloaded books on disk.
    this.bookMemoryCache.delete(collectionId);
    this.bookMemoryCache.set(collectionId,data);
    while(this.bookMemoryCache.size>this.maxMemoryBooks){
      const oldest=this.bookMemoryCache.keys().next().value as string|undefined;
      if(oldest===undefined)break;
      this.bookMemoryCache.delete(oldest);
      this.bookIndexCache.delete(oldest);
    }
  }

  /**
   * Build a number -> raw-record index once per cached book object. Hadith JSON is
   * book-oriented, so repeated Array.find() calls would rescan the whole book for
   * every lookup. One O(book-size) pass followed by O(1) lookups is cheaper for
   * ranges/repeated requests; source identity prevents stale indexes.
   */
  private indexBook(collectionId:string,data:unknown):Map<number,unknown>{
    const existing=this.bookIndexCache.get(collectionId);
    if(existing && existing.source===data){
      const cachedIndex=existing.index;
      this.bookIndexCache.delete(collectionId);
      this.bookIndexCache.set(collectionId,existing);
      return cachedIndex;
    }
    const index=new Map<number,unknown>();
    const items=pickBookData(data);
    items.forEach((value,position)=>{
      // These files are already split by book, and their IDs are not consistently
      // book-scoped across collections. The displayed/requested number is the
      // one-based position in this book's array.
      const number=position+1;
      if(!index.has(number)) index.set(number,value);
    });
    this.bookIndexCache.set(collectionId,{source:data,index});
    while(this.bookIndexCache.size>this.maxMemoryBooks){
      const oldest=this.bookIndexCache.keys().next().value as string|undefined;
      if(oldest===undefined)break;
      this.bookIndexCache.delete(oldest);
    }
    return index;
  }

  /**
   * Resolve a complete book through the layered offline/memory/persistent/network
   * strategy. `bookLoads` is the single-flight guard that prevents concurrent calls
   * for the same collection from downloading the same large JSON file twice.
   */
  private async loadBook(collectionId:string,ctx:FetchContext):Promise<unknown>{
    // Installed database is authoritative and is deliberately checked first.
    const offline=await this.offline?.getJson<unknown>(`hadith-json:${collectionId}`,'book');
    if(offline!==null&&offline!==undefined)return offline;

    if(this.cacheEnabled()){
      const memory=this.bookMemoryCache.get(collectionId);
      if(memory!==undefined){
        // Touch the book so the small in-memory book cache behaves as LRU.
        this.bookMemoryCache.delete(collectionId);
        this.bookMemoryCache.set(collectionId,memory);
        return memory;
      }
    }

    // Single-flight the persistent lookup and network fetch together so concurrent
    // requests cannot all miss the same persistent entry and re-download the book.
    const existingLoad=this.bookLoads.get(collectionId);
    if(existingLoad)return existingLoad;

    const load=(async():Promise<unknown>=>{
      if(this.cacheEnabled()){
        const persistent=await this.persistentCache?.get<unknown>(this.persistentKey(collectionId));
        if(persistent!==null&&persistent!==undefined){this.rememberBook(collectionId,persistent);return persistent;}
      }

      const path=BOOK_PATHS[collectionId];
      if(!path)throw new AppError('Unknown collection.','validation');
      const raw=await this.http.getJson<unknown>(`${BASE}/db/by_book/${path}.json`,ctx.signal);
      const data=raw.json;
      if(this.cacheEnabled()){
        this.rememberBook(collectionId,data);
        await setPersistentCacheBestEffort(this.persistentCache, this.persistentKey(collectionId), data);
      }
      return data;
    })();
    this.bookLoads.set(collectionId,load);
    try{return await load;}finally{if(this.bookLoads.get(collectionId)===load)this.bookLoads.delete(collectionId);}
  }

  private parseFromBook(reference:HadithReference,collection:CollectionDefinition,translation:TranslationDefinition,data:unknown):HadithResult{
    if(typeof reference.hadithNumber!=='number') throw new AppError('Alphabetic Hadith references are not supported by Hadith JSON.','validation');
    // Build the numeric index once per hot book. A range request can otherwise scan
    // the complete book once for every Hadith, turning a 15-Hadith range into many
    // repeated O(book-size) searches. The bounded index is evicted with the book.
    const item=this.indexBook(collection.id,data).get(reference.hadithNumber);
    if(!item)throw new AppError(`Hadith ${reference.hadithNumber} was not found in ${collection.name}.`,'parse');
    const record=asRecord(item);const english=asRecord(record?.english);
    const arabic=asText(record?.arabic);const englishText=asText(english?.text);const narrator=asText(english?.narrator);
    const sourceUrl=`${BASE}/db/by_book/${BOOK_PATHS[collection.id]}.json`;
    return {kind:'hadith',reference,collectionName:collection.name,title:undefined,arabic,english:englishText,englishIsnad:narrator,grades:[],source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl,retrievedAt:new Date().toISOString(),collectionId:collection.id,collectionName:collection.name,translationId:translation.id,translationName:translation.name}};
  }

  // Health checks must stay lightweight: downloading a complete Bukhari file just to
  // prove GitHub reachability would be an unnecessary multi-megabyte operation.
  async healthCheck(ctx:FetchContext):Promise<ProviderHealth>{const started=performance.now();try{const r=await this.http.getText(`${BASE}/README.md`,ctx.signal);return{providerId:this.metadata.id,ok:true,status:r.status,latencyMs:Math.round(performance.now()-started)};}catch(e){const err=e as AppError;return{providerId:this.metadata.id,ok:false,status:err.status,latencyMs:Math.round(performance.now()-started),errorKind:['network','http','timeout','parse','unknown'].includes(err.kind)?err.kind as ProviderHealth['errorKind']:'unknown',message:err.userMessage};}}
}
