import type { QuranReference, QuranResult, TranslationDefinition, Ayah, QuranFootnote } from '../../domain/models';

interface QuranUnlockedItem {
  ref?: string;
  num?: number | string;
  num_ar?: string;
  body?: string;
  body_en?: string;
  translation?: unknown;
  translations?: unknown;
  translation_id?: unknown;
  translation_name?: unknown;
  footnote_en?: unknown;
  footnotes_en?: unknown;
  body_en_translation_id?: unknown;
  chapter?: {
    title?: string;
    title_en?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function cleanEnglishTranslation(value: string): string {
  return value
    // Quran Unlocked may return JSON/HTML text with literal backslashes before punctuation.
    .replace(/\\n/g, '\n')
    .replace(/\\/g, '')
    // Preserve simple line breaks before removing presentation-only HTML.
    .replace(/<br\s*\/?>(?:\s*)/gi, '\n')
    .replace(/<\/?(?:section|p|div|span)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\d+:\d+\s+/, '')
    .trim();
}

function capitalizeSurahName(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}

function extractItems(raw: unknown): QuranUnlockedItem[] {
  if (Array.isArray(raw)) return raw.filter(isRecord) as QuranUnlockedItem[];
  if (isRecord(raw) && Array.isArray(raw.result)) return raw.result.filter(isRecord) as QuranUnlockedItem[];
  return [];
}

function itemAyahNumber(item: QuranUnlockedItem): number | undefined {
  if (typeof item.num === 'number' && Number.isInteger(item.num)) return item.num;
  if (typeof item.num === 'string') {
    const m = /:(\d+)$/.exec(item.num);
    const n = Number(m?.[1] ?? item.num);
    return Number.isInteger(n) ? n : undefined;
  }
  return undefined;
}

function cleanFootnoteText(value: string): string {
  return value
    .replace(/^\(V\.\s*\d+\s*:\s*\d+\s*\)\.?\s*/i, '')
    .replace(/^\[?\d+\]?\s*[:.)-]\s*/u, '')
    .replace(/^[:：]\s*/u, '')
    .trim();
}

function parseFootnoteField(value: unknown): QuranFootnote[] {
  if (typeof value === 'string') {
    const normalized = cleanEnglishTranslation(value);
    const chunks = normalized.split(/↩︎|↩/u).map(chunk => chunk.trim()).filter(Boolean);
    return chunks.map((text, index) => ({ number: index + 1, text: cleanFootnoteText(text) })).filter(note => note.text.length > 0);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => {
      if (typeof entry === 'string') return [{ number: index + 1, text: cleanFootnoteText(cleanEnglishTranslation(entry)) }];
      if (!isRecord(entry)) return [];
      const text = asNonEmptyString(entry.text) ?? asNonEmptyString(entry.body) ?? asNonEmptyString(entry.content);
      if (!text) return [];
      const numberValue = Number(entry.number ?? entry.num ?? index + 1);
      return [{ number: Number.isInteger(numberValue) ? numberValue : index + 1, text: cleanFootnoteText(cleanEnglishTranslation(text)) }];
    }).filter(note => note.text.length > 0);
  }
  if (isRecord(value)) {
    const text = asNonEmptyString(value.text) ?? asNonEmptyString(value.body) ?? asNonEmptyString(value.content);
    if (text) {
      const numberValue = Number(value.number ?? value.num ?? 1);
      return [{ number: Number.isInteger(numberValue) ? numberValue : 1, text: cleanFootnoteText(cleanEnglishTranslation(text)) }];
    }
  }
  return [];
}

function extractFootnotes(value: string, surah?: number, ayah?: number, auxiliary?: unknown): { text: string; footnotes: QuranFootnote[] } {
  // Hilali-Khan may inline its footnotes after `(V:S:A)`, or expose them in a
  // separate provider field. Prefer the explicit boundary, then use the
  // auxiliary field as a fallback for collapsed API responses.
  const versePattern = surah !== undefined && ayah !== undefined
    ? new RegExp(`\\(V\\.\\s*${surah}\\s*:\\s*${ayah}\\s*\\)\\.?\\s*`, 'i')
    : /\(V\.\s*\d+\s*:\s*\d+\s*\)\.?\s*/i;
  const noteStart = versePattern.exec(value);
  if (noteStart) {
    const mainText = value.slice(0, noteStart.index).trim();
    const noteSection = value.slice(noteStart.index + noteStart[0].length).trim();
    const footnotes = parseFootnoteField(noteSection);
    return { text: mainText, footnotes };
  }

  const auxiliaryNotes = parseFootnoteField(auxiliary);
  if (auxiliaryNotes.length) {
    const firstNote = auxiliaryNotes[0]?.text;
    if (firstNote) {
      const noteIndex = value.indexOf(firstNote);
      if (noteIndex >= 0) return { text: value.slice(0, noteIndex).trim(), footnotes: auxiliaryNotes };
    }
  }

  return { text: value.replace(/\s*↩︎\s*|\s*↩\s*/gu, ' ').trim(), footnotes: [] };
}

