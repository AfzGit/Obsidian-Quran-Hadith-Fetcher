import type { FetchContext, ProviderHealth, QuranProvider } from '../../domain/provider';
import type { Ayah, ProviderCapabilities, ProviderMetadata, QuranReference, QuranResult, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition } from '../../domain/offline';
import { AppError } from '../../core/errors';
import type { HttpClient } from '../../core/http';
import { normalizeLanguageCode } from '../../core/languages';
import { normalizeQuranTranslationMetadata } from '../../core/catalog';
import { MemoryCacheStore, SingleFlight, makeCacheKey, setCacheBestEffort } from '../../core/cache';
import { mapWithConcurrency, shouldFetchWholeQuranSurah } from '../../core/fetch';

const BASE_URL = 'https://api.alquran.cloud/v1';
const ARABIC_EDITION = 'quran-uthmani';

interface Edition { identifier?: string; language?: string; name?: string; englishName?: string; format?: string; type?: string; }
interface SurahResponse { number?: number; name?: string; englishName?: string; englishNameTranslation?: string; numberOfAyahs?: number; ayahs?: Array<{ numberInSurah?: number; text?: string }>; }
interface AyahEditionResponse { number?: number; numberInSurah?: number; identifier?: string; text?: string; edition?: { identifier?: string; language?: string; englishName?: string; name?: string }; surah?: { englishName?: string; name?: string }; ayah?: { numberInSurah?: number; text?: string; surah?: { englishName?: string; name?: string } }; }
interface CachedAyah { surahName:string; ayah:Ayah; }

