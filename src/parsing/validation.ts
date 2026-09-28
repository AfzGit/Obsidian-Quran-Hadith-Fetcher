import type { CollectionDefinition, HadithReference, QuranReference } from '../domain/models';

function hadithNumberValue(value: HadithReference['hadithNumber']): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d{1,6}$/u.test(value)) return Number(value);
  return null;
}

function isValidHadithNumber(value: HadithReference['hadithNumber'], allowAlphabetic: boolean): boolean {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0;
  return allowAlphabetic ? /^\d{1,6}[a-z]?$/iu.test(value) : /^\d{1,6}$/u.test(value);
}

const AYAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,25,11,8,9,10,11,12,12,7,8,9,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6,3,6,3,5,4,5,6];

/**
 * Validate semantic Quran constraints after parsing. Returning a message rather than
 * throwing makes this suitable for live modal validation and keeps bad user input
 * out of the exception path.
 */
export function validateQuranReference(reference: QuranReference, maxRange?: number): string | null {
  if (!Number.isInteger(reference.surah) || reference.surah < 1 || reference.surah > 114) return 'Invalid Surah.';
  const max = AYAH_COUNTS[reference.surah - 1];
  if (!max) return 'Invalid Surah.';
  if (!Number.isInteger(reference.startAyah) || reference.startAyah < 1 || reference.startAyah > max) return 'Invalid Ayah.';
  if (!Number.isInteger(reference.endAyah) || reference.endAyah < 1 || reference.endAyah > max) return 'Invalid Ayah.';
  if (reference.startAyah > reference.endAyah) return 'Invalid range: start must be less than or equal to end.';
  if (maxRange !== undefined && reference.endAyah - reference.startAyah + 1 > maxRange) return `Quran fetch limit is ${maxRange} ayahs.`;
  return null;
}

/**
 * Validate a Hadith reference against the known collection catalog and range limits.
 * The function is deterministic and does not ask a remote provider whether a number
 * currently exists.
 */
export function validateHadithReference(reference: HadithReference, collections: CollectionDefinition[], maxRange?: number): string | null {
  const collection = collections.find((item) => item.id === reference.collectionId);
  if (!collection) return 'Unknown collection.';
  const allowAlphabetic = collection.id === 'muslim';
  if (!isValidHadithNumber(reference.hadithNumber, allowAlphabetic)) return 'Invalid Hadith reference.';
  const end = reference.endHadithNumber ?? reference.hadithNumber;
  if (!isValidHadithNumber(end, allowAlphabetic)) return 'Invalid Hadith range.';

  const startNumeric = hadithNumberValue(reference.hadithNumber);
  const endNumeric = hadithNumberValue(end);
  if (startNumeric === null || endNumeric === null) {
    if (reference.endHadithNumber !== undefined) return 'Alphabetic Hadith ranges are not supported; enter a single reference such as 202a.';
    return null;
  }
  if (startNumeric > endNumeric) return 'Invalid range: start must be less than or equal to end.';
  if (maxRange !== undefined && endNumeric - startNumeric + 1 > maxRange) return `Hadith fetch limit is ${maxRange} hadiths.`;
  return null;
}

export { AYAH_COUNTS };
