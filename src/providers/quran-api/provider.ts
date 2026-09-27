import type { FetchContext, ProviderHealth, QuranProvider } from '../../domain/provider';
import type { Ayah, ProviderCapabilities, ProviderMetadata, QuranReference, QuranResult, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore } from '../../domain/offline';
import type { HttpClient } from '../../core/http';
import { AppError } from '../../core/errors';
import { MemoryCacheStore, SingleFlight, makeCacheKey, setCacheBestEffort } from '../../core/cache';
import { normalizeLanguageCode } from '../../core/languages';
import { parseQuranApiEdition } from './parser';
import { normalizeQuranTranslationMetadata } from '../../core/catalog';
import { mapWithConcurrency, shouldFetchWholeQuranSurah } from '../../core/fetch';

const BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1';
const EDITIONS_URL = `${BASE}/editions.min.json`;
const ARABIC_EDITION = 'ara-quranacademy';

interface EditionMeta { name?: string; author?: string; language?: string; link?: string; linkmin?: string; }
const DEFAULT_HILALI: TranslationDefinition = normalizeQuranTranslationMetadata({
  id:'eng-muhammadtaqiudd', language:'en', name:'Hilali-Khan',
  author:'Muhammad Taqi Ud Din Al Hilali And Muhammad Muhsin Khan', providerId:'quran-api',
});
interface CachedAyah { surahName:string; ayah:Ayah; }
function mergeCached(base:CachedAyah|undefined,extra:CachedAyah):CachedAyah {
  if(!base) return structuredClone(extra);
  return {surahName:extra.surahName||base.surahName,ayah:{...base.ayah,...extra.ayah,reference:base.ayah.reference,arabic:extra.ayah.arabic??base.ayah.arabic,translation:extra.ayah.translation??base.ayah.translation}};
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

// Fetch strategy mirrors the provider contract: targeted verse endpoints for
// small gaps, whole-chapter retrieval when that reduces request count, followed by
// per-ayah cache seeding so later overlapping requests become local reads.
/**
 * Quran API adapter with optional offline editions. API-specific response details
 * stay inside this provider/parser pair while callers receive only shared domain
 * models, keeping the rest of the plugin independent of this service's schema.
 */
export class QuranApiProvider implements QuranProvider {
  readonly metadata: ProviderMetadata = { id:'quran-api', name:'Quran API', kind:'quran', baseUrl:BASE, projectUrl:'https://github.com/fawazahmed0/quran-api' };
  readonly capabilities: ProviderCapabilities = { arabicText:true, englishTranslation:true, multipleTranslations:true, collectionListing:false, rangeRetrieval:true, grading:false, metadata:true, directSourceUrls:true, search:false };
  private readonly cache = new MemoryCacheStore();
  private readonly verseLoads = new SingleFlight<CachedAyah>();
  private readonly chapterLoads = new SingleFlight<ReturnType<typeof parseQuranApiEdition>>();
  private translationsCache: TranslationDefinition[] | null = null;
  constructor(private readonly http:HttpClient, private readonly cacheEnabled:()=>boolean=()=>true, private readonly offline?:OfflineDatabaseStore) {}

  async listTranslations(ctx:FetchContext):Promise<TranslationDefinition[]> {
    if(this.translationsCache) return this.translationsCache.map(x=>({...x}));
    let raw;
    try {
      raw=await this.http.getJson<unknown>(EDITIONS_URL,ctx.signal);
    } catch (error) {
      const installed=await this.offline?.listInstalled() ?? [];
      const installedTranslations=installed
        .filter(item=>item.providerId===this.metadata.id && item.id.startsWith('quran-api:') && item.id!=='quran-api:arabic')
        .map(item=>{
          const edition=item.id.slice('quran-api:'.length);
          const language=edition.split('-')[0]?.toLowerCase() || 'en';
          const separator=item.label.lastIndexOf(' — ');
          const author=separator>0 ? item.label.slice(0,separator) : item.label;
          return normalizeQuranTranslationMetadata({id:edition,language,name:author,author,providerId:this.metadata.id});
        });
      if(installedTranslations.length) return installedTranslations;
      throw error;
    }
    const root=object(raw.json) ?? {};
    const translations:TranslationDefinition[]=[];
    for(const value of Object.values(root)){
      const edition=object(value) as EditionMeta | undefined;
      if(!edition) continue;
      const id=typeof edition.name==='string' ? edition.name.trim() : '';
      const language=typeof edition.language==='string' ? edition.language.trim() : '';
      if(!id || !language || /^arabic$/iu.test(language)) continue;
      translations.push(normalizeQuranTranslationMetadata({id,language:normalizeLanguageCode(language),name:id,author:typeof edition.author==='string'&&edition.author.trim()?edition.author.trim():id,providerId:this.metadata.id}));
    }
    const unique=[...new Map(translations.map(t=>[`${t.language}\u0000${t.id}`,t])).values()];
    unique.sort((a,b)=>{
      const ah=/^en$/iu.test(a.language)&&/muhammadtaqiudd/iu.test(a.id);
      const bh=/^en$/iu.test(b.language)&&/muhammadtaqiudd/iu.test(b.id);
      if(ah!==bh) return ah ? -1 : 1;
      const ae=a.language==='en', be=b.language==='en';
      if(ae!==be) return ae ? -1 : 1;
      return a.author!.localeCompare(b.author!);
    });
    this.translationsCache=unique;
    return unique.map(x=>({...x}));
  }

  async listOfflineDatabases(ctx:FetchContext):Promise<OfflineDatabaseDefinition[]> {
    const translations=await this.listTranslations(ctx);
    return [
      {
        id:'quran-api:arabic',
        providerId:this.metadata.id,
        kind:'quran',
        category:'quran',
        categories:['quran'],
        label:'Quran Arabic — Quran Academy',
        description:'Complete Arabic Quran edition for offline use; shared by all Quran API translations.',
        parts:[{id:'arabic',label:'Arabic Quran',url:`${BASE}/editions/${ARABIC_EDITION}.min.json`,fileName:'arabic.json'}],
      },
      ...translations.map(t=>({
        id:`quran-api:${t.id}`,
        providerId:this.metadata.id,
        kind:'quran' as const,
        category:'quran-translation' as const,
        categories:['quran-translation'] as const,
        label:`${t.author ?? t.name} — ${t.language.toUpperCase()}`,
        description:`Complete ${t.language} translation for offline use.`,
        parts:[{id:'translation',label:`${t.author ?? t.name}`,url:`${BASE}/editions/${encodeURIComponent(t.id)}.min.json`,fileName:'translation.json'}],
      })),
    ];
  }

  async fetchQuran(reference:QuranReference, translation:TranslationDefinition, ctx:FetchContext):Promise<QuranResult>{
    if(translation.providerId!==this.metadata.id) throw new AppError('Translation belongs to a different provider.','validation');
    const numbers=Array.from({length:reference.endAyah-reference.startAyah+1},(_,i)=>reference.startAyah+i);
    const cached=new Map<number,CachedAyah>();

    const [offlineArabic,offlineTranslation]=await Promise.all([
      this.offline?.getJson<unknown>('quran-api:arabic','arabic'),
      this.offline?.getJson<unknown>(`quran-api:${translation.id}`,'translation'),
    ]);
    const arabicOffline=offlineArabic!==null&&offlineArabic!==undefined?parseQuranApiEdition(offlineArabic,reference):null;
    const translationOffline=offlineTranslation!==null&&offlineTranslation!==undefined?parseQuranApiEdition(offlineTranslation,reference):null;

    for(const number of numbers){
      const arabic=arabicOffline?.verses.get(number);
      const text=translationOffline?.verses.get(number);
      if(arabic||text) cached.set(number,this.makeCachedAyah(reference,number,translation,arabic,text,arabicOffline?.surahName));
    }

    const missing=numbers.filter(number=>{const ayah=cached.get(number)?.ayah;return !ayah?.arabic||!ayah.translation;});
    if(missing.length&&this.cacheEnabled()){
      const entries=await Promise.all(missing.map(async number=>({number,entry:await this.cache.get<CachedAyah>(this.cacheKey(reference.surah,number,translation.id))})));
      for(const {number,entry} of entries) if(entry?.value) cached.set(number,mergeCached(cached.get(number),entry.value));
    }
    const stillMissing=numbers.filter(number=>{const ayah=cached.get(number)?.ayah;return !ayah?.arabic||!ayah.translation;});

    if(stillMissing.length&&shouldFetchWholeQuranSurah(reference,stillMissing.length,2,2,4)){
      const [arabicRaw,translationRaw]=await Promise.all([this.loadChapter(ARABIC_EDITION,reference,ctx),this.loadChapter(translation.id,reference,ctx)]);
      const allNumbers=new Set<number>([...arabicRaw.verses.keys(),...translationRaw.verses.keys(),...stillMissing]);
      for(const number of allNumbers){
        const arabic=arabicRaw.verses.get(number);const text=translationRaw.verses.get(number);
        if(!arabic&&!text) continue;
        const value=this.makeCachedAyah(reference,number,translation,arabic,text,arabicRaw.surahName);
        cached.set(number,mergeCached(cached.get(number),value));
        if(this.cacheEnabled()) await setCacheBestEffort(this.cache, {version:1,key:this.cacheKey(reference.surah,number,translation.id),storedAt:Date.now(),value:cached.get(number)!});
      }
    } else if(stillMissing.length){
      const fetched=await mapWithConcurrency(stillMissing,4,number=>{
        const existing=cached.get(number)?.ayah;
        return this.fetchVerse(reference.surah,number,translation,ctx,!existing?.arabic,!existing?.translation);
      });
      for(const value of fetched){
        const number=value.ayah.reference.startAyah;
        const merged=mergeCached(cached.get(number),value);
        cached.set(number,merged);
        if(this.cacheEnabled()) await setCacheBestEffort(this.cache, {version:1,key:this.cacheKey(reference.surah,number,translation.id),storedAt:Date.now(),value:merged});
      }
    }

    const ayahs=numbers.map(number=>cached.get(number)?.ayah).filter((ayah):ayah is Ayah=>Boolean(ayah));
    if(ayahs.length!==numbers.length||!ayahs.some(a=>a.arabic||a.translation)) throw new AppError('No Quran text was found for the selected reference.','parse');
    const first=cached.get(reference.startAyah);
    return {kind:'quran',reference,surahName:first?.surahName??arabicOffline?.surahName??`Surah ${reference.surah}`,ayahs,source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl:this.makeSourceUrl(reference,translation.id),retrievedAt:new Date().toISOString(),translationId:translation.id,translationName:translation.name}};
  }

  private cacheKey(surah:number,ayah:number,translation:string):string{return makeCacheKey({provider:this.metadata.id,surah,ayah,translation});}

  private makeSourceUrl(reference:QuranReference,translationId:string):string{
    if(reference.startAyah===reference.endAyah) return `${BASE}/editions/${encodeURIComponent(translationId)}/${reference.surah}/${reference.startAyah}.json`;
    return `${BASE}/editions/${encodeURIComponent(translationId)}/${reference.surah}.json`;
  }

  private makeCachedAyah(reference:QuranReference,number:number,translation:TranslationDefinition,arabic?:string,text?:string,surahName?:string):CachedAyah{
    return {surahName:surahName??`Surah ${reference.surah}`,ayah:{reference:{kind:'quran',surah:reference.surah,startAyah:number,endAyah:number},...(arabic?{arabic}:{}),...(text?{translation:{id:translation.id,language:translation.language,name:translation.name,text,providerId:this.metadata.id}}:{})}};
  }

  private fetchVerse(surah:number,ayah:number,translation:TranslationDefinition,ctx:FetchContext,needArabic:boolean,needTranslation:boolean):Promise<CachedAyah>{
    const key=`${surah}:${ayah}:${translation.id}:ar=${needArabic}:en=${needTranslation}`;
    return this.verseLoads.run(key, async()=>{
      const reference:QuranReference={kind:'quran',surah,startAyah:ayah,endAyah:ayah};
      const [arabicRaw,translationRaw]=await Promise.all([
        needArabic?this.http.getJson<unknown>(`${BASE}/editions/${encodeURIComponent(ARABIC_EDITION)}/${surah}/${ayah}.min.json`,ctx.signal):Promise.resolve(null),
        needTranslation?this.http.getJson<unknown>(`${BASE}/editions/${encodeURIComponent(translation.id)}/${surah}/${ayah}.min.json`,ctx.signal):Promise.resolve(null),
      ]);
      const arabic=arabicRaw?parseQuranApiEdition(arabicRaw.json,reference):{surahName:`Surah ${surah}`,verses:new Map<number,string>()};
      const translated=translationRaw?parseQuranApiEdition(translationRaw.json,reference):{surahName:arabic.surahName,verses:new Map<number,string>()};
      const value=this.makeCachedAyah(reference,ayah,translation,arabic.verses.get(ayah),translated.verses.get(ayah),arabic.surahName);
      if(!value.ayah.arabic&&!value.ayah.translation) throw new AppError('No Quran text was found for the selected reference.','parse');
      return value;
    });
  }

  private loadChapter(edition:string,reference:QuranReference,ctx:FetchContext):Promise<ReturnType<typeof parseQuranApiEdition>>{
    const key=`${edition}:${reference.surah}`;
    return this.chapterLoads.run(key, async()=>{
      const url=`${BASE}/editions/${encodeURIComponent(edition)}/${reference.surah}.min.json`;
      const raw=await this.http.getJson<unknown>(url,ctx.signal);
      return parseQuranApiEdition(raw.json,reference);
    });
  }

  async healthCheck(ctx:FetchContext):Promise<ProviderHealth>{
    const started=performance.now();
    try{const r=await this.http.getJson<unknown>(`${BASE}/editions/${encodeURIComponent(ARABIC_EDITION)}/1/1.min.json`,ctx.signal);return{providerId:this.metadata.id,ok:true,status:r.status,latencyMs:Math.round(performance.now()-started)};}
    catch(e){const err=e as AppError;return{providerId:this.metadata.id,ok:false,status:err.status,latencyMs:Math.round(performance.now()-started),errorKind:['network','http','timeout','parse','unknown'].includes(err.kind)?err.kind as ProviderHealth['errorKind']:'unknown',message:err.userMessage};}
  }
}
