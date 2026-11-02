import assert from 'node:assert/strict';
import test from 'node:test';
import { formatScholarName } from '../../core/names';
import { formatHadithCollectionLabel, hadithCollectionOrder } from '../../core/catalog';


test('scholar names use Ibn and capitalized article prefixes',()=>{
  assert.equal(formatScholarName('Muhammad b. Ismail al-Bukhari'),'Muhammad Ibn Ismail Al-Bukhari');
  assert.equal(formatScholarName('Yahya b. Sharaf as-Nawawi'),'Yahya Ibn Sharaf As-Nawawi');
});

test('Hadith collection labels use a stable provider-independent order',()=>{
  assert.equal(formatHadithCollectionLabel({id:'bukhari',name:'Bukhari',providerId:'x'}),'01 Sahih Al-Bukhari');
  assert.equal(formatHadithCollectionLabel({id:'riyad',name:'Riyad',providerId:'x'}),'13 Riyad As-Salihin');
  assert.equal(hadithCollectionOrder('nasai'),3);
  assert.equal(hadithCollectionOrder('future-book'),99);
});
