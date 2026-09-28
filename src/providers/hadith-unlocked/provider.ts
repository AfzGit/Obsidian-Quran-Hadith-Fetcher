import type { FetchContext, HadithProvider, ProviderHealth } from '../../domain/provider';
import type { CollectionDefinition, HadithReference, HadithResult, ProviderCapabilities, ProviderMetadata, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore } from '../../domain/offline';
import type { HttpClient } from '../../core/http';
import { AppError } from '../../core/errors';
import { parseHadithUnlockedResponse } from './parser';
import { HADITH_UNLOCKED_COLLECTIONS } from './collections';
import { MemoryCacheStore, SingleFlight, makeCacheKey, setCacheBestEffort } from '../../core/cache';
import { normalizeHadithCollectionMetadata } from '../../core/catalog';

/**
 * Hadith Unlocked adapter. Collection IDs and response quirks remain local to the
 * provider; application code works exclusively with shared domain models.
 */
export class HadithUnlockedProvider implements HadithProvider {
  readonly metadata: ProviderMetadata = { id:'hadith-unlocked', name:'Hadith Unlocked', kind:'hadith', baseUrl:'https://hadithunlocked.com', projectUrl:'https://hadithunlocked.com' };
  readonly capabilities: ProviderCapabilities = { arabicText:true, englishTranslation:true, multipleTranslations:false, collectionListing:true, rangeRetrieval:true, grading:true, metadata:true, directSourceUrls:true, search:true };
  private readonly cache = new MemoryCacheStore();
  private readonly hadithLoads = new SingleFlight<HadithResult>();
  private collectionsCache: CollectionDefinition[] | null = null;
  constructor(private readonly http: HttpClient, private readonly cacheEnabled: () => boolean = () => true, private readonly offline?: OfflineDatabaseStore) {}

  async listCollections(_ctx: FetchContext): Promise<CollectionDefinition[]> {
    if (!this.collectionsCache) this.collectionsCache = HADITH_UNLOCKED_COLLECTIONS.map(x => normalizeHadithCollectionMetadata(x));
    return this.collectionsCache.map(x => ({...x}));
  }

  async listTranslations(_ctx: FetchContext): Promise<TranslationDefinition[]> { return [{id:'en',language:'en',name:'English',providerId:this.metadata.id}]; }
  async listOfflineDatabases(_ctx: FetchContext): Promise<OfflineDatabaseDefinition[]> {
    return (await this.listCollections(_ctx)).map(c=>({id:`hadith-unlocked:${c.id}`,providerId:this.metadata.id,kind:'hadith',label:c.name,description:`Complete Arabic and English ${c.name} database from Hadith Unlocked.`,parts:[{id:'book',label:c.name,url:`${this.metadata.baseUrl}/${c.id}.json`,fileName:'book.json'}]}));
  }


  async fetchHadith(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult> {
    const key = makeCacheKey({ provider: this.metadata.id, collection: reference.collectionId, hadith: reference.hadithNumber, translation: translation.id });
    return this.hadithLoads.run(key, async()=>{
      const collections = await this.listCollections(ctx);
      const collection = collections.find(x => x.id === reference.collectionId);
      if (!collection) throw new AppError('Unknown collection.', 'validation');
      if(translation.providerId!==this.metadata.id || translation.id!=='en') throw new AppError('Translation is not supported by Hadith Unlocked.','validation');

      const pageUrl = `${this.metadata.baseUrl}/${reference.collectionId}:${reference.hadithNumber}`;
      const offline = await this.offline?.getJson<unknown>(`hadith-unlocked:${collection.id}`,'book');
      if(offline!==null&&offline!==undefined) return parseHadithUnlockedResponse(offline,reference,collection,pageUrl);

      if (this.cacheEnabled()) {
        const cached = await this.cache.get<HadithResult>(key);
        if (cached) return structuredClone(cached.value);
      }
      const raw = (await this.http.getJson<unknown>(`${pageUrl}?json`, ctx.signal)).json;
      const result = parseHadithUnlockedResponse(raw, reference, collection, pageUrl);
      if (this.cacheEnabled()) await setCacheBestEffort(this.cache, { version: 1, key, storedAt: Date.now(), value: result });
      return result;
    });
  }

  async fetchHadithRange(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult[]> {
    const end = reference.endHadithNumber ?? reference.hadithNumber;
    if (end === reference.hadithNumber) return [await this.fetchHadith(reference, translation, ctx)];
    if (typeof reference.hadithNumber !== 'number' || typeof end !== 'number') {
      throw new AppError('Alphabetic Hadith ranges are not supported; enter a single reference such as 202a.','validation');
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

  async healthCheck(ctx: FetchContext): Promise<ProviderHealth> {
    const started=performance.now();
    // Probe one small Hadith JSON response instead of the collection index.
    try { const r=await this.http.getJson<unknown>(`${this.metadata.baseUrl}/bukhari:1?json`,ctx.signal); return {providerId:this.metadata.id,ok:true,status:r.status,latencyMs:Math.round(performance.now()-started)}; }
    catch(e) { const err=e as AppError; return {providerId:this.metadata.id,ok:false,status:err.status,latencyMs:Math.round(performance.now()-started),errorKind: ['network','http','timeout','parse','unknown'].includes(err.kind) ? err.kind as ProviderHealth['errorKind'] : 'unknown',message:err.userMessage}; }
  }
}
