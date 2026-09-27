export type ProviderKind = 'quran' | 'hadith';

export interface ProviderCapabilities {
  arabicText: boolean;
  englishTranslation: boolean;
  multipleTranslations: boolean;
  collectionListing: boolean;
  rangeRetrieval: boolean;
  grading: boolean;
  metadata: boolean;
  directSourceUrls: boolean;
  search: boolean;
}

export interface ProviderMetadata {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  projectUrl: string;
}

export interface SourceMetadata {
  providerId: string;
  providerName: string;
  sourceUrl: string;
  retrievedAt: string;
  translationId?: string;
  translationName?: string;
  collectionId?: string;
  collectionName?: string;
}

export interface QuranReference {
  kind: 'quran';
  surah: number;
  startAyah: number;
  endAyah: number;
}

export interface HadithReference {
  kind: 'hadith';
  collectionId: string;
  hadithNumber: number;
  endHadithNumber?: number;
}

export interface Ayah {
  reference: QuranReference & { startAyah: number; endAyah: number };
  arabic?: string;
  translation?: Translation;
  footnotes?: QuranFootnote[];
}

export interface QuranFootnote {
  number: number;
  text: string;
}

export interface Translation {
  id: string;
  language: string;
  name: string;
  text: string;
  providerId: string;
}

export interface QuranResult {
  kind: 'quran';
  reference: QuranReference;
  surahName: string;
  ayahs: Ayah[];
  source: SourceMetadata;
}

export interface HadithGrade {
  id: string;
  text: string;
  author?: string;
}

export interface HadithResult {
  kind: 'hadith';
  reference: HadithReference;
  collectionName: string;
  title?: string;
  arabicIsnad?: string;
  arabic?: string;
  englishIsnad?: string;
  english?: string;
  grades: HadithGrade[];
  source: SourceMetadata;
}

export type QuranRangeMode = 'line-by-line' | 'merged' | 'alternate' | 'numbered';

export interface OutputOptions {
  arabic: boolean;
  english: boolean;
  grading: boolean;
  link: boolean;
  quranRangeMode: QuranRangeMode;
  quranFootnotes: boolean;
  hadithSeparateIsnad: boolean;
}

export interface TranslationDefinition {
  id: string;
  language: string;
  name: string;
  author?: string;
  providerId: string;
}

export interface CollectionDefinition {
  id: string;
  name: string;
  providerId: string;
  author?: string;
  arabicEdition?: string;
  englishEdition?: string;
}

export type CacheKey = string;

export interface CacheEntry<T> {
  version: 1;
  key: CacheKey;
  storedAt: number;
  value: T;
}
