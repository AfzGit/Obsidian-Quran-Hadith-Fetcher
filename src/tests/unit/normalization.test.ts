import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBlessing, normalizeArabicBlessing, normalizeStandaloneRa, applyEnglishReplacements, transformFetchedEnglishText, transformFetchedArabicText, convertToRomanEnglish, modifyCodeSyntax, DEFAULT_REPLACEMENT_RULES } from '../../core/normalization';


test('English blessing variants normalize to (ﷺ)',()=>{
  const samples=['SAW','S.A.W.','S A W','SAWS','S.A.W.S.','PBUH','P.B.U.H.','P B U H','peace be upon him','Peace be upon him','peace and blessings be upon him','Peace and blessings be upon him'];
  for(const sample of samples)assert.equal(normalizeBlessing(sample),'(ﷺ)',sample);
});

test('may peace and blessings phrasing is replaced as one complete salutation',()=>{
  assert.equal(normalizeBlessing('And he May peace and blessings be upon him and he'), 'And he ﷺ and he');
  assert.equal(normalizeBlessing('And he (may peace and blessings be upon him) and he'), 'And he (ﷺ) and he');
  assert.equal(normalizeBlessing('And he May peace be upon him and he'), 'And he (ﷺ) and he');
});

test('Arabic normalizer preserves existing blessing forms',()=>{
  assert.equal(normalizeArabicBlessing('ﷺ'),'ﷺ');
  assert.equal(normalizeArabicBlessing('(ﷺ)'),' (ﷺ)'.trim());
  assert.equal(normalizeArabicBlessing('قال رسول الله ﷺ'),'قال رسول الله ﷺ');
  assert.equal(normalizeArabicBlessing('قال رسول الله (ﷺ)'),'قال رسول الله (ﷺ)');
});

test('Arabic normalizer converts Arabic blessing phrase without adding parentheses',()=>{
  assert.equal(normalizeArabicBlessing('صلى الله عليه وسلم'),'ﷺ');
  assert.equal(normalizeArabicBlessing('قال رسول الله صلى الله عليه وسلم'),'قال رسول الله ﷺ');
});

test('blessing normalization is idempotent',()=>{
  const s='Before SAW and صلى الله عليه وسلم after';
  const once=normalizeBlessing(s);
  assert.equal(once,normalizeBlessing(once));
});

test('English SAW respects surrounding parentheses',()=>{
  assert.equal(normalizeBlessing('(O Muhammad SAW)'), '(O Muhammad ﷺ)');
  assert.equal(normalizeBlessing('O Muhammad SAW'), 'O Muhammad (ﷺ)');
  assert.equal(normalizeBlessing('O Muhammad (ﷺ)'), 'O Muhammad (ﷺ)');
});

test('Arabic phrase conversion preserves surrounding punctuation',()=>{
  assert.equal(normalizeBlessing('(O Muhammad صلى الله عليه وسلم)'), '(O Muhammad ﷺ)');
  assert.equal(normalizeBlessing('O Muhammad صلى الله عليه وسلم'), 'O Muhammad ﷺ');
});

test('blessing normalization does not alter bare Arabic source ﷺ',()=>{
  assert.equal(normalizeArabicBlessing('ﷺ'),'ﷺ');
});

test('blessing normalization preserves existing ﷺ and converts new English blessings',()=>{
  assert.equal(normalizeBlessing('Muhammad ﷺ said'), 'Muhammad ﷺ said');
  assert.equal(normalizeBlessing('Muhammad (ﷺ) said'), 'Muhammad (ﷺ) said');
  assert.equal(normalizeBlessing('Muhammad صلى الله عليه وسلم said'), 'Muhammad ﷺ said');
});

test('unrelated text remains unchanged',()=>{const s='This is sawmill, SAWs are not the same as a blessing.';assert.equal(normalizeBlessing(s),s);});
test('Arabic is not altered by English replacements',()=>{const arabic='قُلْ هُوَ ٱللَّهُ أَحَدٌ';assert.equal(applyEnglishReplacements(arabic,DEFAULT_REPLACEMENT_RULES),arabic);});
test('English replacements are deterministic',()=>{assert.equal(applyEnglishReplacements('Lord said Verse 1',DEFAULT_REPLACEMENT_RULES),'Rabb said Ayah 1');
  assert.equal(applyEnglishReplacements('Ayât and AYÂT and Ayat and AYAT and Verses',DEFAULT_REPLACEMENT_RULES),'Ayah and Ayah and Ayah and Ayah and Ayah');});


