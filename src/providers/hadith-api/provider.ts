import type { FetchContext, HadithProvider, ProviderHealth } from '../../domain/provider';
import type { CollectionDefinition, HadithReference, HadithResult, ProviderCapabilities, ProviderMetadata, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore } from '../../domain/offline';
import type { HttpClient } from '../../core/http';
import { AppError } from '../../core/errors';
import { makeCacheKey, MemoryCacheStore, SingleFlight, setCacheBestEffort } from '../../core/cache';
import { parseHadithApiResponse } from './parser';
import { HADITH_API_COLLECTIONS } from './collections';
import { normalizeHadithCollectionMetadata } from '../../core/catalog';

const BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1';
const EDITIONS_URL = `${BASE}/editions.min.json`;


function languageCode(value:string, fallback:string):string {
  const map:Record<string,string>={english:'en',bengali:'bn',french:'fr',indonesian:'id',russian:'ru',turkish:'tr',urdu:'ur',persian:'fa'};
  return map[value.toLowerCase()] ?? fallback;
}

// Hadith API uses targeted `/edition/hadith` retrieval. Ranges are therefore a set
// of individual lookups, but offline/cache hits are removed first so a range never
// causes unnecessary network requests for data already stored locally.
/**
 * hadith-api adapter. Some collections expose Arabic and translations separately, so
 * this layer coordinates those resources before the parser returns one HadithResult.
 */
export class HadithApiProvider implements HadithProvider {
  readonly metadata: ProviderMetadata = { id: 'hadith-api', name: 'hadith-api', kind: 'hadith', baseUrl: BASE, projectUrl:'https://github.com/fawazahmed0/hadith-api' };
  readonly capabilities: ProviderCapabilities = { arabicText: true, englishTranslation: true, multipleTranslations: true, collectionListing: true, rangeRetrieval: true, grading: true, metadata: true, directSourceUrls: true, search: false };
  private readonly cache = new MemoryCacheStore();
  private readonly hadithLoads = new SingleFlight<HadithResult>();
  private collectionsCache: CollectionDefinition[] | null = null;
  private translationsCache: TranslationDefinition[] | null = null;
  constructor(private readonly http: HttpClient, private readonly cacheEnabled: () => boolean = () => true, private readonly offline?: OfflineDatabaseStore) {}

  async listCollections(ctx: FetchContext): Promise<CollectionDefinition[]> {
    if (this.collectionsCache) return this.collectionsCache.map(x=>({...x}));
    try {
      const raw=await this.http.getJson<unknown>(EDITIONS_URL,ctx.signal);
      const root=raw.json && typeof raw.json==='object' ? raw.json as Record<string,unknown> : {};
      const fallbackById=new Map(HADITH_API_COLLECTIONS.map(item=>[item.id,item]));
      const discovered:CollectionDefinition[]=[];
      for(const [bookId,value] of Object.entries(root)){
        if(!value || typeof value!=='object') continue;
        const book=value as Record<string,unknown>;
        const collection=Array.isArray(book.collection) ? book.collection : [];
        const editions=collection.filter(item=>item && typeof item==='object') as Record<string,unknown>[];
        const arabic=editions.find(item=>typeof item.name==='string' && /^Arabic$/iu.test(String(item.language ?? '')));
        const english=editions.find(item=>typeof item.name==='string' && /^English$/iu.test(String(item.language ?? '')));
        const fallback=fallbackById.get(bookId);
        const name=typeof book.name==='string' && book.name.trim() ? book.name.trim() : fallback?.name;
        if(!name) continue;
        const arabicEdition=typeof arabic?.name==='string' ? arabic.name : fallback?.arabicEdition;
        const englishEdition=typeof english?.name==='string' ? english.name : fallback?.englishEdition;
        const rawAuthor=typeof english?.author==='string' && english.author.trim() && !/^unknown$/iu.test(english.author.trim()) ? english.author.trim() : fallback?.author;
        discovered.push(normalizeHadithCollectionMetadata({id:bookId,name,providerId:this.metadata.id,author:rawAuthor,arabicEdition,englishEdition}));
      }
      if(discovered.length) this.collectionsCache=discovered.sort((a,b)=>a.name.localeCompare(b.name));
      else this.collectionsCache=HADITH_API_COLLECTIONS.map(x=>normalizeHadithCollectionMetadata(x));
    } catch {
      this.collectionsCache=HADITH_API_COLLECTIONS.map(x=>normalizeHadithCollectionMetadata(x));
    }
    return this.collectionsCache.map(x=>({...x}));
  }

