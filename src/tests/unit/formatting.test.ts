import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FORMATTING, formatQuran, formatHadith, formatHadithRange } from '../../core/formatting';
import type { HadithResult, QuranResult } from '../../domain/models';

const q:QuranResult={kind:'quran',reference:{kind:'quran',surah:2,startAyah:255,endAyah:257},surahName:'al-Baqarah',ayahs:[1,2,3].map((n)=>({reference:{kind:'quran',surah:2,startAyah:254+n,endAyah:254+n},arabic:`AR${n}`,translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:`EN${n}`,providerId:'quran-unlocked'}})),source:{providerId:'quran-unlocked',providerName:'Quran Unlocked',sourceUrl:'https://example/2/255',retrievedAt:'now'}};
const h:HadithResult={kind:'hadith',reference:{kind:'hadith',collectionId:'bukhari',hadithNumber:1},collectionName:'Sahih Al-Bukhari',arabic:'AR',english:'EN',grades:[{id:'g',text:'Sahih',author:'Albani'}],source:{providerId:'hadith-unlocked',providerName:'Hadith Unlocked',sourceUrl:'https://example/bukhari:1',retrievedAt:'now'}};


test('Quran range preserves requested block order',()=>{const out=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line'});assert.match(out,/AR1[\s\S]*AR2[\s\S]*AR3[\s\S]*EN1[\s\S]*EN2[\s\S]*EN3/);assert.match(out,/2:255-257/);});
test('Hadith formatting includes grading and link',()=>{const out=formatHadith(h,DEFAULT_FORMATTING,{arabic:true,english:true,grading:true});assert.match(out,/Sahih Al-Bukhari 1/);assert.match(out,/AR/);assert.match(out,/EN/);assert.match(out,/Sahih/);assert.match(out,/https:\/\/example\/bukhari:1/);});



test('Callout first line has exactly one space after the callout marker',()=>{
  const out=formatHadith(h,DEFAULT_FORMATTING,{arabic:false,english:true,grading:false});
  assert.match(out,/^> \[!Quote\] \[Sahih Al-Bukhari 1\]/);
  assert.doesNotMatch(out,/^> \[!Quote\]  /);
});

test('Callout can be disabled without leaving quote prefixes',()=>{
  const cfg={...DEFAULT_FORMATTING,callout:'none' as const};
  const out=formatQuran(q,cfg,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line'});
  assert.match(out,/^\[Surah Al-Baqarah/);
  assert.doesNotMatch(out,/^>/m);
});

test('Quran link prepends Surah when the provider name omits it',()=>{
  const out=formatQuran({...q,surahName:'Al-Baqarah'},DEFAULT_FORMATTING,{arabic:true,english:false,grading:false,quranRangeMode:'line-by-line'});
  assert.match(out,/\[Surah Al-Baqarah, 2:255-257\]/);
  const already=formatQuran({...q,surahName:'Surah Al-Baqarah'},DEFAULT_FORMATTING,{arabic:true,english:false,grading:false,quranRangeMode:'line-by-line'});
  assert.match(already,/\[Surah Al-Baqarah, 2:255-257\]/);
});

test('Hadith formatter uses Obsidian callout syntax and includes isnad before matn',()=>{
  const r:HadithResult={kind:'hadith',reference:{kind:'hadith',collectionId:'bukhari',hadithNumber:200},collectionName:'Sahih Al-Bukhari',arabicIsnad:'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا حَمَّادٌ عَنْ ثَابِتٍ عَنْ أَنَسٍ',arabic:'أَنَّ النَّبِيَّ ﷺ دَعَا بِإِنَاءٍ مِنْ مَاءٍ',grades:[],source:{providerId:'hadith-unlocked',providerName:'Hadith Unlocked',sourceUrl:'https://hadithunlocked.com/bukhari:200',retrievedAt:new Date(0).toISOString()}};
  const md=formatHadith(r,DEFAULT_FORMATTING,{arabic:true,english:false,grading:false});
  assert.match(md,/^> \[!Quote\]/);
  assert.match(md,/\n> حَدَّثَنَا مُسَدَّدٌ/);
  assert.match(md,/\n> أَنَّ النَّبِيَّ/);
});

test('Quran and Hadith separate Arabic and English with a blank quote line',()=>{
  const qout=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false});
  assert.match(qout, /> \{AR1\}\n> \{AR2\}\n> \{AR3\}\n>\n> \{EN1\}\n> \{EN2\}\n> \{EN3\}/);

  const hout=formatHadith(h,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false});
  assert.match(hout, /> AR\n>\n> EN/);
});



test('Quran ayah number formatting accepts custom closure symbols',()=>{
  const out=formatQuran(q,{...DEFAULT_FORMATTING,ayahNumberOpen:'❰',ayahNumberClose:'❱',arabicAyahNumbers:true},{arabic:true,english:false,grading:false,quranRangeMode:'merged'});
  assert.match(out,/❰٢٥٥❱/);
});

test('Quran ranged output supports merged ayahs with verse markers',()=>{
  const out=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'merged'});
  assert.match(out,/> \{⟪٢٥٥⟫ AR1 ⟪٢٥٦⟫ AR2 ⟪٢٥٧⟫ AR3\}\n>\n> \{⟪255⟫ EN1 ⟪256⟫ EN2 ⟪257⟫ EN3\}/);
});



