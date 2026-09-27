import type { CollectionDefinition } from '../../domain/models';

export const HADITH_API_COLLECTIONS: readonly CollectionDefinition[] = [
  {id:'abudawud',name:'Sunan Abi Dawud',providerId:'hadith-api',author:'Abu Dawud Sulayman Ibn Al-Ashath Al-Sijistani',arabicEdition:'ara-abudawud',englishEdition:'eng-abudawud'},
  {id:'bukhari',name:'Sahih Al-Bukhari',providerId:'hadith-api',author:'Muhammad Ibn Ismail Al-Bukhari',arabicEdition:'ara-bukhari',englishEdition:'eng-bukhari'},
  {id:'dehlawi',name:'Forty Hadith of Shah Waliullah Dehlawi',providerId:'hadith-api',author:'Shah Waliullah Al-Dihlawi',arabicEdition:'ara-dehlawi',englishEdition:'eng-dehlawi'},
  {id:'ibnmajah',name:'Sunan Ibn Majah',providerId:'hadith-api',author:'Muhammad Ibn Yazid Ibn Majah Al-Qazwini',arabicEdition:'ara-ibnmajah',englishEdition:'eng-ibnmajah'},
  {id:'malik',name:'Muwatta Malik',providerId:'hadith-api',author:'Malik Ibn Anas',arabicEdition:'ara-malik',englishEdition:'eng-malik'},
  {id:'muslim',name:'Sahih Al-Muslim',providerId:'hadith-api',author:'Muslim Ibn Al-Hajjaj Al-Naysaburi',arabicEdition:'ara-muslim',englishEdition:'eng-muslim'},
  {id:'nasai',name:"Sunan An-Nasa'i",providerId:'hadith-api',author:'Ahmad Ibn Shuayb Al-Nasai',arabicEdition:'ara-nasai',englishEdition:'eng-nasai'},
  {id:'nawawi',name:'Forty Hadith of an-Nawawi',providerId:'hadith-api',author:'Yahya Ibn Sharaf Al-Nawawi',arabicEdition:'ara-nawawi',englishEdition:'eng-nawawi'},
  {id:'qudsi',name:'Forty Hadith Qudsi',providerId:'hadith-api',author:'Ezzeddin Ibrahim',arabicEdition:'ara-qudsi',englishEdition:'eng-qudsi'},
  {id:'tirmidhi',name:'Sunan At-Tirmidhi',providerId:'hadith-api',author:'Abu Isa Muhammad Ibn Isa Al-Tirmidhi',arabicEdition:'ara-tirmidhi',englishEdition:'eng-tirmidhi'},
];
