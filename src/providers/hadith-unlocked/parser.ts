import type { CollectionDefinition, HadithGrade, HadithReference, HadithResult } from '../../domain/models';

interface HadithUnlockedGradeLike {
  grade?: unknown;
  grade_en?: unknown;
  grade_ar?: unknown;
  grader?: unknown;
  grader_en?: unknown;
  grader_ar?: unknown;
  shortName?: unknown;
  shortName_en?: unknown;
  shortName_ar?: unknown;
  name?: unknown;
  name_en?: unknown;
  name_ar?: unknown;
  source?: unknown;
  source_en?: unknown;
  source_ar?: unknown;
}

interface HadithUnlockedItem {
  ref?: unknown; num?: unknown; num_ar?: unknown; number?: unknown;
  body?: unknown; body_en?: unknown; body_ar?: unknown;
  text?: unknown; text_arabic?: unknown; text_english?: unknown;
  full_arabic?: unknown; full_english?: unknown;
  isnad?: unknown; isnad_ar?: unknown; arabic_isnad?: unknown;
  chain?: unknown; chain_ar?: unknown; sanad?: unknown; sanad_ar?: unknown;
  isnad_en?: unknown; english_isnad?: unknown; chain_en?: unknown;
  grade?: unknown;
  grade_grade?: unknown; grade_grade_en?: unknown; grade_grade_ar?: unknown;
  grader_shortName?: unknown; grader_shortName_en?: unknown; grader_shortName_ar?: unknown;
  grader_name?: unknown; grader_name_en?: unknown; grader_name_ar?: unknown;
  graded_by?: unknown; graded_by_en?: unknown; graded_by_ar?: unknown;
  grades?: unknown;
  source?: unknown; metadata?: unknown; title?: unknown;
  title_en?: unknown; book_shortName?: unknown; book_shortName_en?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
// Offline book-v44 data stores numbers as strings, while single-Hadith API
// responses use JSON numbers. Matching must accept both.
function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
function decodeEntities(value: string): string {
  return value
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;|&#x22;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}
function nestedText(value: unknown, keys: readonly string[]): string | undefined {
  const direct = str(value); if (direct) return direct;
  if (!isRecord(value)) return undefined;
  for (const key of keys) { const candidate = str(value[key]); if (candidate) return candidate; }
  return undefined;
}

function extractArabicIsnad(item: HadithUnlockedItem): string | undefined {
  const candidates = [
    nestedText(item.isnad_ar, ['text','body','arabic','ar']), nestedText(item.arabic_isnad, ['text','body','arabic','ar']),
    nestedText(item.chain_ar, ['text','body','arabic','ar']), nestedText(item.sanad_ar, ['text','body','arabic','ar']),
    nestedText(item.isnad, ['text','body','arabic','ar']), nestedText(item.chain, ['text','body','arabic','ar']), nestedText(item.sanad, ['text','body','arabic','ar'])
  ];
  return candidates.find((value): value is string => Boolean(value && /[\u0600-\u06FF]/u.test(value)));
}
function extractEnglishIsnad(item: HadithUnlockedItem): string | undefined {
  const candidates = [nestedText(item.isnad_en,['text','body','english','en']),nestedText(item.english_isnad,['text','body','english','en']),nestedText(item.chain_en,['text','body','english','en']),nestedText(item.chain,['text','body','english','en'])];
  return candidates.find((value): value is string => Boolean(value));
}
function referenceKey(value: unknown): string | undefined {
  const text = scalarText(value);
  return text?.toLowerCase();
}

function itemMatchesReference(item: HadithUnlockedItem, reference: HadithReference): boolean {
  const target = String(reference.hadithNumber).trim().toLowerCase();
  const expectedRef = `${reference.collectionId}:${target}`.toLowerCase();
  const source = isRecord(item.source) ? item.source : undefined;
  // `ref` is collection-scoped ("adab:1"); commentary collections expose the
  // underlying narration through `source.ref` ("bukhari:1") instead.
  const refs = [item.ref, source?.ref];
  if (refs.some(value => referenceKey(value) === expectedRef)) return true;
  const numbers = [item.number, item.num];
  return numbers.some(value => referenceKey(value) === target);
}

interface BookEntry { item: HadithUnlockedItem; section?: string }

/**
 * Flatten a downloaded Hadith Unlocked book. Installed databases use the
 * `book-v44` payload (`chapters[].sections[].items[]`), while API responses are
 * flat arrays or `{ result: [] }` wrappers.
 */
function bookEntries(raw: unknown): BookEntry[] | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.chapters)) return undefined;
  const entries: BookEntry[] = [];
  for (const chapter of raw.chapters) {
    if (!isRecord(chapter) || !Array.isArray(chapter.sections)) continue;
    for (const section of chapter.sections) {
      if (!isRecord(section) || !Array.isArray(section.items)) continue;
      const sectionNumber = scalarText(section.number);
      for (const item of section.items) {
        if (isRecord(item)) entries.push({ item, section: sectionNumber });
      }
    }
  }
  return entries;
}