test('Quran numbering uses Arabic digits by default and can be disabled',()=>{
  const arabic=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:false,grading:false,quranRangeMode:'merged'});
  assert.match(arabic,/⟪٢٥٥⟫ AR1/);
  const englishDigits=formatQuran(q,{...DEFAULT_FORMATTING,arabicAyahNumbers:false},{arabic:true,english:false,grading:false,quranRangeMode:'merged'});
  assert.match(englishDigits,/⟪255⟫ AR1/);
});

test('Quran ranged output supports alternating Arabic and English with numbering',()=>{
  const out=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'alternate'});
  assert.match(out,/> ٢٥٥: \{AR1\}\n>\n> 255: \{EN1\}\n>\n>\n> ٢٥٦: \{AR2\}\n>\n> 256: \{EN2\}/);
});

test('Quran ranged output supports numbered line-by-line blocks',()=>{
  const out=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'numbered'});
  assert.match(out,/> ٢٥٥: \{AR1\}\n>\n> 255: \{EN1\}\n>\n> ٢٥٦: \{AR2\}\n>\n> 256: \{EN2\}/);
});
test('Quran ranged output supports line-by-line Arabic then English blocks',()=>{
  const out=formatQuran(q,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line'});
  assert.match(out,/> \{AR1\}\n> \{AR2\}\n> \{AR3\}\n>\n> \{EN1\}\n> \{EN2\}\n> \{EN3\}/);
});

test('Hadith isnad can be separated independently for Arabic and English',()=>{
  const r:HadithResult={kind:'hadith',reference:{kind:'hadith',collectionId:'tirmidhi',hadithNumber:123},collectionName:"Jami' at-Tirmidhi",arabicIsnad:'AR ISNAD',arabic:'AR MATN',englishIsnad:'EN ISNAD',english:'EN MATN',grades:[],source:{providerId:'hadith-unlocked',providerName:'Hadith Unlocked',sourceUrl:'https://example/tirmidhi:123',retrievedAt:'now'}};
  const separate=formatHadith(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,hadithSeparateIsnad:true});
  assert.match(separate,/AR ISNAD\n> AR MATN\n>\n> EN ISNAD\n> EN MATN/);
  const combined=formatHadith(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,hadithSeparateIsnad:false});
  assert.match(combined,/AR ISNAD AR MATN\n>\n> EN ISNAD EN MATN/);
});