test('common Arabic transliteration symbols convert by default',()=>{
  assert.equal(
  applyEnglishReplacements("qur'an Qur'an `Ayesha Qur'anism Ayeshatic",DEFAULT_REPLACEMENT_RULES),
  "Quran Quran Ayesha Qur'anism Ayeshatic"
);
});

test('code syntax modification replaces or removes backticks',()=>{
  assert.equal(modifyCodeSyntax("`Umar and `Uthman",'replace'),'ʿUmar and ʿUthman');
  assert.equal(modifyCodeSyntax("`Umar and `Uthman",'remove'),'Umar and Uthman');
  assert.equal(modifyCodeSyntax("`Umar",'none'),'`Umar');
});

test('default text conversions are whole-word and case-insensitive',()=>{
  const rules=DEFAULT_REPLACEMENT_RULES;
  assert.equal(applyEnglishReplacements('Lord LORD lordish Verse VERSE Verses Apostles Apostle',rules),'Rabb Rabb lordish Ayah Ayah Ayah Messengers Messenger');
});

test('custom conversions match an apostrophe-leading source literally',()=>{
  const rules=[
    {id:'custom-ubaid',language:'en' as const,title:'Custom',description:'',from:"'Ubaid",to:'Obaid',enabled:true,caseSensitive:false},
  ];
  assert.equal(
    applyEnglishReplacements("'Ubaid and ʿUbaid and ’Ubaid and ‘Ubaid and `Ubaid and Ubaidah",rules),
    "Obaid and ʿUbaid and ’Ubaid and ‘Ubaid and `Ubaid and Ubaidah",
  );
  assert.equal(applyEnglishReplacements("X'Ubaid 'Ubaidah",rules),"X'Ubaid 'Ubaidah");
  assert.equal(applyEnglishReplacements("start 'Ubaid end",rules),"start Obaid end");
  assert.equal(applyEnglishReplacements("'Ubaid, 'Ubaid.",rules),"Obaid, Obaid.");
});



test('custom conversion survives settings migration and fetch text processing',()=>{
  const rules=[
    {id:'custom-ubaid',language:'en' as const,title:'Custom conversion',description:'',from:"'Ubaid",to:'Obaid',enabled:true,caseSensitive:false},
  ];
  assert.equal(applyEnglishReplacements("Narrated by 'Ubaid.",rules),"Narrated by Obaid.");
});

test('Roman English conversion preserves ﷺ blessings',()=>{
  assert.equal(convertToRomanEnglish('(ﷺ)'), '(ﷺ)');
  assert.equal(convertToRomanEnglish('Muhammad ﷺ said'), 'Muhammad ﷺ said');
});

test('Roman English conversion uses standard Latin letters',()=>{
  assert.equal(convertToRomanEnglish('Ayât Alâh Qurân Sûrah Yaḥyá ʿUmar “test” – next'), "Ayat Alah Quran Surah Yahya Umar \"test\" - next");
  assert.equal(convertToRomanEnglish('Ayâtan'),'Ayatan');
});

test('standalone RA normalization works across punctuation and line boundaries',()=>{
  assert.equal(normalizeStandaloneRa('Start,R.A. (R.A.)\nR A end'), 'Start,رَضِيَ ٱللَّٰهُ عَنْهُ (رَضِيَ ٱللَّٰهُ عَنْهُ)\nR A end');
});

test('standalone RA normalization converts only standalone forms',()=>{
  assert.equal(normalizeStandaloneRa('RA R.A R.A. RAma'),'رَضِيَ ٱللَّٰهُ عَنْهُ رَضِيَ ٱللَّٰهُ عَنْهُ رَضِيَ ٱللَّٰهُ عَنْهُ RAma');
  assert.equal(normalizeStandaloneRa('(May Allah be pleased with Him) (May Allah be pleased with Her) (May Allah be pleased with them)'),'(رضي اللّه عنه) (رضي اللّه عنها) (رضي اللّه عنهم)');
});

