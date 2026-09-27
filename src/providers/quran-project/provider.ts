import type { FetchContext, ProviderHealth, QuranProvider } from '../../domain/provider';
import type { Ayah, ProviderCapabilities, ProviderMetadata, QuranReference, QuranResult, TranslationDefinition } from '../../domain/models';
import type { OfflineDatabaseDefinition, OfflineDatabaseStore } from '../../domain/offline';
import type { HttpClient } from '../../core/http';
import { AppError } from '../../core/errors';
import { makeCacheKey, MemoryCacheStore, SingleFlight, setCacheBestEffort } from '../../core/cache';
import { parseQuranProjectChapter, parseQuranProjectVerse } from './parser';
import { normalizeQuranTranslationMetadata } from '../../core/catalog';
import { mapWithConcurrency, shouldFetchWholeQuranSurah } from '../../core/fetch';

const BASE = 'https://quranapi.pages.dev/api';
const TRANSLATIONS: readonly TranslationDefinition[] = [
  {id:'en', language:'en', name:'English', providerId:'quran-project'},
  {id:'bn', language:'bn', name:'Bengali', providerId:'quran-project'},
  {id:'ur', language:'ur', name:'Urdu', providerId:'quran-project'},
];
interface CachedAyah { surahName:string; ayah:Ayah; }

// The Quran Project API is a static JSON source. The adapter isolates its targeted
// verse and whole-chapter paths, then converts both into the same CachedAyah map so
// cache semantics stay identical regardless of which endpoint supplied the data.
/**
 * Quran Project adapter. Translation/language selection is resolved at this boundary;
 * downstream formatting and normalization never need to know the source's dataset
 * structure or identifiers.
 */
export class QuranProjectProvider implements QuranProvider {
  readonly metadata:ProviderMetadata={id:'quran-project', name:'Quran Project API', kind:'quran', baseUrl:'https://quranapi.pages.dev', projectUrl:'https://github.com/The-Quran-Project/Quran-API'};
  readonly capabilities:ProviderCapabilities={arabicText:true, englishTranslation:true, multipleTranslations:true, collectionListing:false, rangeRetrieval:true, grading:false, metadata:true, directSourceUrls:true, search:false};
  private readonly cache=new MemoryCacheStore();
  private readonly verseLoads=new SingleFlight<CachedAyah>();
  private readonly chapterLoads=new SingleFlight<ReturnType<typeof parseQuranProjectChapter>>();
  private readonly offline?:OfflineDatabaseStore;
  constructor(private readonly http:HttpClient, private readonly cacheEnabled:()=>boolean=()=>true, offline?:OfflineDatabaseStore) { this.offline=offline; }

  async listTranslations(_ctx:FetchContext):Promise<TranslationDefinition[]> { return TRANSLATIONS.map(normalizeQuranTranslationMetadata); }

  async listOfflineDatabases(_ctx:FetchContext):Promise<OfflineDatabaseDefinition[]> {
    return [{id:'quran-project:complete',providerId:this.metadata.id,kind:'quran',category:'quran',categories:['quran','quran-translation'],label:'Quran Project — Complete Quran',description:'Complete Arabic Quran plus English, Bengali and Urdu translations across all 114 Surahs.',parts:Array.from({length:114},(_,index)=>({id:String(index+1),label:`Surah ${index+1}`,url:`${BASE}/${index+1}.json`,fileName:`${index+1}.json`}))}];
  }

  async fetchQuran(reference:QuranReference, translation:TranslationDefinition, ctx:FetchContext):Promise<QuranResult> {
    if(translation.providerId!==this.metadata.id || !TRANSLATIONS.some(item=>item.id===translation.id)) throw new AppError('Translation belongs to a different provider.','validation');
    const numbers=Array.from({length:reference.endAyah-reference.startAyah+1},(_,index)=>reference.startAyah+index);
    const cached=new Map<number,CachedAyah>();

    // Installed offline data is authoritative and takes priority over runtime cache/network.
    const offlineRaw=await this.offline?.getJson<unknown>('quran-project:complete',String(reference.surah));
    if(offlineRaw!==null&&offlineRaw!==undefined){
      const parsed=parseQuranProjectChapter(offlineRaw,reference);
      this.seedChapter(parsed,reference,translation,cached);
      return this.buildResult(reference,translation,cached,'offline');
    }

    if(this.cacheEnabled()){
      const entries=await Promise.all(numbers.map(async number=>({number,entry:await this.cache.get<CachedAyah>(this.cacheKey(reference.surah,number,translation.id))})));
      for(const {number,entry} of entries) if(entry?.value) cached.set(number,structuredClone(entry.value));
    }
    const missing=numbers.filter(number=>!this.hasComplete(cached.get(number)?.ayah));

    if(missing.length&&shouldFetchWholeQuranSurah(reference,missing.length,1,1,3)){
      const parsed=await this.loadChapter(reference.surah,ctx,reference);
      this.seedChapter(parsed,reference,translation,cached);
    } else if(missing.length){
      const fetched=await mapWithConcurrency(missing,4,number=>this.fetchVerse(reference.surah,number,translation,ctx));
      for(const value of fetched) cached.set(value.ayah.reference.startAyah,value);
      if(this.cacheEnabled()) for(const value of fetched) await setCacheBestEffort(this.cache,{version:1,key:this.cacheKey(reference.surah,value.ayah.reference.startAyah,translation.id),storedAt:Date.now(),value});
    }

    return this.buildResult(reference,translation,cached,'online');
  }

