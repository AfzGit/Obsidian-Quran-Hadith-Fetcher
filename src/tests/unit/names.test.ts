import assert from 'node:assert/strict';
import test from 'node:test';
import { formatScholarName } from '../../core/names';


test('scholar names use Ibn and capitalized article prefixes',()=>{
  assert.equal(formatScholarName('Muhammad b. Ismail al-Bukhari'),'Muhammad Ibn Ismail Al-Bukhari');
  assert.equal(formatScholarName('Yahya b. Sharaf as-Nawawi'),'Yahya Ibn Sharaf As-Nawawi');
});
