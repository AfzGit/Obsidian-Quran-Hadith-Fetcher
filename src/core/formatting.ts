import type { HadithResult, QuranResult } from '../domain/models';
import { formatScholarName } from './names';

export type ContentMode = 'arabic' | 'english' | 'grading';
export interface FormattingConfig {
  entirePrefix: string;
  entireSuffix: string;
  linePrefix: string;
  lineSuffix: string;
  arabicOpen: string;
  arabicClose: string;
  englishOpen: string;
  englishClose: string;
  hadithOpen: string;
  hadithClose: string;
  callout: 'none'|'quote'|'note'|'abstract'|'info'|'todo'|'tip'|'success'|'question'|'warning'|'failure'|'danger'|'bug'|'example'|'cite'|'custom';
  customCalloutType: string;
  showLink: boolean;
  ayahNumberOpen: string;
  ayahNumberClose: string;
  arabicAyahNumbers: boolean;
  ayahNumberStyle?: 'angle'|'square'|'round'|'curly'|'heavyAngle'|'ceiling'|'floor'|'heavyAngleAlt'|'lenticular'|'custom';
  quranAyahOpen: string;
  quranAyahClose: string;
  quranAyahStyle?: 'curly'|'square'|'round'|'angle'|'heavyAngle'|'ceiling'|'floor'|'heavyAngleAlt'|'lenticular'|'custom';
  codeSyntaxMode: 'replace'|'remove'|'none';
}

export interface FormatOptions {
  arabic: boolean;
  english: boolean;
  grading: boolean;
}

export const DEFAULT_FORMATTING: FormattingConfig = {
  entirePrefix: '',
  entireSuffix: '',
  linePrefix: '> ',
  lineSuffix: '',
  arabicOpen: '{',
  arabicClose: '}',
  englishOpen: '{',
  englishClose: '}',
  hadithOpen: '',
  hadithClose: '',
  callout: 'quote',
  customCalloutType: '',
  showLink: true,
  ayahNumberOpen: '⟪',
  ayahNumberClose: '⟫',
  arabicAyahNumbers: true,
  quranAyahOpen: '{',
  quranAyahClose: '}',
  quranAyahStyle: 'curly',
  codeSyntaxMode: 'replace',
};

function wrapLine(text: string, prefix: string, suffix: string): string { return `${prefix}${text}${suffix}`; }
function prefixCallout(cfg: FormattingConfig): string {
  if (cfg.callout === 'none') return '';
  const type = cfg.callout === 'custom' ? cfg.customCalloutType.trim() : cfg.callout;
  return type ? `> [!${type.charAt(0).toUpperCase()}${type.slice(1)}] ` : '';
}
function contentLinePrefix(cfg: FormattingConfig): string { return prefixCallout(cfg) ? cfg.linePrefix : ''; }
function separatorLine(cfg: FormattingConfig): string { return prefixCallout(cfg) ? '>' : ''; }
function gradeDisplay(grade: HadithResult['grades'][number]): string { return `${grade.text}${grade.author ? ` (${formatScholarName(grade.author)})` : ''}`; }
const ARABIC_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'] as const;

function formatAyahDigits(number: number, arabic: boolean): string {
  const value = String(number);
  return arabic ? value.replace(/\d/g, digit => ARABIC_DIGITS[Number(digit)]!) : value;
}

function formatAyahNumber(number: number, cfg: FormattingConfig, arabic: boolean): string {
  return `${cfg.ayahNumberOpen}${formatAyahDigits(number, arabic)}${cfg.ayahNumberClose}`;
}
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&quot;|&#x22;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));
}

function quranTranslationText(
  ayah: QuranResult['ayahs'][number],
  showFootnotes: boolean,
  renumbered?: ReadonlyMap<number, number>,
): string {
  const text = ayah.translation?.text ?? '';
  if (!showFootnotes) {
    if (!ayah.footnotes?.length) return text;
    const numbers = new Set(ayah.footnotes.map(footnote => footnote.number));
    return text.replace(/\[(\d+)\]/g, (match, n: string) => numbers.has(Number(n)) ? '' : match).replace(/\s{2,}/g, ' ').trim();
  }
  if (!renumbered || renumbered.size === 0) return text;
  return text.replace(/\[(\d+)\]/g, (match, n: string) => {
    const replacement = renumbered.get(Number(n));
    return replacement === undefined ? match : `[${replacement}]`;
  });
}

interface QuranFootnoteOutput {
  byAyah: Map<number, Map<number, number>>;
  footnotes: NonNullable<QuranResult['ayahs'][number]['footnotes']>;
}