  private buildResult(reference:QuranReference,translation:TranslationDefinition,cached:Map<number,CachedAyah>,sourceMode:'offline'|'online'):QuranResult{
    const numbers=Array.from({length:reference.endAyah-reference.startAyah+1},(_,index)=>reference.startAyah+index);
    const ayahs=numbers.map(number=>cached.get(number)?.ayah).filter((ayah):ayah is Ayah=>Boolean(ayah));
    if(ayahs.length!==numbers.length) throw new AppError('No Quran text was found for the selected reference.','parse');
    const first=cached.get(reference.startAyah);
    const sourceUrl=sourceMode==='offline' ? `${BASE}/${reference.surah}.json` : (reference.startAyah===reference.endAyah ? `${BASE}/${reference.surah}/${reference.startAyah}.json` : `${BASE}/${reference.surah}.json`);
    return {kind:'quran',reference,surahName:first?.surahName??`Surah ${reference.surah}`,ayahs,source:{providerId:this.metadata.id,providerName:this.metadata.name,sourceUrl,retrievedAt:new Date().toISOString(),translationId:translation.id,translationName:translation.name}};
  }

  private cacheKey(surah:number,ayah:number,translation:string):string { return makeCacheKey({provider:this.metadata.id,surah,ayah,translation}); }
  private hasComplete(ayah:Ayah|undefined):boolean { return Boolean(ayah?.arabic&&ayah.translation?.text); }

  private seedChapter(parsed:ReturnType<typeof parseQuranProjectChapter>,reference:QuranReference,translation:TranslationDefinition,cached:Map<number,CachedAyah>):void{
    const languageMap=parsed.translations.get(translation.id);
    const allNumbers=new Set<number>([...parsed.arabic.keys(),...(languageMap?.keys() ?? [])]);
    for(const number of allNumbers){
      const arabic=parsed.arabic.get(number);const text=languageMap?.get(number);
      if(!arabic&&!text) continue;
      const value:CachedAyah={surahName:parsed.surahName,ayah:{reference:{kind:'quran',surah:reference.surah,startAyah:number,endAyah:number},...(arabic?{arabic}:{}),...(text?{translation:{id:translation.id,language:translation.language,name:translation.name,text,providerId:this.metadata.id}}:{})}};
      cached.set(number,value);
      if(this.cacheEnabled()) void setCacheBestEffort(this.cache,{version:1,key:this.cacheKey(reference.surah,number,translation.id),storedAt:Date.now(),value});
    }
  }

  private fetchVerse(surah:number,ayah:number,translation:TranslationDefinition,ctx:FetchContext):Promise<CachedAyah>{
    const key=`${surah}:${ayah}:${translation.id}`;
    return this.verseLoads.run(key, async()=>{
      const reference:QuranReference={kind:'quran',surah,startAyah:ayah,endAyah:ayah};
      const raw=await this.http.getJson<unknown>(`${BASE}/${surah}/${ayah}.json`,ctx.signal);
      const parsed=parseQuranProjectVerse(raw.json,reference,translation);
      if(!parsed.arabic&&!parsed.translation) throw new AppError('No Quran text was found for the selected reference.','parse',raw.status);
      return {surahName:parsed.surahName,ayah:{reference,...(parsed.arabic?{arabic:parsed.arabic}:{}),...(parsed.translation?{translation:{id:translation.id,language:translation.language,name:translation.name,text:parsed.translation,providerId:this.metadata.id}}:{})}};
    });
  }

  private loadChapter(surah:number,ctx:FetchContext,reference:QuranReference):Promise<ReturnType<typeof parseQuranProjectChapter>>{
    return this.chapterLoads.run(String(surah), async()=>{
      const raw=(await this.http.getJson<unknown>(`${BASE}/${surah}.json`,ctx.signal)).json;
      return parseQuranProjectChapter(raw,reference);
    });
  }

  async healthCheck(ctx:FetchContext):Promise<ProviderHealth>{
    const started=performance.now();
    // Probe one ayah instead of the complete Surah 1 file. This keeps health checks lightweight.
    try{const response=await this.http.getJson<unknown>(`${BASE}/1/1.json`,ctx.signal);return{providerId:this.metadata.id,ok:true,status:response.status,latencyMs:Math.round(performance.now()-started)};}
    catch(error){const err=error as AppError;return{providerId:this.metadata.id,ok:false,status:err.status,latencyMs:Math.round(performance.now()-started),errorKind:['network','http','timeout','parse','unknown'].includes(err.kind)?err.kind as ProviderHealth['errorKind']:'unknown',message:err.userMessage};}
  }
}