test('Hadith formatting includes English isnad and English grading label',()=>{
  const r:HadithResult={kind:'hadith',reference:{kind:'hadith',collectionId:'tirmidhi',hadithNumber:123},collectionName:"Jami' at-Tirmidhi",englishIsnad:'Narrated Aishah',english:'Sometimes the Prophet would perform Ghusl.',grades:[{id:'g',text:'Weak',author:'ʿAli Zaʾī'}],source:{providerId:'hadith-unlocked',providerName:'Hadith Unlocked',sourceUrl:'https://hadithunlocked.com/tirmidhi:123',retrievedAt:'now'}};
  const out=formatHadith(r,DEFAULT_FORMATTING,{arabic:false,english:true,grading:true});
  assert.match(out,/Narrated Aishah/);
  assert.match(out,/Sometimes the Prophet/);
  assert.match(out,/>\n> Grading: Weak \(ʿAli Zaʾī\)/);
});


test('Hadith formatter decodes HTML entities in collection names',()=>{
  const out=formatHadith({...h,collectionName:'Ibn Rajab&#39;s Fifty'},DEFAULT_FORMATTING,{arabic:true,english:false,grading:false});
  assert.match(out,/Ibn Rajab's Fifty 1/);
  assert.doesNotMatch(out,/&#39;/);
});

test('Hadith Bukhari and Muslim can render the default Sahih grade',()=>{
  const empty={...h,grades:[]};
  const bukhari=formatHadith(empty,DEFAULT_FORMATTING,{arabic:false,english:true,grading:true});
  assert.match(bukhari,/Grading: Not found/);
  const defaultSahih={...empty,grades:[{id:'default-sahih',text:'Sahih'}]};
  const rendered=formatHadith(defaultSahih,DEFAULT_FORMATTING,{arabic:false,english:true,grading:true});
  assert.match(rendered,/Grading: Sahih/);
});

test('Hadith grading renders compact single or nested multiple grades',()=>{
  const base:HadithResult={kind:'hadith',reference:{kind:'hadith',collectionId:'tirmidhi',hadithNumber:123},collectionName:"Jami' at-Tirmidhi",english:'EN',grades:[],source:{providerId:'hadith-api',providerName:'hadith-api',sourceUrl:'https://example',retrievedAt:'now'}};
  const single=formatHadith({...base,grades:[{id:'1',text:'Sahih',author:'Albani'}]},DEFAULT_FORMATTING,{arabic:false,english:true,grading:true});
  assert.match(single,/> Grading: Sahih \(Albani\)/);
  const multiple=formatHadith({...base,grades:[{id:'1',text:'Sahih',author:'Albani'},{id:'2',text:'Sahih',author:'2nd person'}]},DEFAULT_FORMATTING,{arabic:false,english:true,grading:true});
  assert.match(multiple,/> - Grading:\n>   - Sahih \(Albani\)\n>   - Sahih \(2nd person\)/);
});


test('Quran formatting optionally appends footnotes and keeps translation markers',()=>{
  const r:QuranResult={...q,reference:{...q.reference,startAyah:255,endAyah:255},ayahs:[{reference:{kind:'quran',surah:2,startAyah:255,endAyah:255},arabic:'AR',translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:'The Rabb[1] of the worlds.[2]',providerId:'quran-unlocked'},footnotes:[{number:1,text:'Rabb means Lord.'},{number:2,text:'A supporting narration.'}]}]};
  const withNotes=formatQuran(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line',quranFootnotes:true});
  assert.match(withNotes,/> \{The Rabb\[1\] of the worlds\.\[2\]\}/);
  assert.match(withNotes,/\n>\n>> \[!Note\] Footnotes\n>> - \[1\]: Rabb means Lord\.\n>> - \[2\]: A supporting narration\./);
  const withoutNotes=formatQuran(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line',quranFootnotes:false});
  assert.match(withoutNotes,/> \{The Rabb of the worlds\.\}/);
  assert.doesNotMatch(withoutNotes,/Footnotes:/);
});



test('Quran ranged footnotes stay outside translation in both modes',()=>{
  const r:QuranResult={...q,ayahs:[
    {reference:{kind:'quran',surah:2,startAyah:255,endAyah:255},arabic:'AR255',translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:'The Rabb[1] of heaven.[2]',providerId:'quran-unlocked'},footnotes:[{number:1,text:'Rabb note.'},{number:2,text:'Second note.'}]},
    {reference:{kind:'quran',surah:2,startAyah:256,endAyah:256},arabic:'AR256',translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:'No compulsion.[1]',providerId:'quran-unlocked'},footnotes:[{number:1,text:'Another note.'}]},
  ]};
  const merged=formatQuran(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'merged',quranFootnotes:true});
  assert.match(merged,/> \{⟪255⟫ The Rabb\[1\] of heaven\.\[2\] ⟪256⟫ No compulsion\.\[3\]\}/);
  assert.match(merged,/>> \[!Note\] Footnotes/);
  assert.match(merged,/>> - \[1\]: Rabb note\.\n>> - \[2\]: Second note\.\n>> - \[3\]: Another note\./);
  assert.doesNotMatch(merged,/First note.*No compulsion/s);
  assert.match(merged,/>> \[!Note\] Footnotes/);

  const lines=formatQuran(r,DEFAULT_FORMATTING,{arabic:true,english:true,grading:false,quranRangeMode:'line-by-line',quranFootnotes:true});
  assert.match(lines,/> \{The Rabb\[1\] of heaven\.\[2\]\}\n> \{No compulsion\.\[3\]\}/);
  const lineTranslation = lines.split('\n>> [!Note] Footnotes')[0];
  assert.ok(lineTranslation);
  assert.doesNotMatch(lineTranslation,/Rabb note/);
});