function prepareQuranFootnotes(result: QuranResult): QuranFootnoteOutput {
  const byAyah = new Map<number, Map<number, number>>();
  const footnotes: NonNullable<QuranResult['ayahs'][number]['footnotes']> = [];
  const renumber = result.reference.startAyah !== result.reference.endAyah;
  let next = 1;

  for (const ayah of result.ayahs) {
    if (!ayah.footnotes?.length) continue;
    const map = new Map<number, number>();
    for (const footnote of ayah.footnotes) {
      const number = renumber ? next++ : footnote.number;
      map.set(footnote.number, number);
      footnotes.push({ ...footnote, number });
    }
    byAyah.set(ayah.reference.startAyah, map);
  }

  return { byAyah, footnotes };
}

function quranBlockText(result: QuranResult, cfg: FormattingConfig, options: FormatOptions & { quranRangeMode?: 'line-by-line' | 'merged' | 'alternate' | 'numbered'; quranFootnotes?: boolean; }): string[] {
  const mode = options.quranRangeMode ?? 'line-by-line';
  const ayahs = result.ayahs;
  const arabic = ayahs.filter(a => options.arabic && a.arabic);
  const english = ayahs.filter(a => options.english && a.translation);
  const footnoteOutput = options.quranFootnotes
    ? prepareQuranFootnotes(result)
    : { byAyah: new Map<number, Map<number, number>>(), footnotes: [] as NonNullable<QuranResult['ayahs'][number]['footnotes']> };
  const lines: string[] = [];
  const linePrefix = contentLinePrefix(cfg);
  const separator = separatorLine(cfg);

  if (result.reference.startAyah !== result.reference.endAyah && mode === 'merged') {
    if (arabic.length) {
      const text = arabic.map(a => `${formatAyahNumber(a.reference.startAyah, cfg, cfg.arabicAyahNumbers)} ${a.arabic!}`).join(' ');
      lines.push(wrapLine(`${cfg.quranAyahOpen}${text}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
    }
    if (english.length) {
      if (arabic.length) lines.push(separator);
      const text = english.map(a => `${formatAyahNumber(a.reference.startAyah, cfg, false)} ${quranTranslationText(a, Boolean(options.quranFootnotes), footnoteOutput.byAyah.get(a.reference.startAyah))}`).join(' ');
      lines.push(wrapLine(`${cfg.quranAyahOpen}${text}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
    }
  } else if (result.reference.startAyah !== result.reference.endAyah && mode === 'alternate') {
    const byNumber = new Map(ayahs.map(ayah => [ayah.reference.startAyah, ayah]));
    const last = result.reference.endAyah;
    for (let number = result.reference.startAyah; number <= last; number++) {
      const ayah = byNumber.get(number);
      if (!ayah) continue;
      if (options.arabic && ayah.arabic) {
        lines.push(wrapLine(`${formatAyahDigits(number, cfg.arabicAyahNumbers)}: ${cfg.quranAyahOpen}${ayah.arabic}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
        if (options.english && ayah.translation) lines.push(separator);
      }
      if (options.english && ayah.translation) {
        lines.push(wrapLine(`${number}: ${cfg.quranAyahOpen}${quranTranslationText(ayah, Boolean(options.quranFootnotes), footnoteOutput.byAyah.get(ayah.reference.startAyah))}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
      }
      if (number < last && (options.arabic || options.english)) { lines.push(separator); lines.push(separator); }
    }
  } else if (result.reference.startAyah !== result.reference.endAyah && mode === 'numbered') {
    const byNumber = new Map(ayahs.map(ayah => [ayah.reference.startAyah, ayah]));
    const last = result.reference.endAyah;
    for (let number = result.reference.startAyah; number <= last; number++) {
      const ayah = byNumber.get(number);
      if (!ayah) continue;
      if (options.arabic && ayah.arabic) lines.push(wrapLine(`${formatAyahDigits(number, cfg.arabicAyahNumbers)}: ${cfg.quranAyahOpen}${ayah.arabic}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
      if (options.arabic && options.english && ayah.arabic && ayah.translation) lines.push(separator);
      if (options.english && ayah.translation) lines.push(wrapLine(`${number}: ${cfg.quranAyahOpen}${quranTranslationText(ayah, Boolean(options.quranFootnotes), footnoteOutput.byAyah.get(ayah.reference.startAyah))}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
      if (number < last && (options.arabic || options.english)) lines.push(separator);
    }
  } else {
    for (const ayah of ayahs) if (options.arabic && ayah.arabic) lines.push(wrapLine(`${cfg.quranAyahOpen}${ayah.arabic}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
    if (options.arabic && options.english && arabic.length && english.length) lines.push(separator);
    for (const ayah of ayahs) if (options.english && ayah.translation) lines.push(wrapLine(`${cfg.quranAyahOpen}${quranTranslationText(ayah, Boolean(options.quranFootnotes), footnoteOutput.byAyah.get(ayah.reference.startAyah))}${cfg.quranAyahClose}`, linePrefix, cfg.lineSuffix));
  }

  if (options.quranFootnotes && footnoteOutput.footnotes.length && options.english) {
    if (cfg.callout === 'none') {
      lines.push('');
      lines.push('Footnotes:');
      for (const footnote of footnoteOutput.footnotes) lines.push(`- [${footnote.number}]: ${footnote.text}`);
    } else {
      lines.push(separator);
      lines.push('>> [!Note] Footnotes');
      for (const footnote of footnoteOutput.footnotes) lines.push(`>> - [${footnote.number}]: ${footnote.text}`);
    }
  }
  return lines;
}

/**
 * Convert the provider-neutral Quran result into the plugin's final Markdown.
 *
 * Formatting deliberately happens after provider parsing and normalization. This
 * keeps provider response quirks out of the output contract and means every Quran
 * source produces the same Obsidian structure for equivalent domain data.
 */
export function formatQuran(result: QuranResult, cfg: FormattingConfig, options: FormatOptions & { quranRangeMode?: 'line-by-line' | 'merged' | 'alternate' | 'numbered'; quranFootnotes?: boolean; }): string {
  const target = `${result.reference.surah}:${result.reference.startAyah}`;
  const label = result.reference.startAyah === result.reference.endAyah ? target : `${result.reference.surah}:${result.reference.startAyah}-${result.reference.endAyah}`;
  const rawSurahName = result.surahName.trim();
  const surahName = (`${/^(?:surah|sūrah)\b/iu.test(rawSurahName) ? '' : 'Surah '}${rawSurahName}`)
    .replace(/^(Surah\s+)(al(?:-.*)?)$/iu, (_, prefix: string, rest: string) =>
      `${prefix}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`
    );
  const link = cfg.showLink ? `[${surahName}, ${label}](${result.source.sourceUrl})` : `${surahName}, ${label}`;
  const lines = quranBlockText(result, cfg, options);
  return `${cfg.entirePrefix}${prefixCallout(cfg)}${link}${lines.length ? `\n${lines.join('\n')}\n` : '\n'}${cfg.entireSuffix}`.trimEnd();
}

export function formatHadith(result: HadithResult, cfg: FormattingConfig, options: FormatOptions & { hadithSeparateIsnad?: boolean }): string {
  const collectionName = decodeHtmlEntities(result.collectionName);
  const link = cfg.showLink ? `[${collectionName} ${result.reference.hadithNumber}](${result.source.sourceUrl})` : `${collectionName} ${result.reference.hadithNumber}`;
  const lines: string[] = [];
  const linePrefix = contentLinePrefix(cfg);
  const separator = separatorLine(cfg);
  const separateIsnad = options.hadithSeparateIsnad !== false;
  const arabicText = result.arabic ?? '(Arabic: Not found)';
  const englishText = result.english ?? '(English: Not found)';
  const pushWrapped = (text:string) => lines.push(wrapLine(text, linePrefix, cfg.lineSuffix));

  if (options.arabic) {
    if (separateIsnad) {
      if (result.arabicIsnad) pushWrapped(result.arabicIsnad);
      pushWrapped(arabicText);
    } else pushWrapped(result.arabicIsnad ? `${result.arabicIsnad} ${arabicText}` : arabicText);
  }
  if (options.english) {
    if (options.arabic) lines.push(separator);
    if (separateIsnad) {
      if (result.englishIsnad) pushWrapped(result.englishIsnad);
      pushWrapped(englishText);
    } else pushWrapped(result.englishIsnad ? `${result.englishIsnad} ${englishText}` : englishText);
  }
  if (options.grading) {
    if (lines.length) lines.push(separator);
    if (!result.grades.length) pushWrapped('Grading: Not found');
    else if (result.grades.length === 1) pushWrapped(`Grading: ${gradeDisplay(result.grades[0]!)}`);
    else {
      pushWrapped('- Grading:');
      for (const grade of result.grades) lines.push(`${linePrefix}  - ${gradeDisplay(grade)}${cfg.lineSuffix}`);
    }
  }
  return `${cfg.entirePrefix}${prefixCallout(cfg)}${link}${lines.length ? `\n${lines.join('\n')}\n` : '\n'}${cfg.entireSuffix}`.trimEnd();
}
/**
 * Format multiple Hadith results while preserving reference order.
 *
 * Providers may return a range in a different internal representation, but the
 * formatter must treat the supplied array as already ordered by hadith number.
 * Keeping ordering out of this layer avoids silently changing provider semantics.
 */
export function formatHadithRange(results: readonly HadithResult[], cfg: FormattingConfig, options: FormatOptions & { hadithSeparateIsnad?: boolean }): string {
  return results.map(result => formatHadith(result, cfg, options)).join('\n\n');
}
