import assert from 'node:assert/strict';
import test from 'node:test';
import { makeQuranUrl } from '../../core/url';


test('Quran Unlocked source URL can use a selected translation',()=>{
  assert.equal(makeQuranUrl('quran-unlocked','',2,1,1,'en-pickthall'),'https://quran.islamunlocked.com/quran/en-pickthall/quran:2:1');
});

test('Quran Unlocked source URL uses the Hilali-Khan translation route',()=>{
  assert.equal(makeQuranUrl('quran-unlocked','',16,24,24),'https://quran.islamunlocked.com/quran/en-hilali-khan/quran:16:24');
});


test('Quran Unlocked range URL includes the ending ayah',()=>{
  assert.equal(makeQuranUrl('quran-unlocked','',2,255,256),'https://quran.islamunlocked.com/quran/en-hilali-khan/quran:2:255-256');
});

test('Quran Unlocked range URL matches the public site route exactly',()=>{
  assert.equal(makeQuranUrl('quran-unlocked','',2,75,80,'hilali-khan'),'https://quran.islamunlocked.com/quran/en-hilali-khan/quran:2:75-80');
});