function apiCandidates(raw: unknown): HadithUnlockedItem[] {
  const candidates: HadithUnlockedItem[] = [];
  if (Array.isArray(raw)) candidates.push(...raw.filter(isRecord) as HadithUnlockedItem[]);
  else if (isRecord(raw) && Array.isArray(raw.result)) candidates.push(...raw.result.filter(isRecord) as HadithUnlockedItem[]);
  else if (isRecord(raw)) candidates.push(raw);
  return candidates;
}

/**
 * Select the requested Hadith from either a complete installed book or a single
 * API response. For books, an unmatched reference is a real miss and must not
 * silently fall back to the first Hadith in the collection.
 */
function pickItem(raw: unknown, reference: HadithReference): HadithUnlockedItem | undefined {
  const entries = bookEntries(raw);
  if (entries) {
    const exact = entries.find(entry => itemMatchesReference(entry.item, reference));
    if (exact) return exact.item;
    // Commentary collections number their entries by lesson ("1", "1-2", "44b").
    // The web route resolves such a number to the first narration of that section.
    const target = String(reference.hadithNumber).trim().toLowerCase();
    return entries.find(entry => entry.section?.toLowerCase() === target)?.item;
  }
  const candidates = apiCandidates(raw);
  return candidates.find(item => itemMatchesReference(item, reference)) ?? candidates[0];
}

function gradeTextAndGrader(raw: unknown, item: HadithUnlockedItem): { text?: string; grader?: string } {
  const obj = isRecord(raw) ? raw as HadithUnlockedGradeLike : undefined;
  let text = str(obj?.grade_en) ?? str(obj?.grade) ?? str(item.grade_grade_en) ?? str(item.grade_grade);
  let grader = str(obj?.shortName_en) ?? str(obj?.grader_en) ?? str(obj?.name_en) ?? str(obj?.source_en)
    ?? str(item.grader_shortName_en) ?? str(item.grader_name_en) ?? str(item.graded_by_en)
    ?? str(obj?.shortName) ?? str(obj?.grader) ?? str(obj?.name) ?? str(obj?.source)
    ?? str(item.grader_shortName) ?? str(item.grader_name) ?? str(item.graded_by);
  if (!text) return {};
  // Some responses include the grader in the grade text itself, e.g. "Sound (Muslim)".
  const match = text.match(/^(.*?)\s*\(([^()]{2,120})\)\s*$/);
  const gradePart = match?.[1]?.trim();
  const graderPart = match?.[2]?.trim();
  if (!grader && gradePart && graderPart) { text = gradePart; grader = graderPart; }
  return {text,grader};
}

function gradeFromItem(item: HadithUnlockedItem): HadithGrade[] {
  const rawGrades: unknown[]=[];
  if (Array.isArray(item.grades)) rawGrades.push(...(item.grades as unknown[]));
  const metadata = isRecord(item.metadata) ? item.metadata : undefined;
  if (Array.isArray(metadata?.grades)) rawGrades.push(...(metadata.grades as unknown[]));
  if (item.grade !== undefined) rawGrades.push(item.grade);
  if (!rawGrades.length && (str(item.grade_grade_en) || str(item.grade_grade))) rawGrades.push(item);
  const out: HadithGrade[]=[]; const seen=new Set<string>();
  for (const raw of rawGrades) {
    const {text,grader}=gradeTextAndGrader(raw,item); if (!text) continue;
    const key=`${grader?.normalize('NFKC').trim().toLocaleLowerCase('en-US') ?? ''}\u0000${text.normalize('NFKC').trim().toLocaleLowerCase('en-US')}`;
    if (seen.has(key)) continue; seen.add(key);
    out.push({id:`grade:${key}`,text,...(grader ? {author: grader} : {})});
  }
  return out;
}

export function parseHadithUnlockedResponse(raw: unknown, reference: HadithReference, collection: CollectionDefinition, sourceUrl: string): HadithResult {
  const item = pickItem(raw, reference);
  const collectionName=decodeEntities(collection.name);
  if(!item) return {kind:'hadith',reference,collectionName,grades:[],source:{providerId:collection.providerId,providerName:'Hadith Unlocked',sourceUrl,retrievedAt:new Date().toISOString(),collectionId:collection.id,collectionName}};
  const result:HadithResult={kind:'hadith',reference,collectionName,grades:gradeFromItem(item),source:{providerId:collection.providerId,providerName:'Hadith Unlocked',sourceUrl,retrievedAt:new Date().toISOString(),collectionId:collection.id,collectionName}};
  // Downloaded books escape the isnad separator as `&gt;`; online responses do not.
  const text=(value:string|undefined)=>value ? decodeEntities(value) : undefined;
  const arabic=text(str(item.body)??str(item.body_ar)??str(item.text_arabic)??str(item.full_arabic)??nestedText(item.text,['ar','arabic']));
  const english=text(str(item.body_en)??str(item.text_english)??str(item.full_english)??nestedText(item.text,['en','english']));
  const arabicIsnad=text(extractArabicIsnad(item)); const englishIsnad=text(extractEnglishIsnad(item));
  const title=text(nestedText(item.title,['en','english']) ?? str(item.title_en));
  if(title) result.title=title; if(arabicIsnad) result.arabicIsnad=arabicIsnad; if(englishIsnad) result.englishIsnad=englishIsnad; if(arabic) result.arabic=arabic; if(english) result.english=english;
  return result;
}
