import type { CollectionDefinition, HadithGrade, HadithReference, HadithResult, TranslationDefinition } from '../../domain/models';

interface ApiGrade { name?: unknown; grade?: unknown; grader?: unknown; author?: unknown; source?: unknown; name_en?: unknown; name_ar?: unknown; grader_en?: unknown; grader_ar?: unknown; }
interface ApiHadith { hadithnumber?: string|number; text?: string; grades?: unknown; }
interface ApiContainer { metadata?: { name?: string; nameEn?: string }; hadiths?: ApiHadith[]; }

function gradeKey(value: string): string { return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'); }

function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

function normalizeGrades(value: unknown): Array<{name?: string; grade?: string}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((g) => {
    if (!isRecord(g)) return [];
    const grade = str(g.grade) ?? str(g.text) ?? str(g.grade_en) ?? str(g.grade_ar);
    const name = str(g.name) ?? str(g.grader) ?? str(g.author) ?? str(g.source) ?? str(g.name_en) ?? str(g.name_ar) ?? str(g.grader_en) ?? str(g.grader_ar);
    return grade ? [{ name, grade }] : [];
  });
}

function gradesFromHadith(...hadiths: Array<ApiHadith|undefined>): HadithGrade[] {
  const out: HadithGrade[] = [];
  const seen = new Set<string>();
  for (const hadith of hadiths) {
    for (const g of normalizeGrades(hadith?.grades)) {
      if (!g.grade) continue;
      const key = `${gradeKey(g.name ?? '')}\u0000${gradeKey(g.grade)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: key, text: g.grade, ...(g.name ? { author: g.name } : {}) });
    }
  }
  return out;
}

export function parseHadithApiResponse(arabicRaw: unknown, englishRaw: unknown, reference: HadithReference, collectionName: string, providerId: string, translation?: TranslationDefinition): HadithResult {
  const arHadith = selectHadith(arabicRaw, reference.hadithNumber);
  const enHadith = selectHadith(englishRaw, reference.hadithNumber);
  const ar = arHadith?.text;
  const grades = gradesFromHadith(enHadith, arHadith);
  const result: HadithResult = { kind:'hadith', reference, collectionName, grades, source: { providerId, providerName: providerId, sourceUrl: `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${translation?.id ?? 'eng'}-${reference.collectionId}/${reference.hadithNumber}.min.json`, retrievedAt: new Date().toISOString(), collectionId: reference.collectionId, collectionName } };
  if (ar) result.arabic = ar;
  if (enHadith?.text) result.english = enHadith.text;
  return result;
}

function selectHadith(raw: unknown, no: number | string): ApiHadith|undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const root = raw as ApiContainer;
  const target = String(no).trim().toLowerCase();
  const matches = (h: ApiHadith | undefined): boolean => h != null && String(h.hadithnumber ?? '').trim().toLowerCase() === target;
  return root.hadiths?.find(matches) ?? (('hadithnumber' in root) && matches(root as unknown as ApiHadith) ? root as unknown as ApiHadith : undefined);
}