  async listTranslations(ctx: FetchContext): Promise<TranslationDefinition[]> {
    if (this.translationsCache) return this.translationsCache.map(x=>({...x}));
    let raw;
    try {
      raw=await this.http.getJson<unknown>(EDITIONS_URL,ctx.signal);
    } catch (error) {
      const installed=await this.offline?.listInstalled() ?? [];
      if(installed.some(item=>item.providerId===this.metadata.id && item.id.endsWith(':eng'))){
        const fallback:TranslationDefinition={id:'eng',language:'en',name:'English',providerId:this.metadata.id};
        this.translationsCache=[fallback];
        return [{...fallback}];
      }
      throw error;
    }
    const root=raw.json && typeof raw.json==='object' ? raw.json as Record<string,unknown> : {};
    const byCode=new Map<string,string>();
    for(const value of Object.values(root)){
      if(!value || typeof value!=='object') continue;
      const collection=(value as Record<string,unknown>).collection;
      if(!Array.isArray(collection)) continue;
      for(const entry of collection){
        if(!entry || typeof entry!=='object') continue;
        const item=entry as Record<string,unknown>;
        const edition=typeof item.name==='string'?item.name:'';
        const language=typeof item.language==='string'?item.language.trim():'';
        if(!edition || !language || /^Arabic$/iu.test(language)) continue;
        const code=edition.split('-')[0]?.trim().toLowerCase();
        if(code) byCode.set(code,language);
      }
    }
    const translations=[...byCode.entries()]
      .sort(([aId,aLanguage],[bId,bLanguage])=>{
        const aEnglish=aId==='eng' || /^english$/iu.test(aLanguage);
        const bEnglish=bId==='eng' || /^english$/iu.test(bLanguage);
        if(aEnglish!==bEnglish) return aEnglish ? -1 : 1;
        return aLanguage.localeCompare(bLanguage);
      })
      .map(([id,language])=>({id,language:languageCode(language,id),name:language,providerId:this.metadata.id}));
    if(!translations.some(t=>t.id==='eng' && t.language==='en')) translations.unshift({id:'eng',language:'en',name:'English',providerId:this.metadata.id});
    this.translationsCache=translations;
    return translations.map(x=>({...x}));
  }

  async listOfflineDatabases(_ctx: FetchContext): Promise<OfflineDatabaseDefinition[]> {
    return (await this.listCollections(_ctx)).filter(c=>c.arabicEdition&&c.englishEdition).map(c=>({id:`hadith-api:${c.id}:eng`,providerId:this.metadata.id,kind:'hadith',label:`${c.name} — English`,description:'Arabic and English full edition for offline use.',parts:[{id:'arabic',label:'Arabic',url:`${BASE}/editions/${c.arabicEdition}.min.json`,fileName:'arabic.json'},{id:'translation',label:'English',url:`${BASE}/editions/${c.englishEdition}.min.json`,fileName:'translation.json'}]}));
  }