function records(raw: unknown): Record<string, unknown> | undefined { return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : undefined; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function editionsFrom(raw: unknown): Edition[] { const r = records(raw); return r && Array.isArray(r.data) ? r.data.filter(x => typeof x === 'object' && x !== null) as Edition[] : []; }
function surahFrom(raw: unknown): SurahResponse | undefined { const r = records(raw); return r && records(r.data) ? r.data as SurahResponse : undefined; }
function ayahEditionsFrom(raw: unknown): AyahEditionResponse[] {
  const r = records(raw);
  if (!r) return [];
  const data = r.data;
  if (Array.isArray(data)) return data.filter(x => typeof x === 'object' && x !== null) as AyahEditionResponse[];
  if (records(data)) return [data as AyahEditionResponse];
  return [];
}

// Fetch strategy: use targeted ayah requests for short/missing ranges and switch
// to a whole-surah request only when the number of missing requests makes that
// cheaper. Every returned ayah is cached independently.
export class AlQuranCloudProvider implements QuranProvider {
  readonly metadata: ProviderMetadata = { id: 'alquran-cloud', name: 'Al Quran Cloud', kind: 'quran', baseUrl: 'https://alquran.cloud', projectUrl: 'https://alquran.cloud' };
  readonly capabilities: ProviderCapabilities = { arabicText: true, englishTranslation: true, multipleTranslations: true, collectionListing: false, rangeRetrieval: true, grading: false, metadata: true, directSourceUrls: true, search: false };
  private readonly cache = new MemoryCacheStore();
  private readonly ayahLoads = new SingleFlight<CachedAyah>();
  private readonly surahLoads = new SingleFlight<SurahResponse | undefined>();
  private translationsCache: TranslationDefinition[] | null = null;
  constructor(private readonly http: HttpClient, private readonly cacheEnabled:()=>boolean = ()=>true) {}

  async listTranslations(ctx: FetchContext): Promise<TranslationDefinition[]> {
    if (this.translationsCache) return this.translationsCache.map(x => ({ ...x }));
    const raw = await this.http.getJson<unknown>(`${BASE_URL}/edition/type/translation`, ctx.signal);
    const translations = editionsFrom(raw.json)
      .filter(e => e.format === 'text' && e.type === 'translation' && !!str(e.identifier))
      .map(e => normalizeQuranTranslationMetadata({ id: str(e.identifier)!, language: normalizeLanguageCode(str(e.language) ?? 'unknown'), name: str(e.name) ?? str(e.englishName) ?? str(e.identifier)!, author: str(e.englishName) ?? str(e.name) ?? str(e.identifier)!, providerId: this.metadata.id }));
    if (!translations.length) throw new AppError('No Quran translations were found from Al Quran Cloud.', 'parse', raw.status);
    translations.sort((a, b) => (a.id === 'en.hilali' ? -1 : b.id === 'en.hilali' ? 1 : a.name.localeCompare(b.name)));
    this.translationsCache = translations;
    return translations.map(x => ({ ...x }));
  }

  async listOfflineDatabases(_ctx: FetchContext): Promise<OfflineDatabaseDefinition[]> { return []; }

  async fetchQuran(reference: QuranReference, translation: TranslationDefinition, ctx: FetchContext): Promise<QuranResult> {
    if (translation.providerId !== this.metadata.id) throw new AppError('Translation belongs to a different provider.', 'validation');
    const numbers = Array.from({length: reference.endAyah - reference.startAyah + 1}, (_, index) => reference.startAyah + index);
    const cached = new Map<number, CachedAyah>();

    if (this.cacheEnabled()) {
      const entries = await Promise.all(numbers.map(async number => ({ number, entry: await this.cache.get<CachedAyah>(this.cacheKey(reference.surah, number, translation.id)) })));
      for (const {number, entry} of entries) if (entry?.value) cached.set(number, structuredClone(entry.value));
    }

    const missing = numbers.filter(number => !this.hasComplete(cached.get(number)?.ayah));
    if (missing.length) {
      if (shouldFetchWholeQuranSurah(reference, missing.length, 2, 2, 4)) {
        const [arabicRaw, translationRaw] = await Promise.all([
          this.loadSurah(reference.surah, ARABIC_EDITION, ctx),
          this.loadSurah(reference.surah, translation.id, ctx),
        ]);
        this.seedFromSurahs(reference.surah, reference, translation, arabicRaw, translationRaw, cached);
      } else {
        const fetched = await mapWithConcurrency(missing, 4, number => this.fetchAyah(reference.surah, number, translation, ctx));
        for (const value of fetched) cached.set(value.ayah.reference.startAyah, value);
        if (this.cacheEnabled()) {
          for (const value of fetched) await setCacheBestEffort(this.cache, {version:1,key:this.cacheKey(reference.surah, value.ayah.reference.startAyah, translation.id),storedAt:Date.now(),value});
        }
      }
    }

    const ayahs = numbers.map(number => cached.get(number)?.ayah).filter((ayah): ayah is Ayah => Boolean(ayah));
    if (ayahs.length !== numbers.length || !ayahs.some(ayah => ayah.arabic || ayah.translation)) throw new AppError('No Quran text was found for the selected reference.', 'parse');
    const first = cached.get(reference.startAyah);
    return {
      kind:'quran', reference, surahName:first?.surahName ?? `Surah ${reference.surah}`, ayahs,
      source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl:this.makeSourceUrl(reference, translation.id),retrievedAt:new Date().toISOString(),translationId:translation.id,translationName:translation.name},
    };
  }

  private cacheKey(surah:number,ayah:number,translation:string):string { return makeCacheKey({provider:this.metadata.id,surah,ayah,translation}); }
  private hasComplete(ayah:Ayah|undefined):boolean { return Boolean(ayah?.arabic && ayah.translation?.text); }

  private makeSourceUrl(reference:QuranReference, translationId:string):string {
    if (reference.startAyah === reference.endAyah) return `${BASE_URL}/ayah/${reference.surah}:${reference.startAyah}/editions/${encodeURIComponent(translationId)}`;
    return `${BASE_URL}/surah/${reference.surah}/${encodeURIComponent(translationId)}`;
  }

  private fetchAyahUrl(surah:number, ayah:number, edition:string):string {
    return `${BASE_URL}/ayah/${surah}:${ayah}/${encodeURIComponent(edition)}`;
  }

  private fetchAyah(surah:number, ayah:number, translation:TranslationDefinition, ctx:FetchContext):Promise<CachedAyah> {
    const key=`${surah}:${ayah}:${translation.id}`;
    return this.ayahLoads.run(key, async()=>{
      const reference:QuranReference={kind:'quran',surah,startAyah:ayah,endAyah:ayah};
      const [arabicRaw, translationRaw] = await Promise.all([
        this.http.getJson<unknown>(this.fetchAyahUrl(surah,ayah,ARABIC_EDITION),ctx.signal),
        this.http.getJson<unknown>(this.fetchAyahUrl(surah,ayah,translation.id),ctx.signal),
      ]);
      const arabicEntry=this.parseSingleAyah(arabicRaw.json,ARABIC_EDITION);
      const translationEntry=this.parseSingleAyah(translationRaw.json,translation.id);
      const arabic=arabicEntry.text;
      const translated=translationEntry.text;
      const surahName=arabicEntry.surahName ?? translationEntry.surahName;
      if(!arabic && !translated) throw new AppError('No Quran text was found for the selected reference.','parse',translationRaw.status);
      return {surahName:surahName ?? `Surah ${surah}`,ayah:{reference,...(arabic?{arabic}:{}),...(translated?{translation:{id:translation.id,language:translation.language,name:translation.name,text:translated,providerId:this.metadata.id}}:{})}};
    });
  }

  private loadSurah(surah:number, edition:string, ctx:FetchContext):Promise<SurahResponse|undefined>{
    return this.surahLoads.run(`${surah}:${edition}`, async()=>{
      const raw=await this.http.getJson<unknown>(`${BASE_URL}/surah/${surah}/${encodeURIComponent(edition)}`, ctx.signal);
      return surahFrom(raw.json);
    });
  }

  private parseSingleAyah(raw:unknown,expectedEdition:string):{text?:string;surahName?:string}{
    const entries=ayahEditionsFrom(raw);
    for(const entry of entries){
      const edition=records(entry.edition);
      const nestedAyah=records(entry.ayah);
      const ayah=nestedAyah ?? entry as unknown as Record<string, unknown>;
      const id=str(entry.identifier) ?? str(edition?.identifier);
      if(id!==expectedEdition) continue;
      const surah=records(ayah.surah) ?? records(entry.surah);
      return {text:str(ayah.text),surahName:str(surah?.englishName) ?? str(surah?.name)};
    }
    return {};
  }

  private seedFromSurahs(surah:number, reference:QuranReference, translation:TranslationDefinition, arabic:SurahResponse|undefined, translated:SurahResponse|undefined, cached:Map<number,CachedAyah>):void {
    const arabicMap=new Map((arabic?.ayahs ?? []).map(item=>[item.numberInSurah ?? -1,item.text ?? '']));
    const translationMap=new Map((translated?.ayahs ?? []).map(item=>[item.numberInSurah ?? -1,item.text ?? '']));
    const surahName=str(translated?.englishName) ?? str(arabic?.englishName) ?? `Surah ${surah}`;
    const numbers=new Set<number>([...arabicMap.keys(),...translationMap.keys()]);
    for(const number of numbers){
      if(number<1) continue;
      const arabicText=str(arabicMap.get(number));
      const translatedText=str(translationMap.get(number));
      if(!arabicText && !translatedText) continue;
      const value:CachedAyah={surahName,ayah:{reference:{kind:'quran',surah,startAyah:number,endAyah:number},...(arabicText?{arabic:arabicText}:{}),...(translatedText?{translation:{id:translation.id,language:translation.language,name:translation.name,text:translatedText,providerId:this.metadata.id}}:{})}};
      cached.set(number,value);
      if(this.cacheEnabled()) void setCacheBestEffort(this.cache, {version:1,key:this.cacheKey(surah,number,translation.id),storedAt:Date.now(),value});
    }
    if(!numbers.size && reference.startAyah <= reference.endAyah) throw new AppError('No Quran text was found for the selected reference.','parse');
  }

  async healthCheck(ctx: FetchContext): Promise<ProviderHealth> {
    const started = performance.now();
    // Probe one small Arabic ayah. A health check should not download the full edition catalog.
    try { const r = await this.http.getJson<unknown>(`${BASE_URL}/ayah/1:1/quran-uthmani`, ctx.signal); return { providerId:this.metadata.id,ok:true,status:r.status,latencyMs:Math.round(performance.now()-started) }; }
    catch(e) { const err=e as AppError; return { providerId:this.metadata.id,ok:false,status:err.status,latencyMs:Math.round(performance.now()-started),errorKind:['network','http','timeout','parse','unknown'].includes(err.kind) ? err.kind as ProviderHealth['errorKind'] : 'unknown',message:err.userMessage }; }
  }
}
