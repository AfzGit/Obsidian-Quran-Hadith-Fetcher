import type { QuranReference, TranslationDefinition } from '../../domain/models';
import { SURAH_NAMES } from '../../core/quran';

export interface QuranProjectChapter {
  surahName?: unknown;
  surahNameArabic?: unknown;
  surahNo?: unknown;
  totalAyah?: unknown;
  english?: unknown;
  arabic1?: unknown;
  arabic2?: unknown;
  bengali?: unknown;
  urdu?: unknown;
}

function strings(value:unknown):string[]{return Array.isArray(value)?value.map(item=>typeof item==='string'?item.trim():'').filter(Boolean):[];}
function text(value:unknown):string|undefined{return typeof value==='string'&&value.trim()?value.trim():undefined;}

export function parseQuranProjectChapter(raw:unknown,reference:QuranReference):{
  surahName:string;arabic:Map<number,string>;translations:Map<string,Map<number,string>>;
}{
  const root=typeof raw==='object'&&raw!==null?raw as QuranProjectChapter:{};
  const arabic=strings(root.arabic1);const translations=new Map<string,Map<number,string>>();
  const add=(language:string,values:string[])=>{const map=new Map<number,string>();values.forEach((value,index)=>map.set(index+1,value));translations.set(language,map);};
  add('en',strings(root.english));add('bn',strings(root.bengali));add('ur',strings(root.urdu));
  return {surahName:typeof root.surahName==='string'&&root.surahName.trim()?root.surahName.trim():SURAH_NAMES[reference.surah-1]??`Surah ${reference.surah}`,arabic:new Map(arabic.map((value,index)=>[index+1,value])),translations};
}

export function parseQuranProjectVerse(raw:unknown,reference:QuranReference,translation:TranslationDefinition):{
  surahName:string;arabic?:string;translation?:string;
}{
  const root=typeof raw==='object'&&raw!==null?raw as Record<string,unknown>:{};
  const languageKey=translation.language==='bn'?'bengali':translation.language==='ur'?'urdu':'english';
  const surahName=text(root.surahName)??SURAH_NAMES[reference.surah-1]??`Surah ${reference.surah}`;
  return {surahName,arabic:text(root.arabic1),translation:text(root[languageKey])};
}

