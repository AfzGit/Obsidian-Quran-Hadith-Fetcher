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
  ref?: unknown; num?: unknown; num_ar?: unknown;
  body?: unknown; body_en?: unknown; body_ar?: unknown;
  text?: unknown; text_arabic?: unknown; text_english?: unknown;
  full_arabic?: unknown; full_english?: unknown;
  isnad?: unknown; isnad_ar?: unknown; arabic_isnad?: unknown;
  chain?: unknown; chain_ar?: unknown; sanad?: unknown; sanad_ar?: unknown;
  isnad_en?: unknown; english_isnad?: unknown; chain_en?: unknown;
  grade?: HadithUnlockedGradeLike | string | unknown;
  grade_grade?: unknown; grade_grade_en?: unknown; grade_grade_ar?: unknown;
  grader_shortName?: unknown; grader_shortName_en?: unknown; grader_shortName_ar?: unknown;
  grader_name?: unknown; grader_name_en?: unknown; grader_name_ar?: unknown;
  graded_by?: unknown; graded_by_en?: unknown; graded_by_ar?: unknown;
  grades?: unknown;
  title_en?: unknown; book_shortName?: unknown; book_shortName_en?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function decodeCollectionName(value: string): string {
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
  const candidates = [nestedText(item.isnad_en,['text','body','english','en']),nestedText(item.english_isnad,['text','body','english','en']),nestedText(item.chain_en,['text','body','english','en'])];
  return candidates.find((value): value is string => Boolean(value));
}
function itemMatchesReference(item: HadithUnlockedItem, reference: HadithReference): boolean {
  const ref = str(item.ref)?.toLowerCase(); if (ref) return ref === `${reference.collectionId}:${reference.hadithNumber}`.toLowerCase();
  const num = Number(item.num); return Number.isInteger(num) && num === reference.hadithNumber;
}
function firstItem(raw: unknown, reference: HadithReference): HadithUnlockedItem | undefined {
  const candidates: HadithUnlockedItem[]=[];
  if (Array.isArray(raw)) candidates.push(...raw.filter(isRecord) as HadithUnlockedItem[]);
  else if (isRecord(raw) && Array.isArray(raw.result)) candidates.push(...raw.result.filter(isRecord) as HadithUnlockedItem[]);
  else if (isRecord(raw)) candidates.push(raw as HadithUnlockedItem);
  return candidates.find(item=>itemMatchesReference(item,reference)) ?? candidates[0];
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
  if (!grader && match?.[2]) { text = match[1]!.trim(); grader = match[2]!.trim(); }
  return {text,grader};
}

function gradeFromItem(item: HadithUnlockedItem): HadithGrade[] {
  const rawGrades: unknown[]=[];
  if (Array.isArray(item.grades)) rawGrades.push(...item.grades);
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
  const item=firstItem(raw,reference);
  const collectionName=decodeCollectionName(collection.name);
  if(!item) return {kind:'hadith',reference,collectionName,grades:[],source:{providerId:collection.providerId,providerName:'Hadith Unlocked',sourceUrl,retrievedAt:new Date().toISOString(),collectionId:collection.id,collectionName}};
  const result:HadithResult={kind:'hadith',reference,collectionName,grades:gradeFromItem(item),source:{providerId:collection.providerId,providerName:'Hadith Unlocked',sourceUrl,retrievedAt:new Date().toISOString(),collectionId:collection.id,collectionName}};
  const arabic=str(item.body)??str(item.body_ar)??str(item.text_arabic)??str(item.full_arabic)??str(item.text);
  const english=str(item.body_en)??str(item.text_english)??str(item.full_english);
  const arabicIsnad=extractArabicIsnad(item); const englishIsnad=extractEnglishIsnad(item);
  if(arabicIsnad) result.arabicIsnad=arabicIsnad; if(englishIsnad) result.englishIsnad=englishIsnad; if(arabic) result.arabic=arabic; if(english) result.english=english;
  return result;
}