  async fetchHadith(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult> {
    if(translation.providerId!==this.metadata.id) throw new AppError('Translation belongs to a different provider.','validation');
    const key = makeCacheKey({ provider: this.metadata.id, collection: reference.collectionId, hadith: reference.hadithNumber, translation: translation.id });
    return this.hadithLoads.run(key, async()=>this.fetchHadithCore(reference, translation, ctx, key));
  }

  private async fetchHadithCore(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext, key: string): Promise<HadithResult> {
    let ar = null; let en = null;
    let collection: CollectionDefinition | undefined;

    // Installed offline data has priority over both runtime cache and network.
    if(translation.id==='eng') {
      const offlineId=`hadith-api:${reference.collectionId}:eng`;
      const offlineArabic = await this.offline?.getJson<unknown>(offlineId,'arabic');
      const offlineEnglish = await this.offline?.getJson<unknown>(offlineId,'translation');
      if(offlineArabic != null && offlineEnglish != null) {
        ar={status:200,json:offlineArabic,headers:{}};
        en={status:200,json:offlineEnglish,headers:{}};
        collection=this.collectionsCache?.find(x=>x.id===reference.collectionId) ?? HADITH_API_COLLECTIONS.find(x=>x.id===reference.collectionId);
        if(!collection) collection={id:reference.collectionId,name:reference.collectionId,providerId:this.metadata.id};
      }
    }

    if(!collection && this.cacheEnabled()) {
      const cached = await this.cache.get<HadithResult>(key);
      if(cached) return structuredClone(cached.value);
    }

    if(!collection) {
      const collections = await this.listCollections(ctx);
      collection = collections.find(x => x.id === reference.collectionId);
    }
    if (!collection) throw new AppError('Unknown collection.', 'validation');

    const arabicEdition = collection.arabicEdition;
    const englishEdition = `${translation.id}-${reference.collectionId}`;
    if(!ar || !en) {
      [ar,en] = await Promise.all([
        arabicEdition ? this.getEditionHadith(arabicEdition, reference.hadithNumber, ctx.signal) : Promise.resolve(null),
        englishEdition ? this.getEditionHadith(englishEdition, reference.hadithNumber, ctx.signal) : Promise.resolve(null),
      ]);
    }
    const result = parseHadithApiResponse(ar?.json, en?.json, reference, collection.name, this.metadata.id, translation);
    if (this.cacheEnabled()) await setCacheBestEffort(this.cache, { version: 1, key, storedAt: Date.now(), value: result });
    return result;
  }

  async fetchHadithRange(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult[]> {
    const end = reference.endHadithNumber ?? reference.hadithNumber;
    if (end === reference.hadithNumber) return [await this.fetchHadith(reference, translation, ctx)];
    if (typeof reference.hadithNumber !== 'number' || typeof end !== 'number') {
      throw new AppError('Alphabetic Hadith ranges are not supported.','validation');
    }
    const results: HadithResult[] = [];
    const concurrency = 4;
    for (let start = reference.hadithNumber; start <= end; start += concurrency) {
      const batch = Array.from({length: Math.min(concurrency, end - start + 1)}, (_, index) => start + index);
      const batchResults = await Promise.all(batch.map(hadithNumber => this.fetchHadith({kind:'hadith',collectionId:reference.collectionId,hadithNumber}, translation, ctx)));
      results.push(...batchResults);
    }
    return results;
  }
  /**
   * Try the documented CDN first, then raw GitHub mirrors only for failures where
   * a mirror can realistically help. A 429 must not fan out into multiple mirrors:
   * the shared HTTP client has already honored Retry-After, and switching mirrors
   * would multiply load during an upstream rate-limit event. Authentication/
   * authorization failures likewise indicate that another mirror will not fix the
   * request.
   */
  private async getEditionHadith(edition: string, hadithNumber: number | string, signal: AbortSignal) {
    const urls = [
      `${BASE}/editions/${edition}/${encodeURIComponent(String(hadithNumber))}.min.json`,
      `${BASE}/editions/${edition}/${encodeURIComponent(String(hadithNumber))}.json`,
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/${edition}/${encodeURIComponent(String(hadithNumber))}.min.json`,
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/${edition}/${encodeURIComponent(String(hadithNumber))}.json`,
    ];
    let lastError: unknown;
    for (const url of urls) {
      if(signal.aborted) throw new DOMException('Aborted','AbortError');
      try {
        return await this.http.getJson<unknown>(url, signal);
      } catch (error) {
        lastError=error;
        if(signal.aborted) throw new DOMException('Aborted','AbortError');
        if(error instanceof AppError){
          if(error.kind==='cancelled') throw error;
          if(error.kind==='http' && [401,403,429].includes(error.status ?? 0)) throw error;
        }
      }
    }
    if(lastError) throw lastError;
    throw new AppError('Hadith API could not return the requested Hadith.','network');
  }

  async healthCheck(ctx: FetchContext): Promise<ProviderHealth> { const started = performance.now(); try { const r = await this.http.getJson<unknown>(`${BASE}/editions/eng-bukhari/1.min.json`, ctx.signal); return { providerId: this.metadata.id, ok: true, status: r.status, latencyMs: Math.round(performance.now()-started) }; } catch (e) { const err = e as AppError; return { providerId: this.metadata.id, ok:false, status:err.status, latencyMs:Math.round(performance.now()-started), errorKind: ['network','http','timeout','parse','unknown'].includes(err.kind) ? err.kind as 'network'|'http'|'timeout'|'parse'|'unknown' : 'unknown', message:err.userMessage }; } }
}
