import type { FetchContext, ProviderHealth, QuranProvider } from '../../domain/provider';
import type { Ayah, ProviderCapabilities, ProviderMetadata, QuranReference, QuranResult, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition } from '../../domain/offline';
import { AppError } from '../../core/errors';
import { MemoryCacheStore, SingleFlight, makeCacheKey, setCacheBestEffort } from '../../core/cache';
import { normalizeQuranTranslationMetadata } from '../../core/catalog';
import type { HttpClient } from '../../core/http';
import { parseQuranUnlockedResponse } from './parser';
import { contiguousRanges, mapWithConcurrency } from '../../core/fetch';

const TRANSLATIONS: TranslationDefinition[] = [
  { id: 'hilali-khan', language: 'en', name: "Interpretation of the Meanings of the Noble Quran", author: 'Muhammad Taqi-ud-Din Al-Hilali and Muhammad Muhsin Khan', providerId: 'quran-unlocked' },
  { id: 'en-haleem', language: 'en', name: "The Quran: A New Translation", author: 'M. A. S. Abdel Haleem', providerId: 'quran-unlocked' },
  { id: 'en-khattab', language: 'en', name: 'The Clear Quran', author: 'Mustafa Khattab', providerId: 'quran-unlocked' },
  { id: 'en-saheeh-intl', language: 'en', name: "The Holy Quran (Saheeh International)", author: 'Saheeh International', providerId: 'quran-unlocked' },
  { id: 'en-bridges', language: 'en', name: "Bridges' Translation of the Ten Qira'at of the Noble Quran", author: 'Bridges Translation Center', providerId: 'quran-unlocked' },
  { id: 'en-taqi-usmani', language: 'en', name: "The Meanings of the Noble Quran with Explanatory Notes", author: 'Mufti Taqi Usmani', providerId: 'quran-unlocked' },
  { id: 'en-itani', language: 'en', name: 'Quran in English: Clear and Easy to Read', author: 'Talal Itani', providerId: 'quran-unlocked' },
  { id: 'en-bewley', language: 'en', name: "The Noble Quran: A New Rendering of Its Meaning in English", author: 'Aisha Bewley', providerId: 'quran-unlocked' },
  { id: 'en-study-quran', language: 'en', name: 'The Study Quran: A New Translation and Commentary', author: 'Seyyed Hossein Nasr et al.', providerId: 'quran-unlocked' },
  { id: 'en-ghali', language: 'en', name: "Towards Understanding the Ever-glorious Quran", author: 'Muhammad Mahmud Ghali', providerId: 'quran-unlocked' },
  { id: 'en-ahmedraza', language: 'en', name: 'The Holy Quran', author: 'Ahmed Raza Khan', providerId: 'quran-unlocked' },
  { id: 'en-wahiduddin', language: 'en', name: 'The Quran: Translation and Commentary with Parallel Arabic Text', author: 'Wahiduddin Khan', providerId: 'quran-unlocked' },
  { id: 'en-qaribullah', language: 'en', name: "The Holy Quran", author: 'Hasan Al-Fatih Qaribullah and Ahmad Darwish', providerId: 'quran-unlocked' },
  { id: 'en-busool', language: 'en', name: "The Wise Quran: These Are the Verses of the Wise Book", author: 'Busool', providerId: 'quran-unlocked' },
  { id: 'en-tahir-ul-qadri', language: 'en', name: 'Irfan-ul-Quran', author: 'Tahir-ul-Qadri', providerId: 'quran-unlocked' },
  { id: 'en-rowwad', language: 'en', name: 'Explanation of the Meanings of the Noble Quran', author: 'Rowwad Translation Center', providerId: 'quran-unlocked' },
  { id: 'en-asad', language: 'en', name: "The Message of the Quran", author: 'Muhammad Asad', providerId: 'quran-unlocked' },
  { id: 'en-sarwar', language: 'en', name: "The Holy Quran: The Arabic Text and English Translation", author: 'Muhammad Sarwar', providerId: 'quran-unlocked' },
  { id: 'en-daryabadi', language: 'en', name: 'Tafseer-e-Majidi', author: 'Abdul Majid Daryabadi', providerId: 'quran-unlocked' },
  { id: 'en-shakir', language: 'en', name: "The Quran", author: 'Mohammad Habib Shakir', providerId: 'quran-unlocked' },
  { id: 'en-pickthall', language: 'en', name: 'The Meaning of the Glorious Koran', author: 'Mohammed Marmaduke William Pickthall', providerId: 'quran-unlocked' },
  { id: 'en-qarai', language: 'en', name: "The Quran with an English Paraphrase", author: 'Ali Quli Qarai', providerId: 'quran-unlocked' },
  { id: 'yusuf-ali', language: 'en', name: "The Meaning of the Holy Quran", author: 'Abdullah Yusuf Ali', providerId: 'quran-unlocked' },
];

interface CachedAyah { surahName:string; ayah:Ayah; }

/**
 * Quran Unlocked adapter. URL construction, request details, and response quirks are
 * deliberately kept here so provider-specific behavior cannot leak into the core.
 */
