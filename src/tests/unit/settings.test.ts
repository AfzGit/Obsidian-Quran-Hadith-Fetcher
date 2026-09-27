import { languageName } from '../../core/languages';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, migrateSettings } from '../../settings/model';
import { COMMAND_DEFINITIONS } from '../../core/commands';



test('command palette defaults expose only fetch, normalization, and health commands',()=>{
  const enabled=COMMAND_DEFINITIONS.filter(command=>command.defaultEnabled).map(command=>command.id);
  assert.deepEqual(enabled,['fetch-quran','fetch-hadith','check-provider-health','normalize-salutations']);
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='fetch-quran')?.name,'Fetch Quran');
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='fetch-hadith')?.name,'Fetch Hadith');
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='set-quran-provider')?.name,'Set Quran content provider');
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='set-quran-website')?.name,'Set Quran link website');
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='set-hadith-provider')?.name,'Set Hadith content provider');
  assert.equal(COMMAND_DEFINITIONS.find(command=>command.id==='toggle-text-conversions')?.name,'Toggle Text Conversions');
});

test('defaults are stable',()=>{
  assert.equal(DEFAULT_SETTINGS.schemaVersion,14);
  assert.equal(DEFAULT_SETTINGS.quranProvider,'alquran-cloud');
  assert.equal(DEFAULT_SETTINGS.hadithProvider,'hadith-api');
  assert.equal(DEFAULT_SETTINGS.quranLanguage,'en');
  assert.equal(DEFAULT_SETTINGS.quranLanguage,'en');
  assert.equal(DEFAULT_SETTINGS.quranTranslation,'hilali-khan');
  assert.equal(DEFAULT_SETTINGS.hadithLanguage,'en');
  assert.equal(DEFAULT_SETTINGS.hadithTranslation,'eng');
  assert.equal(DEFAULT_SETTINGS.hadithLanguage,'en');
  assert.equal(DEFAULT_SETTINGS.hadithTranslation,'eng');
  assert.equal(DEFAULT_SETTINGS.blessingNormalization,true);
  assert.equal(DEFAULT_SETTINGS.romanEnglish,true);
  assert.equal(DEFAULT_SETTINGS.raNormalization,false);
  assert.equal(DEFAULT_SETTINGS.textConversionsEnabled,true);
  assert.equal(DEFAULT_SETTINGS.quranFetchLimit,30);
  assert.equal(DEFAULT_SETTINGS.hadithFetchLimit,15);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['fetch-quran'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['fetch-hadith'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['normalize-salutations'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['check-provider-health'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-quran-provider'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-quran-language'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-quran-translation'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-quran-website'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-hadith-provider'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['set-hadith-translation'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['manage-offline-databases'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['convert-ra'],false);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['toggle-text-conversions'],false);
  assert.equal(DEFAULT_SETTINGS.lastQuranOptions.arabic,true);
  assert.equal(DEFAULT_SETTINGS.lastHadithOptions.grading,true);
  assert.equal(DEFAULT_SETTINGS.formatting.ayahNumberOpen,'⟪');
  assert.equal(DEFAULT_SETTINGS.formatting.ayahNumberClose,'⟫');
  assert.equal(DEFAULT_SETTINGS.formatting.arabicAyahNumbers,true);
  assert.equal(DEFAULT_SETTINGS.formatting.quranAyahOpen,'{');
  assert.equal(DEFAULT_SETTINGS.formatting.quranAyahClose,'}');
  assert.equal(DEFAULT_SETTINGS.formatting.quranAyahStyle,'curly');
  assert.equal(DEFAULT_SETTINGS.formatting.codeSyntaxMode,'replace');
});

test('migration keeps legacy output preferences in separate last-used options',()=>{
  const migrated=migrateSettings({schemaVersion:2,arabicEnabled:false,englishEnabled:true,hadithGradingEnabled:false,linkInsertion:false});
  assert.equal(migrated.lastQuranOptions.arabic,false);
  assert.equal(migrated.lastQuranOptions.english,true);
  assert.equal(migrated.lastQuranOptions.link,false);
  assert.equal(migrated.lastHadithOptions.grading,false);
  assert.equal(migrated.lastHadithOptions.link,false);
  assert.equal(migrated.schemaVersion,14);
  assert.equal(migrated.quranProvider,'alquran-cloud');
  assert.equal(migrated.formatting.ayahNumberOpen,'⟪');
  assert.equal(migrated.formatting.ayahNumberClose,'⟫');
  assert.equal(migrated.formatting.arabicAyahNumbers,true);
  assert.equal(migrated.formatting.quranAyahOpen,'{');
  assert.equal(migrated.formatting.quranAyahClose,'}');
  assert.equal(migrated.formatting.quranAyahStyle,'curly');
});


test('legacy hadith-api settings migrate to English default',()=>{
  const migrated=migrateSettings({schemaVersion:7,hadithProvider:'hadith-api',hadithLanguage:'bn',hadithTranslation:'ben'});
  assert.equal(migrated.hadithLanguage,'en');
  assert.equal(migrated.hadithTranslation,'eng');
});

test('language codes use proper display names',()=>{
  assert.equal(languageName('ur'),'Urdu');
  assert.equal(languageName('en'),'English');
});


test('default replacement rules include all requested text conversions',()=>{
  const ids=DEFAULT_SETTINGS.replacementRules.map(r=>r.id);
  assert.deepEqual(ids,['lord-to-rabb','verse-to-ayat','verses-to-ayat','ayat-to-ayah','quran-apostrophe','ayesha-backtick','apostle-to-messenger','apostles-to-messengers']);
  assert.equal(DEFAULT_SETTINGS.formatting.callout,'quote');
});

test('text conversion titles do not end with unnecessary colons',()=>{
  for(const rule of DEFAULT_SETTINGS.replacementRules) assert.equal(rule.title.endsWith(':'),false,rule.id);
});



test('default replacement rules convert Ayât to Ayah',()=>{
  const rule=DEFAULT_SETTINGS.replacementRules.find(r=>r.id==='ayat-to-ayah');
  assert.equal(rule?.from,'Ayât');
  assert.equal(rule?.to,'Ayah');
  const quranRule=DEFAULT_SETTINGS.replacementRules.find(r=>r.id==='quran-apostrophe');
  assert.equal(quranRule?.from,"Qur'an");
  assert.equal(quranRule?.to,'Quran');
});

test('custom replacement rules survive migration',()=>{
  const migrated=migrateSettings({
    schemaVersion:11,
    replacementRules:[{
      id:'custom-ubaid',language:'en',title:'Custom conversion',description:'',
      from:"'Ubaid",to:'Obaid',enabled:true,caseSensitive:false,
    }],
  });
  const rule=migrated.replacementRules.find(r=>r.id==='custom-ubaid');
  assert.equal(rule?.from,"'Ubaid");
  assert.equal(rule?.to,'Obaid');
  assert.equal(rule?.enabled,true);
});

test('Standard English defaults on and migrates safely',()=>{
  assert.equal(migrateSettings({schemaVersion:8,romanEnglishAyat:true}).romanEnglish,true);
  assert.equal(migrateSettings({schemaVersion:8}).romanEnglish,true);
});

test('legacy provider defaults migrate to Al Quran Cloud',()=>{
  const migrated=migrateSettings({schemaVersion:10,quranProvider:'quran-unlocked'});
  assert.equal(migrated.quranProvider,'alquran-cloud');
});

test('RA normalization defaults off and persists',()=>{
  assert.equal(DEFAULT_SETTINGS.raNormalization,false);
  assert.equal(DEFAULT_SETTINGS.textConversionsEnabled,true);
  assert.equal(DEFAULT_SETTINGS.quranFetchLimit,30);
  assert.equal(DEFAULT_SETTINGS.hadithFetchLimit,15);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['fetch-quran'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['fetch-hadith'],true);
  assert.equal(DEFAULT_SETTINGS.commandVisibility['normalize-salutations'],true);
  assert.equal(migrateSettings({schemaVersion:10,raNormalization:true}).raNormalization,true);
});

test('text conversion toggle keeps enabled semantics and migrates legacy disable flag',()=>{
  assert.equal(DEFAULT_SETTINGS.textConversionsEnabled,true);
  assert.equal(migrateSettings({schemaVersion:14,textConversionsEnabled:true}).textConversionsEnabled,true);
  assert.equal(migrateSettings({schemaVersion:14,textConversionsEnabled:false}).textConversionsEnabled,false);
  assert.equal(migrateSettings({schemaVersion:10,disableAllTextConversions:true}).textConversionsEnabled,false);
  assert.equal(migrateSettings({schemaVersion:10,disableAllTextConversions:false}).textConversionsEnabled,true);
});

test('default replacement rules target standard Ayah spelling',()=>{
  const rules=DEFAULT_SETTINGS.replacementRules;
  assert.equal(rules.find(r=>r.id==='verse-to-ayat')?.to,'Ayah');
  assert.equal(rules.find(r=>r.id==='verses-to-ayat')?.to,'Ayah');
  assert.equal(rules.find(r=>r.id==='ayat-to-ayah')?.to,'Ayah');
  assert.equal(rules.find(r=>r.id==='quran-apostrophe')?.to,'Quran');
});


test('legacy command ids migrate to renamed commands',()=>{
  const migrated=migrateSettings({schemaVersion:13,commandVisibility:{
    'insert-quran':false,
    'insert-hadith':true,
    'normalize-salutations':true,
    'check-provider-health':true,
    'disable-all-text-conversions':true,
  } as any});
  assert.equal(migrated.schemaVersion,14);
  assert.equal(migrated.commandVisibility['fetch-quran'],false);
  assert.equal(migrated.commandVisibility['fetch-hadith'],true);
  assert.equal(migrated.commandVisibility['normalize-salutations'],true);
  assert.equal(migrated.commandVisibility['check-provider-health'],true);
  assert.equal(migrated.commandVisibility['toggle-text-conversions'],true);
  assert.equal('insert-quran' in (migrated.commandVisibility as Record<string,boolean>),false);
  assert.equal('insert-hadith' in (migrated.commandVisibility as Record<string,boolean>),false);
});

test('v12 untouched command visibility adopts the new command defaults',()=>{
  const legacyAllEnabled=Object.fromEntries(COMMAND_DEFINITIONS.map(command=>[command.id,true]));
  const migrated=migrateSettings({schemaVersion:12,commandVisibility:legacyAllEnabled});
  assert.equal(migrated.schemaVersion,14);
  assert.equal(migrated.commandVisibility['fetch-quran'],true);
  assert.equal(migrated.commandVisibility['fetch-hadith'],true);
  assert.equal(migrated.commandVisibility['normalize-salutations'],true);
  assert.equal(migrated.commandVisibility['check-provider-health'],true);
  assert.equal(migrated.commandVisibility['set-quran-provider'],false);
  assert.equal(migrated.commandVisibility['convert-ra'],false);
});

test('current v13 command visibility is not mistaken for legacy defaults',()=>{
  const allEnabled=Object.fromEntries(COMMAND_DEFINITIONS.map(command=>[command.id,true]));
  const migrated=migrateSettings({schemaVersion:13,commandVisibility:allEnabled});
  assert.equal(migrated.schemaVersion,14);
  assert.equal(migrated.commandVisibility['set-quran-provider'],true);
  assert.equal(migrated.commandVisibility['convert-ra'],true);
  assert.equal(migrated.commandVisibility['toggle-text-conversions'],true);
});

test('new settings migrate safely and preserve customized command visibility',()=>{
  const migrated=migrateSettings({schemaVersion:11,textConversionsEnabled:false,quranFetchLimit:12,hadithFetchLimit:7,commandVisibility:{'fetch-quran':false}});
  assert.equal(migrated.textConversionsEnabled,false);
  assert.equal(migrated.quranFetchLimit,12);
  assert.equal(migrated.hadithFetchLimit,7);
  assert.equal(migrated.commandVisibility['fetch-quran'],false);
  assert.equal(migrated.commandVisibility['fetch-hadith'],true);
  assert.equal(migrated.commandVisibility['normalize-salutations'],true);
  assert.equal(migrated.commandVisibility['check-provider-health'],true);
  assert.equal(migrated.commandVisibility['set-quran-provider'],false);
});

test('invalid fetch limits fall back to safe defaults',()=>{
  const migrated=migrateSettings({schemaVersion:11,quranFetchLimit:0,hadithFetchLimit:-4});
  assert.equal(migrated.quranFetchLimit,30);
  assert.equal(migrated.hadithFetchLimit,15);
});


test('new custom conversion is not persisted until save',()=>{
  const before=DEFAULT_SETTINGS.replacementRules.length;
  assert.equal(DEFAULT_SETTINGS.replacementRules.length,before);
});

test('migration removes blank custom conversion placeholders',()=>{
  const migrated=migrateSettings({
    schemaVersion:14,
    replacementRules:[{
      id:'custom-stale-blank',language:'en',title:'Custom conversion',description:'',from:'',to:'',enabled:true,caseSensitive:false,
    }],
  });
  assert.equal(migrated.replacementRules.some(r=>r.id==='custom-stale-blank'),false);
});