test('RA normalization handles bare and comma-delimited salutations with spacing',()=>{
  assert.equal(normalizeStandaloneRa("Jabir bin 'Abdullah, may Allah be pleased with them,"), "Jabir bin 'Abdullah رضي اللّه عنهم");
  assert.equal(normalizeStandaloneRa("Jabir bin 'Abdullah may Allah be pleased with them"), "Jabir bin 'Abdullah رضي اللّه عنهم");
  assert.equal(normalizeStandaloneRa("Jabir bin 'Abdullah (may Allah be pleased with them)"), "Jabir bin 'Abdullah (رضي اللّه عنهم)");
});

test('salutation variants with Allah wording normalize to ﷺ',()=>{
  assert.equal(normalizeBlessing('Muhammad, peace and blessings of Allah upon him, and Muhammad, may peace and blessings of Allah upon him,'),'Muhammad ﷺ and Muhammad ﷺ');
  assert.equal(normalizeBlessing('Muhammad صلى الله عليه وسلم and Muhammad صلى الله عليه وسلم'),'Muhammad ﷺ and Muhammad ﷺ');
  assert.equal(normalizeBlessing('Muhammad صلى الله عليه و سلم'),'Muhammad ﷺ');
});

test('Allah wording preserves one space before ﷺ',()=>{
  assert.equal(normalizeBlessing('Messenger of Allah, peace and blessings of Allah upon him,'), 'Messenger of Allah ﷺ');
  assert.equal(normalizeBlessing('Messenger of Allah (peace and blessings of Allah upon him)'), 'Messenger of Allah (ﷺ)');
});

test('Prophet blessing wording normalizes with a separating space',()=>{
  assert.equal(normalizeBlessing('Prophet, may Allah bless him and grant him peace used'), 'Prophet ﷺ used');
  assert.equal(normalizeBlessing('Prophet, may Allah bless him and grant him peace, used'), 'Prophet ﷺ used');
  assert.equal(normalizeBlessing('Prophet (may Allah bless him and grant him peace) used'), 'Prophet (ﷺ) used');
});

test('Prophet blessing conversion is independent of the preceding word',()=>{
  assert.equal(normalizeBlessing(', may Allah bless him and grant him peace used'), 'ﷺ used');
  assert.equal(normalizeBlessing('Messenger, may Allah bless him and grant him peace, used'), 'Messenger ﷺ used');
  assert.equal(normalizeBlessing('X may Allah bless him and grant him peace used'), 'X ﷺ used');
});

test('new Allah blessing variants normalize correctly',()=>{
  assert.equal(normalizeBlessing('Muhammad, may Allah bless him and grant him peace, and Muhammad (may Allah bless him and grant him peace)'), 'Muhammad ﷺ and Muhammad (ﷺ)');
});

test('default text conversions normalize Verse, Verses, Ayat and Ayât to Ayah',()=>{
  assert.equal(applyEnglishReplacements('Verse Verses Ayat Ayât',DEFAULT_REPLACEMENT_RULES),'Ayah Ayah Ayah Ayah');
});


test('canonical fetched text transformation pipeline preserves stage order and master toggle', () => {
  const options = {
    textConversionsEnabled: true,
    blessingNormalization: true,
    raNormalization: true,
    romanEnglish: true,
    codeSyntaxMode: 'none' as const,
    replacementRules: DEFAULT_REPLACEMENT_RULES,
  };
  assert.equal(
    transformFetchedEnglishText('Messenger, may Allah bless him and grant him peace, said `Umar and Lord in Verse', options),
    'Messenger ﷺ said `Umar and Rabb in Ayah',
  );
  assert.equal(transformFetchedEnglishText('Messenger, may Allah bless him and grant him peace, said', {...options, textConversionsEnabled:false}), 'Messenger, may Allah bless him and grant him peace, said');
  assert.equal(transformFetchedArabicText('وَقَالَ رَسُولُ اللهِ صلى الله عليه وسلم', options), 'وَقَالَ رَسُولُ اللهِ ﷺ');
});