test('Merged Quran ranges keep each ayah number attached to its own translation',()=>{
  const r:QuranResult={...q,reference:{...q.reference,startAyah:255,endAyah:256},ayahs:[
    {reference:{kind:'quran',surah:2,startAyah:255,endAyah:255},arabic:'AR255',translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:'EN255',providerId:'quran-unlocked'}},
    {reference:{kind:'quran',surah:2,startAyah:256,endAyah:256},arabic:'AR256',translation:{id:'hilali-khan',language:'en',name:'Hilali-Khan',text:'EN256',providerId:'quran-unlocked'}},
  ]};
  const out=formatQuran(r,DEFAULT_FORMATTING,{arabic:false,english:true,grading:false,quranRangeMode:'merged',quranFootnotes:false});
  assert.match(out,/> \{⟪255⟫ EN255 ⟪256⟫ EN256\}/);
});




test('Quran display name adds Surah and normalizes Al capitalization',()=>{
  const out=formatQuran({...q,surahName:'al-Baqarah'},DEFAULT_FORMATTING,{arabic:true,english:false,grading:false});
  assert.match(out,/\[Surah Al-Baqarah, 2:255-257\]/);
});

test('formatting supports disabled and custom callouts',()=>{
  const none=formatQuran(q,{...DEFAULT_FORMATTING,callout:'none'},{arabic:true,english:false,grading:false});
  assert.doesNotMatch(none,/\[!Quote\]/);
  const custom=formatQuran(q,{...DEFAULT_FORMATTING,callout:'custom',customCalloutType:'Study'},{arabic:true,english:false,grading:false});
  assert.match(custom,/\[!Study\]/);
});

test('Quran standard English display-name regression',()=>{
  const out=formatQuran({...q,surahName:'Al-Fatihah'},DEFAULT_FORMATTING,{arabic:false,english:true,grading:false});
  assert.match(out,/\[Surah Al-Fatihah, 2:255-257\]/);
});

test('Hadith range formatting renders each referenced hadith',()=>{
  const results=[1,2].map(number=>({kind:'hadith' as const,reference:{kind:'hadith' as const,collectionId:'bukhari',hadithNumber:number},collectionName:'Sahih Al-Bukhari',arabic:`AR${number}`,english:`EN${number}`,grades:[],source:{providerId:'hadith-api',providerName:'hadith-api',sourceUrl:`https://example/${number}`,retrievedAt:'now'}}));
  const output=formatHadithRange(results,DEFAULT_FORMATTING,{arabic:false,english:true,grading:false});
  assert.match(output,/Sahih Al-Bukhari 1/);
  assert.match(output,/Sahih Al-Bukhari 2/);
  assert.match(output,/EN1/);
  assert.match(output,/EN2/);
});
