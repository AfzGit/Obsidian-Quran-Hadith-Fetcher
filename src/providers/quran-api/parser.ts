import type { QuranReference } from '../../domain/models';
import { SURAH_NAMES } from '../../core/quran';

interface VerseLike {
  sura?: unknown;
  surah?: unknown;
  chapter?: unknown;
  chapterNumber?: unknown;
  aya?: unknown;
  ayah?: unknown;
  verse?: unknown;
  number?: unknown;
  numberInSurah?: unknown;
  text?: unknown;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function verseNumber(item: VerseLike): number | undefined {
  return numberOf(item.aya) ?? numberOf(item.ayah) ?? numberOf(item.verse) ?? numberOf(item.numberInSurah) ?? numberOf(item.number);
}

function surahNumber(item: VerseLike): number | undefined {
  return numberOf(item.sura) ?? numberOf(item.surah) ?? numberOf(item.chapterNumber) ?? numberOf(item.chapter);
}

function collect(value: unknown, out: VerseLike[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
    return;
  }
  const r = record(value);
  if (!r) return;
  const text = typeof r.text === 'string' ? r.text : undefined;
  if (text) out.push(r as VerseLike);
  for (const key of ['data', 'quran', 'chapter', 'ayahs', 'verses', 'items', 'result']) {
    if (key in r) collect(r[key], out);
  }
  for (const [key, child] of Object.entries(r)) {
    if (/^\d+:\d+$/u.test(key) && typeof child === 'string') {
      const [sura, aya] = key.split(':').map(Number);
      out.push({sura, aya, text:child});
    }
  }
}

export function parseQuranApiEdition(raw: unknown, reference: QuranReference): { surahName: string; verses: Map<number, string> } {
  const items: VerseLike[] = [];
  collect(raw, items);
  const verses = new Map<number, string>();
  for (const item of items) {
    const surah = surahNumber(item);
    const number = verseNumber(item);
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text || number === undefined) continue;
    if (surah !== undefined && surah !== reference.surah) continue;
    verses.set(number, text);
  }
  return {
    surahName: SURAH_NAMES[reference.surah - 1] ?? `Surah ${reference.surah}`,
    verses,
  };
}
