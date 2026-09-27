import type { CollectionDefinition, TranslationDefinition } from '../domain/models';

/**
 * Provider-independent Hadith collection metadata. Provider IDs are preserved;
 * only the human-facing name/author are normalized for collections that are
 * represented by more than one provider.
 */
const HADITH_CANONICAL: Record<string, Pick<CollectionDefinition,'name'|'author'>> = {
  bukhari: {name:'Sahih Al-Bukhari',author:'Imam Muhammad Ibn Ismail Al-Bukhari'},
  muslim: {name:'Sahih Muslim',author:'Imam Muslim Ibn Al-Hajjaj Al-Naysaburi'},
  abudawud: {name:'Sunan Abi Dawud',author:'Imam Sulayman Ibn Al-Ashath Abu Dawud Al-Sijistani'},
  tirmidhi: {name:"Jami' At-Tirmidhi",author:'Imam Abu Isa Muhammad Ibn Isa At-Tirmidhi'},
  nasai: {name:"Sunan An-Nasa'i",author:"Imam Ahmad Ibn Shu'ayb An-Nasa'i"},
  ibnmajah: {name:'Sunan Ibn Majah',author:'Imam Muhammad Ibn Yazid Ibn Majah Al-Qazwini'},
  malik: {name:'Muwatta Malik',author:'Imam Malik Ibn Anas'},
  ahmad: {name:'Musnad Ahmad Ibn Hanbal',author:'Imam Ahmad Ibn Hanbal'},
  darimi: {name:'Sunan Ad-Darimi',author:'Imam Abu Muhammad Abd Al-Rahman Ibn Abd Allah Al-Darimi'},
  nawawi40: {name:'The Forty Hadith of Imam Nawawi',author:'Imam Yahya Ibn Sharaf Al-Nawawi'},
  qudsi40: {name:'The Forty Hadith Qudsi'},
  shahwaliullah40: {name:'The Forty Hadith of Shah Waliullah',author:'Shah Waliullah Dahlawi'},
  riyadussalihin: {name:'Riyad As-Salihin',author:'Imam Yahya Ibn Sharaf Al-Nawawi'},
  mishkat_almasabih: {name:'Mishkat Al-Masabih',author:'Al-Khatib Al-Tabrizi'},
  aladab_almufrad: {name:'Al-Adab Al-Mufrad',author:'Imam Muhammad Ibn Ismail Al-Bukhari'},
  shamail_muhammadiyah: {name:"Shama'il Muhammadiyah",author:'Imam Tirmidhi'},
  bulugh_almaram: {name:'Bulugh Al-Maram',author:'Ibn Hajar Al-Asqalani'},
};

const HADITH_ALIASES: Record<string,string> = {
  riyad:'riyadussalihin',
  adab:'aladab_almufrad',
  shamail:'shamail_muhammadiyah',
  nawawi:'nawawi40',
  qudsi:'qudsi40',
  dehlawi:'shahwaliullah40',
};

/**
 * Normalize Hadith collection metadata at the provider boundary so naming differences
 * do not leak into settings, selection modals, or generated output.
 */
export function normalizeHadithCollectionMetadata(collection: CollectionDefinition): CollectionDefinition {
  const canonicalId = HADITH_ALIASES[collection.id] ?? collection.id;
  const canonical = HADITH_CANONICAL[canonicalId];
  if (!canonical) return {...collection};
  return {...collection,name:canonical.name,author:canonical.author};
}

/** Normalize common Quran translation metadata without inventing metadata for
 * providers that do not identify a translator. IDs/names from each provider
 * remain intact; only equivalent well-known translations are unified. */
const QURAN_TRANSLATION_PATTERNS: readonly {match:RegExp;name:string;author:string}[] = [
  {match:/hilali|muhammadtaqiudd|taqi[- ]?ud[- ]?din.*hilali.*muhsin.*khan|muhammad.*hilali.*muhsin.*khan/iu,name:"Interpretation of the Meanings of the Noble Quran",author:'Muhammad Taqi-ud-Din Al-Hilali and Muhammad Muhsin Khan'},
  {match:/abdel.?haleem|haleem/iu,name:"The Quran: A New Translation",author:'M. A. S. Abdel Haleem'},
  {match:/khattab/iu,name:'The Clear Quran',author:'Mustafa Khattab'},
  {match:/saheeh|sahih.*international|sahihinternational/iu,name:"The Quran",author:'Saheeh International'},
  {match:/bridges/iu,name:"Bridges' Translation of the Ten Qira'at of the Noble Quran",author:'Bridges Translation Center'},
  {match:/taqi[- ]?usmani|mufti.*usmani/iu,name:"The Meanings of the Noble Quran with Explanatory Notes",author:'Mufti Taqi Usmani'},
  {match:/talal.*itani|itani/iu,name:'Quran in English: Clear and Easy to Read',author:'Talal Itani'},
  {match:/bewley/iu,name:"The Noble Quran: A New Rendering of Its Meaning in English",author:'Aisha Bewley'},
  {match:/study.*quran|thestudyquran/iu,name:'The Study Quran: A New Translation and Commentary',author:'Seyyed Hossein Nasr et al.'},
  {match:/ghali|muhammadmahmoud/iu,name:"Towards Understanding the Ever-glorious Quran",author:'Muhammad Mahmud Ghali'},
  {match:/ahmedraza|raza.*khan/iu,name:'The Holy Quran',author:'Ahmed Raza Khan'},
  {match:/wahiduddin/iu,name:'The Quran: Translation and Commentary with Parallel Arabic Text',author:'Wahiduddin Khan'},
  {match:/qaribullah/iu,name:"The Holy Quran",author:'Hasan Al-Fatih Qaribullah and Ahmad Darwish'},
  {match:/busool/iu,name:"The Wise Quran: These Are the Verses of the Wise Book",author:'Busool'},
  {match:/tahir[- ]?ul[- ]?qadri|qadri/iu,name:'Irfan-ul-Quran',author:'Tahir-ul-Qadri'},
  {match:/rowwad/iu,name:'Explanation of the Meanings of the Noble Quran',author:'Rowwad Translation Center'},
  {match:/asad|muhammadasad/iu,name:"The Message of the Quran",author:'Muhammad Asad'},
  {match:/sarwar|muhammadsarwar/iu,name:"The Holy Quran: The Arabic Text and English Translation",author:'Muhammad Sarwar'},
  {match:/daryabadi/iu,name:'Tafseer-e-Majidi',author:'Abdul Majid Daryabadi'},
  {match:/shakir|mohammadhabibsh/iu,name:"The Quran",author:'Mohammad Habib Shakir'},
  {match:/pickthall|marmadu/iu,name:'The Meaning of the Glorious Koran',author:'Mohammed Marmaduke William Pickthall'},
  {match:/qarai|aliquliqarai/iu,name:"The Quran with an English Paraphrase",author:'Ali Quli Qarai'},
  {match:/yusuf.?ali|yusufaliorig/iu,name:"The Meaning of the Holy Quran",author:'Abdullah Yusuf Ali'},
];

/**
 * Normalize Quran translation metadata into the common catalog shape. This changes
 * descriptive metadata only; translation content must remain untouched.
 */
export function normalizeQuranTranslationMetadata(translation: TranslationDefinition): TranslationDefinition {
  const haystack = `${translation.id} ${translation.name} ${translation.author ?? ''}`;
  const canonical = QURAN_TRANSLATION_PATTERNS.find(item=>item.match.test(haystack));
  return canonical ? {...translation,name:canonical.name,author:canonical.author} : {...translation};
}