/**
 * Expand a provider item that represents multiple ayahs into individual internal
 * records. This keeps the final domain model one-ayah-per-entry, which simplifies
 * caching, range ordering, footnote association, and formatting downstream.
 */
function splitRangeItem(item: QuranUnlockedItem, reference: QuranReference): QuranUnlockedItem[] {
  if (reference.startAyah === reference.endAyah) return [item];
  const start = reference.startAyah;
  const end = reference.endAyah;
  const english = asNonEmptyString(item.body_en);
  const arabic = asNonEmptyString(item.body);
  if (!english && !arabic) return [item];

  // Some Quran Unlocked range responses collapse the entire selected range into
  // one provider record. Arabic verses are separated by the verse-end glyph,
  // while English translations use `↩︎ <next-ayah>` as the boundary.
  const englishByAyah = splitEnglishRangeByAyah(english, start, end);

  const arabicParts = arabic
    ? arabic.split(/۝/u).map(part => part.trim()).filter(Boolean)
    : [];

  const count = Math.max(arabicParts.length, englishByAyah.size);
  if (count <= 1) return [item];

  const result: QuranUnlockedItem[] = [];
  const auxiliaryFootnotes = asNonEmptyString(item.footnote_en) ?? asNonEmptyString(item.footnotes_en);
  for (let n = start; n <= end; n++) {
    const index = n - start;
    const child: QuranUnlockedItem = { ...item, ref: `${reference.kind}:${reference.surah}:${n}`, num: `${reference.surah}:${n}`, body: undefined, body_en: undefined, footnote_en: undefined, footnotes_en: undefined };
    if (arabicParts[index]) child.body = arabicParts[index];
    const en = englishByAyah.get(n);
    if (en) child.body_en = en;
    if (auxiliaryFootnotes) {
      const marker = new RegExp(`\\(V\\.\\s*${reference.surah}\\s*:\\s*${n}\\s*\\)`, 'ig');
      const markers = [...auxiliaryFootnotes.matchAll(marker)];
      if (markers.length) {
        const next = n < end
          ? new RegExp(`\\(V\\.\\s*${reference.surah}\\s*:\\s*${n + 1}\\s*\\)`, 'i').exec(auxiliaryFootnotes)
          : undefined;
        const from = markers[0]!.index ?? 0;
        const to = next?.index ?? auxiliaryFootnotes.length;
        child.footnote_en = auxiliaryFootnotes.slice(from, to);
      }
    }
    result.push(child);
  }
  return result;
}

interface ParsedTranslation {
  text: string;
  footnotes: QuranFootnote[];
}

function parseTranslation(value: string, surah?: number, ayah?: number, auxiliary?: unknown): ParsedTranslation {
  const cleaned = cleanEnglishTranslation(value);
  return extractFootnotes(cleaned, surah, ayah, auxiliary);
}

/**
 * Recover per-ayah English text when Quran Unlocked returns a range as one combined
 * translation string. The parser uses explicit ayah markers when available and falls
 * back conservatively rather than guessing a split that could attach text to the
 * wrong ayah.
 */
function splitEnglishRangeByAyah(value: string | undefined, start: number, end: number): Map<number, string> {
  const result = new Map<number, string>();
  if (!value) return result;
  if (start === end) {
    result.set(start, value.trim());
    return result;
  }

  let cursor = 0;
  for (let ayah = start; ayah < end; ayah++) {
    const nextAyah = ayah + 1;
    const boundary = new RegExp(`(?:^|\\s)(?:↩︎\\s*)?${nextAyah}\\s+`, 'u');
    const match = boundary.exec(value.slice(cursor));
    if (!match) {
      if (ayah === start) {
        result.set(start, value.trim());
      }
      return result;
    }

    const absolute = cursor + match.index;
    const boundaryText = match[0];
    result.set(ayah, value.slice(cursor, absolute).trim());
    cursor = absolute + boundaryText.length;
  }
  result.set(end, value.slice(cursor).trim());
  return result;
}

