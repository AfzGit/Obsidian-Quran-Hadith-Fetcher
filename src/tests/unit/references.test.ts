import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHadithReference, parseQuranReference } from '../../parsing/references';
import { validateQuranReference, validateHadithReference } from '../../parsing/validation';


test('Quran references parse spaced ranges',()=>{
  assert.deepEqual(parseQuranReference('2:1 - 10'),{kind:'quran',surah:2,startAyah:1,endAyah:10});
  assert.deepEqual(parseQuranReference('2:1-10'),{kind:'quran',surah:2,startAyah:1,endAyah:10});
  assert.equal(parseQuranReference('2:hello'),null);
  assert.equal(parseQuranReference('hello'),null);
});

test('Quran references parse',()=>{assert.deepEqual(parseQuranReference('114:1'),{kind:'quran',surah:114,startAyah:1,endAyah:1});assert.deepEqual(parseQuranReference('2:255'),{kind:'quran',surah:2,startAyah:255,endAyah:255});assert.deepEqual(parseQuranReference('2:255-257'),{kind:'quran',surah:2,startAyah:255,endAyah:257});});
test('Hadith references parse',()=>{assert.equal(parseHadithReference('Bukhari:1')?.collectionId,'bukhari');assert.equal(parseHadithReference('Bukhari:2856')?.hadithNumber,2856);assert.deepEqual(parseHadithReference('Sahih Al-Bukhari:2856'),{kind:'hadith',collectionId:'bukhari',hadithNumber:2856});assert.deepEqual(parseHadithReference('Bukhari:1-5'),{kind:'hadith',collectionId:'bukhari',hadithNumber:1,endHadithNumber:5});assert.deepEqual(parseHadithReference('Bukhari:1 - 5'),{kind:'hadith',collectionId:'bukhari',hadithNumber:1,endHadithNumber:5});assert.deepEqual(parseHadithReference('Muwatta Malik:1-2'),{kind:'hadith',collectionId:'malik',hadithNumber:1,endHadithNumber:2});assert.deepEqual(parseHadithReference('malik:1-2'),{kind:'hadith',collectionId:'malik',hadithNumber:1,endHadithNumber:2});});
test('Hadith JSON collection IDs parse as numeric references',()=>{
  const ids=['bukhari','muslim','abudawud','tirmidhi','nasai','ibnmajah','malik','ahmad','darimi','nawawi40','qudsi40','shahwaliullah40','riyadussalihin','mishkat_almasabih','aladab_almufrad','shamail_muhammadiyah','bulugh_almaram'];
  for(const id of ids)assert.deepEqual(parseHadithReference(`${id}:716`),{kind:'hadith',collectionId:id,hadithNumber:716});
});
test('validation rejects bad Quran ranges',()=>{assert.ok(validateQuranReference({kind:'quran',surah:0,startAyah:1,endAyah:1}));assert.ok(validateQuranReference({kind:'quran',surah:2,startAyah:999,endAyah:999}));assert.ok(validateQuranReference({kind:'quran',surah:2,startAyah:255,endAyah:254}));assert.ok(validateQuranReference({kind:'quran',surah:2,startAyah:255,endAyah:287}));});
test('validation rejects unknown Hadith collection',()=>{assert.equal(validateHadithReference({kind:'hadith',collectionId:'nope',hadithNumber:1},[{id:'bukhari',name:'Bukhari',providerId:'x'}]),'Unknown collection.');});


test('Hadith validation enforces range limits',()=>{
  const collections=[{id:'bukhari',name:'Bukhari',providerId:'hadith-api'}];
  assert.equal(validateHadithReference({kind:'hadith',collectionId:'bukhari',hadithNumber:1,endHadithNumber:5},collections,5),null);
  assert.match(validateHadithReference({kind:'hadith',collectionId:'bukhari',hadithNumber:1,endHadithNumber:6},collections,5) ?? '',/limit is 5/);
  assert.match(validateHadithReference({kind:'hadith',collectionId:'bukhari',hadithNumber:5,endHadithNumber:4},collections,5) ?? '',/start must be less than or equal/);
});

test('Quran validation enforces range limits',()=>{
  const ok={kind:'quran' as const,surah:2,startAyah:1,endAyah:30};
  const tooMany={kind:'quran' as const,surah:2,startAyah:1,endAyah:31};
  assert.equal(validateQuranReference(ok,30),null);
  assert.match(validateQuranReference(tooMany,30) ?? '',/limit is 30/);
});
