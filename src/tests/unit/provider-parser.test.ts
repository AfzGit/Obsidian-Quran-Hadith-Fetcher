import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuranUnlockedResponse } from '../../providers/quran-unlocked/parser';
import { parseHadithUnlockedResponse } from '../../providers/hadith-unlocked/parser';
import { parseHadithApiResponse } from '../../providers/hadith-api/parser';
import { HADITH_API_COLLECTIONS } from '../../providers/hadith-api/collections';
import { HADITH_UNLOCKED_COLLECTIONS } from '../../providers/hadith-unlocked/collections';

const quranResponse = [
  {
    ref: 'quran:2:255',
    num: '2:255',
    num_ar: '٢٥٥',
    body: 'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ',
    body_en: 'Allah: there is no deity except Him.',
    chapter: { title: 'البقرة', title_en: 'Al-Baqarah' },
  },
  {
    ref: 'quran:2:256',
    num: '2:256',
    num_ar: '٢٥٦',
    body: 'لَا إِكْرَاهَ فِي الدِّينِ',
    body_en: 'There is no compulsion in religion.',
    chapter: { title: 'البقرة', title_en: 'Al-Baqarah' },
  },
];


test('Quran Unlocked JSON parser maps single ayah exactly',()=>{
  const r=parseQuranUnlockedResponse(quranResponse,{kind:'quran',surah:2,startAyah:255,endAyah:255},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.equal(r.ayahs.length,1);
  assert.equal(r.ayahs[0]?.arabic,'ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ');
  assert.equal(r.ayahs[0]?.translation?.text,'Allah: there is no deity except Him.');
  assert.equal(r.surahName,'Al-Baqarah');
});

test('Quran Unlocked JSON parser preserves range boundaries and order',()=>{
  const r=parseQuranUnlockedResponse(quranResponse,{kind:'quran',surah:2,startAyah:255,endAyah:256},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.deepEqual(r.ayahs.map(a=>a.reference.startAyah),[255,256]);
  assert.equal(r.ayahs[1]?.translation?.text,'There is no compulsion in religion.');
});

test('Hadith Unlocked JSON parser selects only the referenced record fields',()=>{
  const raw=[{
    ref:'bukhari:1', num:1, body:'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ', body_en:'Actions are but by intentions.', isnad_ar:'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا حَمَّادٌ عَنْ ثَابِتٍ عَنْ أَنَسٍ',
    grade_grade:'صحيح', grade_grade_en:'Sound', grader_shortName:'al-Albani', grader_shortName_en:'al-Albani'
  }];
  const r=parseHadithUnlockedResponse(raw,{kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'bukhari',name:'Sahih Al-Bukhari',providerId:'hadith-unlocked'},'https://hadithunlocked.com/bukhari:1?json');
  assert.equal(r.arabicIsnad,'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا حَمَّادٌ عَنْ ثَابِتٍ عَنْ أَنَسٍ');
  assert.equal(r.arabic,'إِنَّمَا الأَعْمَالُ بِالنِّيَّاتِ');
  assert.equal(r.english,'Actions are but by intentions.');
  assert.equal(r.grades.length,1);
  assert.equal(r.grades[0]?.text,'Sound');
});

test('Hadith Unlocked JSON parser does not leak surrounding/similar hadiths',()=>{
  const raw=[
    {ref:'bukhari:1',num:1,body:'FIRST ARABIC',body_en:'FIRST ENGLISH'},
    {ref:'ibnhibban:388',num:388,body:'WRONG ARABIC',body_en:'WRONG ENGLISH'}
  ];
  const r=parseHadithUnlockedResponse(raw,{kind:'hadith',collectionId:'bukhari',hadithNumber:1},{id:'bukhari',name:'Sahih Al-Bukhari',providerId:'hadith-unlocked'},'https://hadithunlocked.com/bukhari:1?json');
  assert.equal(r.english,'FIRST ENGLISH');
  assert.equal(r.arabic,'FIRST ARABIC');
});

test('hadith-api fixture parser handles missing optional grade',()=>{const r=parseHadithApiResponse({hadiths:[{hadithnumber:1,text:'عربي'}]},{hadiths:[{hadithnumber:1,text:'English'}]},{kind:'hadith',collectionId:'bukhari',hadithNumber:1},'Bukhari','hadith-api');assert.equal(r.arabic,'عربي');assert.equal(r.english,'English');assert.deepEqual(r.grades,[]);});


test('Hadith Unlocked parser preserves the Arabic isnad separately from the matn',()=>{
  const raw=[{ref:'bukhari:200',num:200,isnad_ar:'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا حَمَّادٌ عَنْ ثَابِتٍ عَنْ أَنَسٍ',body:'أَنَّ النَّبِيَّ ﷺ دَعَا بِإِنَاءٍ مِنْ مَاءٍ',body_en:'The Prophet ﷺ asked for water.'}];
  const r=parseHadithUnlockedResponse(raw,{kind:'hadith',collectionId:'bukhari',hadithNumber:200},{id:'bukhari',name:'Sahih Al-Bukhari',providerId:'hadith-unlocked'},'https://hadithunlocked.com/bukhari:200');
  assert.equal(r.arabicIsnad,'حَدَّثَنَا مُسَدَّدٌ قَالَ حَدَّثَنَا حَمَّادٌ عَنْ ثَابِتٍ عَنْ أَنَسٍ');
  assert.equal(r.arabic,'أَنَّ النَّبِيَّ ﷺ دَعَا بِإِنَاءٍ مِنْ مَاءٍ');
});


test('Quran Project labels translations by language rather than falsely using Quran.com as translator',async()=>{
  const { QuranProjectProvider } = await import('../../providers/quran-project/provider.js');
  const provider=new QuranProjectProvider({} as any);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  assert.deepEqual(translations.map(t=>({id:t.id,name:t.name,author:t.author})),[
    {id:'en',name:'English',author:undefined},
    {id:'bn',name:'Bengali',author:undefined},
    {id:'ur',name:'Urdu',author:undefined},
  ]);
});

test('Quran Unlocked lists its available translations',async()=>{
  const { QuranUnlockedProvider } = await import('../../providers/quran-unlocked/provider.js');
  const provider=new QuranUnlockedProvider({} as any);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  assert.equal(translations[0]?.id,'hilali-khan');
  assert.equal(translations.every(t=>t.language==='en'),true);
  assert.ok(translations.some(t=>t.id==='en-khattab'));
  assert.ok(translations.some(t=>t.id==='en-ahmedraza'));
  assert.ok(translations.some(t=>t.id==='en-haleem'));
  assert.ok(translations.some(t=>t.id==='en-taqi-usmani'));
  assert.ok(translations.some(t=>t.id==='en-tahir-ul-qadri'));
  assert.ok(translations.some(t=>t.id==='yusuf-ali'));
});

test('Quran translation definitions expose translator authors',async()=>{
  const { QuranUnlockedProvider } = await import('../../providers/quran-unlocked/provider.js');
  const provider=new QuranUnlockedProvider({} as any);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  const hilali=translations.find(t=>t.id==='hilali-khan');
  assert.equal(hilali?.author,'Muhammad Taqi-ud-Din Al-Hilali and Muhammad Muhsin Khan');
});

test('Quran Unlocked parser selects requested Hilali-Khan translation when supplied as metadata',()=>{
  const raw=[{ref:'quran:48:1',num:'48:1',body:'AR',translations:[{id:'en-hilali-khan',name:'Hilali-Khan',text:'Verily, We have given you (O Muhammad SAW) a manifest victory.'},{id:'en-haleem',name:'Haleem',text:'We have bestowed on you a clear triumph.'}],chapter:{title_en:'Al-Fath'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:48,startAyah:1,endAyah:1},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.equal(r.ayahs[0]?.translation?.text,'Verily, We have given you (O Muhammad SAW) a manifest victory.');
});

test('Quran Unlocked parser cleans escaped HTML from Hilali-Khan translation',()=>{
  const raw=[{ref:'quran:2:100',num:'2:100',body:'AR',body_en:'2:100 <section lang\\="en\\"><p\\>Is it not \\(the case\\) that every time they make a covenant, some party among them throw it aside? Nay\\! \\(the truth is:\\) most of them believe not\\.</p\\>\\n</section\\>',chapter:{title_en:'al-Baqarah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:2,startAyah:100,endAyah:100},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.equal(r.surahName,'Al-Baqarah');
  assert.equal(r.ayahs[0]?.translation?.text,'Is it not (the case) that every time they make a covenant, some party among them throw it aside? Nay! (the truth is:) most of them believe not.');
});


test('Quran Unlocked parser separates Hilali-Khan footnotes from translation text',()=>{
  const raw=[{ref:'quran:1:2',num:'1:2',body:'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ',body_en:'All the praises and thanks be to Allâh, the Rabb[1] of the ‘Âlamîn (mankind, jinn and all that exists).[2] (V.1:2) Rabb: The actual word used in the Qur’ân is Rabb. It means the One and the Only Rabb for all the universe. ↩︎ (V.1:2). Narrated Abu Sa‘îd bin Al-Mu‘alla: While I was praying in the mosque, Allâh’s Messenger ﷺ called me but I did not respond to him. ↩︎',chapter:{title_en:'al-Fātiḥah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:1,startAyah:2,endAyah:2},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.equal(r.ayahs[0]?.translation?.text,'All the praises and thanks be to Allâh, the Rabb[1] of the ‘Âlamîn (mankind, jinn and all that exists).[2]');
  assert.deepEqual(r.ayahs[0]?.footnotes,[
    {number:1,text:'Rabb: The actual word used in the Qur’ân is Rabb. It means the One and the Only Rabb for all the universe.'},
    {number:2,text:'Narrated Abu Sa‘îd bin Al-Mu‘alla: While I was praying in the mosque, Allâh’s Messenger ﷺ called me but I did not respond to him.'},
  ]);
});


test('Quran Unlocked parser splits collapsed ranges when the next ayah has no return marker',()=>{
  const raw=[{ref:'quran:2:1-2',num:'2:1',body:'AR1 ۝ AR2 ۝',body_en:'Alif-Lâm-Mîm. [These letters are one of the miracles of the Qur’ân.] 2 This is the Book (the Qur’ân), whereof there is no doubt.',chapter:{title_en:'al-Baqarah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:2,startAyah:1,endAyah:2},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.deepEqual(r.ayahs.map(a=>a.reference.startAyah),[1,2]);
  assert.equal(r.ayahs[0]?.translation?.text,'Alif-Lâm-Mîm. [These letters are one of the miracles of the Qur’ân.]');
  assert.equal(r.ayahs[1]?.translation?.text,'This is the Book (the Qur’ân), whereof there is no doubt.');
});

test('Quran Unlocked parser expands collapsed range records and separates footnotes',()=>{
  const raw=[{ref:'quran:2:255-256',num:'2:255',body:'AR255 ۝ AR256 ۝',body_en:'Allah [1] extends over the heavens. (V.2:255). Kursi footnote. ↩︎ 256 There is no compulsion in religion. (V.2:256). Taqhut footnote. ↩︎',chapter:{title_en:'al-Baqarah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:2,startAyah:255,endAyah:256},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.deepEqual(r.ayahs.map(a=>a.reference.startAyah),[255,256]);
  assert.equal(r.ayahs[0]?.arabic,'AR255');
  assert.equal(r.ayahs[1]?.arabic,'AR256');
  assert.equal(r.ayahs[0]?.translation?.text,'Allah [1] extends over the heavens.');
  assert.equal(r.ayahs[1]?.translation?.text,'There is no compulsion in religion.');
  assert.deepEqual(r.ayahs[0]?.footnotes,[{number:1,text:'Kursi footnote.'}]);
  assert.deepEqual(r.ayahs[1]?.footnotes,[{number:1,text:'Taqhut footnote.'}]);
  assert.equal(r.ayahs[1]?.translation?.text,'There is no compulsion in religion.');
  assert.equal(r.ayahs[0]?.translation?.text,'Allah [1] extends over the heavens.');
});


test('Quran Unlocked parser extracts footnotes from a collapsed multi-ayah Hilali-Khan response',()=>{
  const raw=[{ref:'quran:2:1-5',num:'2:1',body:'AR1 ۝ AR2 ۝ AR3 ۝ AR4 ۝ AR5 ۝',body_en:
    'Alif-Lâm-Mîm. [Letters.] 2 This is the Book. 3 Who believe in the Ghaib [1] and perform As-Salât [2], and spend out of what We provide [3]. (V.2:3): Ghaib note. ↩︎ (V.2:3): Salât note. ↩︎ (V.2:3): Zakât note. ↩︎ 4 And who believe in the Qurân [1] which was sent down to you. (V.2:4) Narrated Ibn Umar: note about five principles. ↩︎ 5 They are on guidance from their Rabb.',chapter:{title_en:'al-Baqarah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:2,startAyah:1,endAyah:5},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.deepEqual(r.ayahs.map(a=>a.reference.startAyah),[1,2,3,4,5]);
  assert.equal(r.ayahs[2]?.translation?.text,'Who believe in the Ghaib [1] and perform As-Salât [2], and spend out of what We provide [3].');
  assert.deepEqual(r.ayahs[2]?.footnotes,[
    {number:1,text:'Ghaib note.'},
    {number:2,text:'Salât note.'},
    {number:3,text:'Zakât note.'},
  ]);
  assert.equal(r.ayahs[3]?.translation?.text,'And who believe in the Qurân [1] which was sent down to you.');
  assert.deepEqual(r.ayahs[3]?.footnotes,[{number:1,text:'Narrated Ibn Umar: note about five principles.'}]);
});

test('Quran Unlocked parser preserves provider footnote numbering per ayah',()=>{
  const raw=[{ref:'quran:2:255-256',num:'2:255',body:'AR255 ۝ AR256 ۝',body_en:'Allah [1] extends. (V.2:255). First note. ↩︎ 256 No compulsion [1]. (V.2:256). Second note. ↩︎',chapter:{title_en:'al-Baqarah'}}];
  const r=parseQuranUnlockedResponse(raw,{kind:'quran',surah:2,startAyah:255,endAyah:256},{id:'hilali-khan',language:'en',name:'Hilali-Khan',providerId:'quran-unlocked'});
  assert.equal(r.ayahs[0]?.translation?.text,'Allah [1] extends.');
  assert.equal(r.ayahs[1]?.translation?.text,'No compulsion [1].');
  assert.deepEqual(r.ayahs[0]?.footnotes,[{number:1,text:'First note.'}]);
  assert.deepEqual(r.ayahs[1]?.footnotes,[{number:1,text:'Second note.'}]);
});


test('Hadith API parser returns an empty result when editions are unavailable',()=>{
  const r=parseHadithApiResponse(undefined,undefined,{kind:'hadith',collectionId:'missing-book',hadithNumber:999},'Missing Book','hadith-api');
  assert.equal(r.arabic,undefined);
  assert.equal(r.english,undefined);
  assert.deepEqual(r.grades,[]);
});

test('Hadith API parser preserves grading authors from either language edition',()=>{
  const r=parseHadithApiResponse(
    {hadiths:[{hadithnumber:200,text:'AR',grades:[{name:'al-Nawawi',grade:'Sahih'}]}]},
    {hadiths:[{hadithnumber:200,text:'EN',grades:[{name:'al-Nawawi',grade:'Sahih'},{name:'Al-Albani',grade:'Hasan'}]}]},
    {kind:'hadith',collectionId:'muslim',hadithNumber:200},'Sahih Muslim','hadith-api'
  );
  assert.equal(r.grades.length,2);
  assert.ok(r.grades.some(g=>g.author==='Al-Albani'));
  assert.ok(r.grades.some(g=>g.author==='al-Nawawi'));
  assert.ok(r.grades.some(g=>g.text==='Hasan'));
});


test('Hadith API parser matches alphabetic Muslim hadith numbers',()=>{
  const r=parseHadithApiResponse(
    undefined,
    {hadiths:[{hadithnumber:'202a',text:'EN 202a'}]},
    {kind:'hadith',collectionId:'muslim',hadithNumber:'202a'},
    'Sahih Muslim','hadith-api'
  );
  assert.equal(r.english,'EN 202a');
});

test('Hadith Unlocked parser preserves grading author from alternate fields',()=>{
  const r=parseHadithUnlockedResponse(
    [{ref:'muslim:200',num:200,body:'AR',body_en:'EN',grade:{grade_en:'Sound',grader_en:'Al-Albani'}}],
    {kind:'hadith',collectionId:'muslim',hadithNumber:200},
    {id:'muslim',name:'Sahih Muslim',providerId:'hadith-unlocked'},'https://hadithunlocked.com/muslim:200'
  );
  assert.equal(r.grades[0]?.text,'Sound');
  assert.equal(r.grades[0]?.author,'Al-Albani');
});


test('Hadith Unlocked parser reads grader attribution from common grade fields',()=>{
  const r=parseHadithUnlockedResponse(
    [{ref:'muslim:200',num:200,body:'AR',body_en:'EN',grade:{grade:'Sound (Muslim)'}}],
    {kind:'hadith',collectionId:'muslim',hadithNumber:200},
    {id:'muslim',name:'Sahih Al-Muslim',providerId:'hadith-unlocked'},'https://hadithunlocked.com/muslim:200'
  );
  assert.equal(r.grades[0]?.author,'Muslim');
  assert.equal(r.grades[0]?.text,'Sound');
});


test('Hadith Unlocked uses its own hardcoded book list and preserves authors/apostrophes',()=>{
  const ids=HADITH_UNLOCKED_COLLECTIONS.map(x=>x.id);
  assert.equal(ids.length,30);
  assert.equal(HADITH_UNLOCKED_COLLECTIONS.find(x=>x.id==='ibnrajab50')?.name,"Jami' Al-Ulum wal-Hikam");
  assert.equal(HADITH_UNLOCKED_COLLECTIONS.find(x=>x.id==='nasai-kubra')?.name,"As-Sunan Al-Kubra (An-Nasa'i)");
  assert.ok(HADITH_UNLOCKED_COLLECTIONS.every(x=>x.author));
  assert.equal(HADITH_UNLOCKED_COLLECTIONS.some(x=>x.id==='ibnhisham'),false);
});



test('Hadith Unlocked collection metadata keeps apostrophes and exposes authors',()=>{
  const collection={id:'ibnrajab50',name:'Ibn Rajab&#39;s Fifty',providerId:'hadith-unlocked',author:'Abd Al-Rahman Ibn Ahmad Ibn Rajab Al-Hanbali'};
  const r=parseHadithUnlockedResponse([{ref:'ibnrajab50:1',num:1,body:'AR',body_en:'EN'}],{kind:'hadith',collectionId:'ibnrajab50',hadithNumber:1},collection,'https://hadithunlocked.com/ibnrajab50:1');
  assert.equal(r.collectionName,"Ibn Rajab's Fifty");
  assert.equal(HADITH_UNLOCKED_COLLECTIONS.find(x=>x.id==='ibnrajab50')?.author,'Abd Al-Rahman Ibn Ahmad Ibn Rajab Al-Hanbali');
});

test('Hadith API uses its own hardcoded book list',()=>{
  assert.deepEqual(HADITH_API_COLLECTIONS.map(x=>x.id),['abudawud','bukhari','dehlawi','ibnmajah','malik','muslim','nasai','nawawi','qudsi','tirmidhi']);
  assert.equal(HADITH_API_COLLECTIONS.find(x=>x.id==='bukhari')?.englishEdition,'eng-bukhari');
  assert.equal(HADITH_API_COLLECTIONS.find(x=>x.id==='nawawi')?.arabicEdition,'ara-nawawi');
});

test('shared Hadith books use identical canonical names across providers',()=>{
  const huById=new Map(HADITH_UNLOCKED_COLLECTIONS.map(x=>[x.id,x.name]));
  const haById=new Map(HADITH_API_COLLECTIONS.map(x=>[x.id,x.name]));
  for(const id of ['bukhari','muslim','abudawud','tirmidhi','nasai','ibnmajah','malik']){
    assert.equal(huById.get(id),haById.get(id),id);
  }
});


test('Hadith API translation catalog groups available languages',async()=>{
  const { HadithApiProvider } = await import('../../providers/hadith-api/provider.js');
  const http={getJson:async (url:string)=>url.endsWith('/editions.min.json')?{status:200,json:{bukhari:{collection:[{name:'eng-bukhari',language:'English'},{name:'fra-bukhari',language:'French'},{name:'ara-bukhari',language:'Arabic'}]}},headers:{}}:{status:200,json:{},headers:{}}} as any;
  const provider=new HadithApiProvider(http);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  assert.deepEqual(translations.map(x=>[x.id,x.language]),[['eng','en'],['fra','fr']]);
});

test('Quran translation metadata is uniform for Hilali-Khan aliases',async()=>{
  const { normalizeQuranTranslationMetadata } = await import('../../core/catalog.js');
  const a=normalizeQuranTranslationMetadata({id:'en.hilali',language:'en',name:'English - Hilali & Khan',author:'Hilali & Khan',providerId:'alquran-cloud'});
  const b=normalizeQuranTranslationMetadata({id:'hilali-khan',language:'en',name:"Interpretation of the Meanings of the Noble Qur'an",author:'Muhammad Taqi-ud-Din Al-Hilali and Muhammad Muhsin Khan',providerId:'quran-unlocked'});
  assert.deepEqual([a.name,a.author],[b.name,b.author]);
});

test('Quran API parser handles the chapter response shape',async()=>{
  const { parseQuranApiEdition } = await import('../../providers/quran-api/parser.js');
  const result=parseQuranApiEdition({chapter:[{chapter:2,verse:1,text:'AR1'},{chapter:2,verse:2,text:'AR2'}]}, {kind:'quran',surah:2,startAyah:1,endAyah:2});
  assert.equal(result.verses.get(1),'AR1');
  assert.equal(result.verses.get(2),'AR2');
});

test('Quran Unlocked provider uses the public en-hilali-khan route',async()=>{
  const { QuranUnlockedProvider } = await import('../../providers/quran-unlocked/provider.js');
  const http={getJson:async (url:string)=>({status:200,json:[{ref:'quran:2:1',num:'2:1',body:'AR',translations:[{id:'en-hilali-khan',name:'Hilali-Khan',text:'EN'}],chapter:{title_en:'Al-Baqarah'}}],headers:{}})} as any;
  const provider=new QuranUnlockedProvider(http);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:1},translations[0]!,{signal:new AbortController().signal});
  assert.match(result.source.sourceUrl,/\/quran\/en-hilali-khan\/quran:2:1$/);
});

test('Al Quran Cloud provider maps Arabic and selected translation by ayah',async()=>{
  const { AlQuranCloudProvider } = await import('../../providers/alquran-cloud/provider.js');
  const calls:string[]=[];
  const http={
    getJson:async (url:string)=>{
      calls.push(url);
      if(url.endsWith('/edition/type/translation')) {
        return {status:200,json:{data:[{identifier:'en.sahih',language:'en',englishName:'Saheeh International',format:'text',type:'translation'}]},headers:{}};
      }
      const edition=url.includes('/quran-uthmani')?'quran-uthmani':'en.sahih';
      return {status:200,json:{data:{number:1,numberInSurah:1,text:edition==='quran-uthmani'?'AR1':'EN1',edition:{identifier:edition},surah:{englishName:'Al-Baqarah'}}},headers:{}};
    },
  } as any;
  const provider=new AlQuranCloudProvider(http);
  const translations=await provider.listTranslations({signal:new AbortController().signal});
  const result=await provider.fetchQuran({kind:'quran',surah:2,startAyah:1,endAyah:1},translations[0]!,{signal:new AbortController().signal});
  assert.deepEqual(result.ayahs.map((a: {arabic?: string; translation?: {text:string}})=>[a.arabic,a.translation?.text]),[['AR1','EN1']]);
  assert.equal(calls.length,3);
  assert.ok(calls.some(url=>url.endsWith('/ayah/2:1/quran-uthmani')));
  assert.ok(calls.some(url=>url.endsWith('/ayah/2:1/en.sahih')));
});


test('Quran Project parser maps Arabic and supported translations by ayah',async()=>{
  const { parseQuranProjectChapter } = await import('../../providers/quran-project/parser.js');
  const result=parseQuranProjectChapter({
    surahName:'Al-Baqarah',
    arabic1:['AR1','AR2'],
    english:['EN1','EN2'],
    bengali:['BN1','BN2'],
    urdu:['UR1','UR2'],
  },{kind:'quran',surah:2,startAyah:1,endAyah:2});
  assert.equal(result.surahName,'Al-Baqarah');
  assert.equal(result.arabic.get(2),'AR2');
  assert.equal(result.translations.get('en')?.get(1),'EN1');
  assert.equal(result.translations.get('bn')?.get(2),'BN2');
  assert.equal(result.translations.get('ur')?.get(1),'UR1');
});