function translationTextForItem(item: QuranUnlockedItem, translation: TranslationDefinition, reference: QuranReference): ParsedTranslation | undefined {
  const target = translation.id.toLowerCase();
  const targetName = translation.name.toLowerCase();

  const consider = (candidate: unknown): ParsedTranslation | undefined => {
    if (typeof candidate === 'string') return parseTranslation(candidate, reference.surah, itemAyahNumber(item), item.footnote_en ?? item.footnotes_en);
    if (!isRecord(candidate)) return undefined;
    const id = asNonEmptyString(candidate.id)?.toLowerCase();
    const name = asNonEmptyString(candidate.name)?.toLowerCase();
    const alias = asNonEmptyString(candidate.alias)?.toLowerCase();
    const text = asNonEmptyString(candidate.text) ?? asNonEmptyString(candidate.body) ?? asNonEmptyString(candidate.content);
    if (text && (id === target || name === targetName || alias === target || alias === 'en-hilali-khan')) return parseTranslation(text, reference.surah, itemAyahNumber(item), item.footnote_en ?? item.footnotes_en);
    return undefined;
  };

  if (isRecord(item.translations)) {
    for (const [key, value] of Object.entries(item.translations)) {
      if (key.toLowerCase() === target || key.toLowerCase() === targetName || key.toLowerCase() === 'en-hilali-khan') {
        const parsed = consider(value);
        if (parsed) return parsed;
        if (typeof value === 'string' && value.trim()) return parseTranslation(value, reference.surah, itemAyahNumber(item), item.footnote_en ?? item.footnotes_en);
      }
      const parsed = consider(value);
      if (parsed) return parsed;
    }
  }
  if (Array.isArray(item.translations)) {
    for (const value of item.translations) {
      const parsed = consider(value);
      if (parsed) return parsed;
    }
  }
  if (item.translation) {
    const parsed = consider(item.translation);
    if (parsed) return parsed;
  }

  if (asNonEmptyString(item.body_en)) return parseTranslation(item.body_en!, reference.surah, itemAyahNumber(item), item.footnote_en ?? item.footnotes_en);
  return undefined;
}

/**
 * Quran Unlocked exposes its page API as the `?json` endpoint. The response is
 * an array whose items contain provider fields such as `body`, `body_en`, and
 * `chapter`. Keep the provider shape private to this parser.
 */
export function parseQuranUnlockedResponse(
  raw: unknown,
  reference: QuranReference,
  translation: TranslationDefinition,
): Omit<QuranResult, 'source'> {
  const items = extractItems(raw);
  const expandedItems = items.flatMap(item => splitRangeItem(item, reference));
  const byAyah = new Map<number, QuranUnlockedItem>();
  for (const item of expandedItems) {
    const n = itemAyahNumber(item);
    if (n !== undefined && n >= reference.startAyah && n <= reference.endAyah && !byAyah.has(n)) byAyah.set(n, item);
  }

  const first = items[0];
  const surahName = asNonEmptyString(first?.chapter?.title_en)
    ? capitalizeSurahName(String(first?.chapter?.title_en))
    : asNonEmptyString(first?.chapter?.title)
      ? capitalizeSurahName(String(first?.chapter?.title))
      : `Surah ${reference.surah}`;

  const ayahs: Ayah[] = [];
  for (let n = reference.startAyah; n <= reference.endAyah; n++) {
    const item = byAyah.get(n);
    if (!item) continue;
    const ayah: Ayah = {
      reference: { kind: 'quran', surah: reference.surah, startAyah: n, endAyah: n },
    };
    const arabic = asNonEmptyString(item.body);
    const english = translationTextForItem(item, translation, reference);
    if (arabic) ayah.arabic = arabic;
    if (english) {
      ayah.translation = {
        id: translation.id,
        language: translation.language,
        name: translation.name,
        text: english.text,
        providerId: translation.providerId,
      };
      if (english.footnotes.length) ayah.footnotes = english.footnotes;
    }
    ayahs.push(ayah);
  }

  return { kind: 'quran', reference, surahName, ayahs };
}
