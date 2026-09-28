import type { HadithReference, QuranReference } from '../domain/models';

export interface ParsedQuranReference {
  reference: QuranReference;
  complete: true;
}

export interface ParsedHadithReference {
  reference: HadithReference;
  complete: true;
}

const HADITH_ALIASES: Record<string, string> = {
  bukhari: 'bukhari',
  'sahih al-bukhari': 'bukhari',
  'sahih bukhari': 'bukhari',
  muslim: 'muslim',
  'sahih muslim': 'muslim',
  abudawud: 'abudawud',
  'abu dawud': 'abudawud',
  'sunan abu dawud': 'abudawud',
  tirmidhi: 'tirmidhi',
  'jami at-tirmidhi': 'tirmidhi',
  'jami al-tirmidhi': 'tirmidhi',
  nasai: 'nasai',
  'sunan an-nasai': 'nasai',
  'sunan al-nasai': 'nasai',
  ibnmajah: 'ibnmajah',
  'ibn majah': 'ibnmajah',
  'sunan ibn majah': 'ibnmajah',
  ahmad: 'ahmad',
  darimi: 'darimi',
  malik: 'malik',
  'muwatta malik': 'malik',
  dehlawi: 'dehlawi',
  nawawi: 'nawawi',
  qudsi: 'qudsi',
  nawawi40: 'nawawi40',
  qudsi40: 'qudsi40',
  shahwaliullah40: 'shahwaliullah40',
  riyadussalihin: 'riyadussalihin',
  mishkat_almasabih: 'mishkat_almasabih',
  aladab_almufrad: 'aladab_almufrad',
  shamail_muhammadiyah: 'shamail_muhammadiyah',
  bulugh_almaram: 'bulugh_almaram',
};

function normalizeInput(input: string): string {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/**
 * Parse the user-facing Quran reference grammar into the provider-neutral model.
 * Syntax is handled here; semantic checks such as whether an ayah exists belong to
 * validation so parsing remains deterministic and provider-agnostic.
 */
export function parseQuranReference(input: string): QuranReference | null {
  const value = normalizeInput(input);
  const match = /^(\d{1,3})\s*:\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const surah = Number(match[1]);
  const startAyah = Number(match[2]);
  const endAyah = match[3] ? Number(match[3]) : startAyah;
  return { kind: 'quran', surah, startAyah, endAyah };
}

/**
 * Parse compact Hadith reference syntax, including supported collection aliases.
 * This function performs no provider I/O or existence checks; those concerns remain
 * in validation and the selected provider.
 */
export function parseHadithReference(input: string): HadithReference | null {
  const value = normalizeInput(input);
  const match = /^(.+?)\s*:\s*(\d{1,6}[a-z]?)(?:\s*[-–—]\s*(\d{1,6}[a-z]?))?$/iu.exec(value);
  if (!match) return null;
  const alias = match[1]?.toLocaleLowerCase('en-US');
  if (!alias) return null;
  const collectionId = HADITH_ALIASES[alias];
  if (!collectionId) return null;
  const rawHadithNumber = match[2]!;
  const rawEndHadithNumber = match[3];
  const allowsAlphabeticNumbering = collectionId === 'muslim';
  const isValidNumber = (raw: string): boolean => allowsAlphabeticNumbering || /^\d{1,6}$/u.test(raw);
  if (!isValidNumber(rawHadithNumber) || (rawEndHadithNumber && !isValidNumber(rawEndHadithNumber))) return null;
  const hadithNumber = /^\d+$/u.test(rawHadithNumber) ? Number(rawHadithNumber) : rawHadithNumber.toLowerCase();
  const endHadithNumber = rawEndHadithNumber ? (/^\d+$/u.test(rawEndHadithNumber) ? Number(rawEndHadithNumber) : rawEndHadithNumber.toLowerCase()) : hadithNumber;
  return { kind: 'hadith', collectionId, hadithNumber, ...(endHadithNumber !== hadithNumber ? { endHadithNumber } : {}) };
}

export { HADITH_ALIASES };