export class QuranUnlockedProvider implements QuranProvider {
  readonly metadata: ProviderMetadata = { id: 'quran-unlocked', name: 'Quran Unlocked', kind: 'quran', baseUrl: 'https://quran.islamunlocked.com', projectUrl: 'https://quran.islamunlocked.com/quran' };
  readonly capabilities: ProviderCapabilities = { arabicText: true, englishTranslation: true, multipleTranslations: true, collectionListing: false, rangeRetrieval: true, grading: false, metadata: true, directSourceUrls: true, search: false };
  private readonly cache = new MemoryCacheStore();
  private readonly rangeLoads = new SingleFlight<QuranResult>();
  constructor(private readonly http: HttpClient, private readonly cacheEnabled: () => boolean = () => true) {}
  async listTranslations(_ctx: FetchContext): Promise<TranslationDefinition[]> { return TRANSLATIONS.map(normalizeQuranTranslationMetadata); }
  async listOfflineDatabases(_ctx: FetchContext): Promise<OfflineDatabaseDefinition[]> { return []; }

  async fetchQuran(reference: QuranReference, translation: TranslationDefinition, ctx: FetchContext): Promise<QuranResult> {
    if(translation.providerId!==this.metadata.id) throw new AppError('Translation belongs to a different provider.','validation');
    const numbers=Array.from({length:reference.endAyah-reference.startAyah+1},(_,i)=>reference.startAyah+i);
    const cached=new Map<number,CachedAyah>();
    if(this.cacheEnabled()){
      const entries=await Promise.all(numbers.map(async number=>({number,entry:await this.cache.get<CachedAyah>(this.cacheKey(reference.surah,number,translation.id))})));
      for(const {number,entry} of entries) if(entry?.value) cached.set(number,structuredClone(entry.value));
    }
    const missing=numbers.filter(number=>!cached.has(number));
    if(missing.length){
      const ranges=contiguousRanges(missing);
      const fetched=await mapWithConcurrency(ranges,4,range=>this.fetchRange(reference.surah,range.start,range.end,translation,ctx));
      for(const result of fetched){
        for(const ayah of result.ayahs){
          const value={surahName:result.surahName,ayah};
          cached.set(ayah.reference.startAyah,value);
          if(this.cacheEnabled()) await setCacheBestEffort(this.cache,{version:1,key:this.cacheKey(reference.surah,ayah.reference.startAyah,translation.id),storedAt:Date.now(),value});
        }
      }
    }
    const ayahs=numbers.map(number=>cached.get(number)?.ayah).filter((ayah):ayah is Ayah=>Boolean(ayah));
    if(ayahs.length!==numbers.length) throw new AppError('No Quran text was found for the selected reference.','parse');
    const first=cached.get(reference.startAyah);
    return {kind:'quran',reference,surahName:first?.surahName??`Surah ${reference.surah}`,ayahs,source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl:this.makeSourceUrl(reference,translation.id),retrievedAt:new Date().toISOString(),translationId:translation.id,translationName:translation.name}};
  }

  private cacheKey(surah:number,ayah:number,translation:string):string{return makeCacheKey({provider:this.metadata.id,surah,ayah,translation});}

  private makeSourceUrl(reference:QuranReference,translationId:string):string{
    const routeId=translationId==='hilali-khan' ? 'en-hilali-khan' : translationId;
    return `${this.metadata.baseUrl}/quran/${routeId}/quran:${reference.surah}:${reference.startAyah}${reference.endAyah>reference.startAyah?`-${reference.endAyah}`:''}`;
  }

  private fetchRange(surah:number,startAyah:number,endAyah:number,translation:TranslationDefinition,ctx:FetchContext):Promise<QuranResult>{
    const sourceReference:QuranReference={kind:'quran',surah,startAyah,endAyah};
    const sourceUrl=this.makeSourceUrl(sourceReference,translation.id);
    const key=`${sourceUrl}?json`;
    return this.rangeLoads.run(key, async()=>{
      const raw=await this.http.getJson<unknown>(`${sourceUrl}?json`,ctx.signal);
      const parsed=parseQuranUnlockedResponse(raw.json,sourceReference,translation);
      if(parsed.ayahs.length===0) throw new AppError('No Quran text was found for the selected reference.','parse',raw.status);
      return {...parsed,source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl,retrievedAt:new Date().toISOString(),translationId:translation.id,translationName:translation.name}};
    });
  }

  async healthCheck(ctx: FetchContext): Promise<ProviderHealth> {
    const started = performance.now();
    // Probe one translated ayah instead of the root Quran JSON so diagnostics stay small.
    try { const r = await this.http.getJson<unknown>(`${this.metadata.baseUrl}/quran/en-hilali-khan/quran:1:1?json`, ctx.signal); return { providerId: this.metadata.id, ok: true, status: r.status, latencyMs: Math.round(performance.now() - started) }; }
    catch (e) { const err = e as AppError; return { providerId: this.metadata.id, ok: false, status: err.status, latencyMs: Math.round(performance.now() - started), errorKind: ['network','http','timeout','parse','unknown'].includes(err.kind) ? err.kind as 'network'|'http'|'timeout'|'parse'|'unknown' : 'unknown', message: err.userMessage }; }
  }
}
