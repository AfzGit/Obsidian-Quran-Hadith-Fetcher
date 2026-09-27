const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u08D4-\u08FF]/g;
const ARABIC_CANONICAL_MAP: Record<string, string> = { 'ٱ': 'ا', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا' };

function normalizeArabicToken(token: string): string {
  return token.normalize('NFKC').replace(ARABIC_MARKS, '').replace(/[ـ]/g, '').split('').map((c) => ARABIC_CANONICAL_MAP[c] ?? c).join('').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
}

// Arabic salutations currently recognized:
//   • صلى الله عليه وسلم       → ﷺ
//   • صلى الله عليه و سلم      → ﷺ
const ARABIC_PHRASES = [
  ['صلى', 'الله', 'عليه', 'وسلم'],
  ['صلى', 'الله', 'عليه', 'و', 'سلم'],
];

function protectExistingBlessings(text: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const protectedText = text.replace(/\(\s*ﷺ\s*\)|ﷺ/gu, (match) => {
    const token = `QHFBLESSINGTOKEN${tokens.length}X`;
    tokens.push(match);
    return token;
  });
  return { text: protectedText, tokens };
}

function restoreBlessings(text: string, tokens: readonly string[]): string {
  return text.replace(/QHFBLESSINGTOKEN(\d+)X/gu, (_, index: string) => tokens[Number(index)] ?? 'ﷺ');
}

function normalizeArabicBlessingCore(text: string, restoreExisting = true, protectExisting = true): string {
  // Existing ﷺ and (ﷺ) are protected before NFKC so source text is preserved.
  const protectedValue = protectExisting ? protectExistingBlessings(text) : { text, tokens: [] as string[] };
  const normalizedText = protectedValue.text.normalize('NFKC');
  const tokens = [...normalizedText.matchAll(/\S+/gu)].map((m) => {
    const raw = m[0]!;
    let leftTrim = 0;
    let rightTrim = raw.length;
    while (leftTrim < rightTrim && /[\p{P}\p{S}]/u.test(raw[leftTrim]!)) leftTrim++;
    while (rightTrim > leftTrim && /[\p{P}\p{S}]/u.test(raw[rightTrim - 1]!)) rightTrim--;
    return {
      raw,
      start: (m.index ?? 0) + leftTrim,
      end: (m.index ?? 0) + rightTrim,
      core: raw.slice(leftTrim, rightTrim),
    };
  });
  const normalized = tokens.map((t) => normalizeArabicToken(t.core));
  const replacements: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < normalized.length;) {
    let matched = false;
    for (const phrase of ARABIC_PHRASES) {
      if (i + phrase.length <= normalized.length && phrase.every((part, j) => normalized[i + j] === part)) {
        replacements.push({
          start: tokens[i]!.start,
          end: tokens[i + phrase.length - 1]!.end,
        });
        i += phrase.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }

  let out = normalizedText;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i]!;
    out = out.slice(0, r.start) + 'ﷺ' + out.slice(r.end);
  }
  return restoreExisting ? restoreBlessings(out, protectedValue.tokens) : out;
}

export function normalizeArabicBlessing(text: string): string {
  return normalizeArabicBlessingCore(text);
}

function parenthesizeNewBlessings(text: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '(') depth++;
    if (char === 'ﷺ') {
      out += depth > 0 ? 'ﷺ' : '(ﷺ)';
      continue;
    }
    out += char;
    if (char === ')' && depth > 0) depth--;
  }
  return out.replace(/\(\s*ﷺ\s*\)/gu, '(ﷺ)');
}

// Public blessing entry point. The implementation protects already-normalized
// ﷺ tokens, normalizes supported Arabic/English variants, and restores protected
// tokens so running the function a second time is idempotent.
export function normalizeBlessing(text: string): string {
  // Keep existing blessings protected so they retain their original
  // parenthesis/spacing. Newly-created blessings are parenthesized unless
  // they come from the explicit Allah-wording variants below.
  const protectedValue = protectExistingBlessings(text);
  const bareBlessingToken = '__QHF_BARE_BLESSING__';

  let out = protectedValue.text;

  // These English phrasings are compacted to ﷺ. The newer "may Allah bless..."
  // comma form deliberately keeps exactly one space before the glyph.
  for (const [pattern, replacement] of BARE_ENGLISH_PATTERNS) {
    out = out.replace(pattern, replacement === 'SPACE' ? ` ${bareBlessingToken}` : bareBlessingToken);
  }

  // Normalize source Arabic first. Arabic صلى الله عليه وسلم is already an explicit
  // salutation marker and must become a bare ﷺ unless the source itself supplied
  // parentheses. Protect those newly-created Arabic markers from the English
  // parenthesizer so it does not turn them into (ﷺ).
  out = normalizeArabicBlessingCore(out, false, false);
  const arabicBlessingToken = '__QHF_ARABIC_BLESSING__';
  out = out.replace(/ﷺ/gu, arabicBlessingToken);

  for (const pattern of ENGLISH_PATTERNS) {
    out = out.replace(pattern, 'ﷺ');
  }

  out = parenthesizeNewBlessings(out);
  out = out.replace(new RegExp(bareBlessingToken, 'gu'), 'ﷺ');
  out = out.replace(new RegExp(arabicBlessingToken, 'gu'), 'ﷺ');
  return restoreBlessings(out, protectedValue.tokens);
}

// NORMALIZATION CONVERSION CATALOG — document each accepted source form and its
// output here so overlapping patterns and existing variants remain visible.
//
// BARE_ENGLISH_PATTERNS (standalone/new blessings intentionally rendered bare):
//   1. May peace and blessings be upon him                            → ﷺ
//   2. , peace and blessings of Allah upon him,                       →  ﷺ
//   3. , may peace and blessings of Allah upon him,                   →  ﷺ
//   4. , may Allah bless him and grant him peace [optional final comma] →  ﷺ
//      Example: Prophet, may Allah bless him and grant him peace used → Prophet ﷺ used
//
const BARE_ENGLISH_PATTERNS: Array<[RegExp, 'BARE' | 'SPACE']> = [
  // May peace and blessings be upon him → bare ﷺ.
  [/\bmay\s+peace\s+and\s+blessings\s+be\s+upon\s+him\b/giu, 'BARE'],
  // May peace and blessing be upon him → bare ﷺ; the comma form also drops its introductory comma.
  [/[,]\s*may\s+peace\s+and\s+blessing\s+be\s+upon\s+him\s*,?/giu, 'SPACE'],
  [/\bmay\s+peace\s+and\s+blessing\s+be\s+upon\s+him\b/giu, 'BARE'],
  // , peace and blessings of Allah upon him, → one space + bare ﷺ.
  [/,\s*peace\s+and\s+blessings\s+of\s+Allah\s+upon\s+him\s*,/giu, 'SPACE'],
  // , may peace and blessings of Allah upon him, → one space + bare ﷺ.
  [/,\s*may\s+peace\s+and\s+blessings\s+of\s+Allah\s+upon\s+him\s*,/giu, 'SPACE'],
  // , may Allah bless him and grant him peace[, optional] → bare ﷺ. At the start of a string there is no preceding word, so no leading space is added. This conversion is intentionally independent of any preceding word (for example, Prophet, Messenger, or no word at all).
  [/^,\s*may\s+Allah\s+bless\s+him\s+and\s+grant\s+him\s+peace(?:\s*,)?/iu, 'BARE'],
  // [word] may Allah bless him and grant him peace[, optional] OR [word], may... → one space + bare ﷺ. This conversion is intentionally independent of the preceding word.
  [/(?:,\s+|\s+)may\s+Allah\s+bless\s+him\s+and\s+grant\s+him\s+peace(?:\s*,)?/giu, 'SPACE'],
];

const ENGLISH_PATTERNS: RegExp[] = [
  // (peace and blessings of Allah upon him)                          → (ﷺ)
  // (may Allah bless him and grant him peace)                         → (ﷺ)
  // S.A.W.S / S.A.W / P.B.U.H variants and spaced forms             → (ﷺ)
  // peace/ blessings phrasings without the comma-wrapped forms      → (ﷺ)
  /\(\s*peace\s+and\s+blessings\s+of\s+Allah\s+upon\s+him\s*\)/giu, // Parenthesized Allah blessing → (ﷺ)

  /\(\s*may\s+Allah\s+bless\s+him\s+and\s+grant\s+him\s+peace\s*\)/giu, // Parenthesized may-Allah blessing → (ﷺ)

  /\bS\.\s*A\.\s*W\.\s*S\.?(?=$|[^\p{L}])/giu, // S.A.W.S → (ﷺ)

  /\bS\.\s*A\.\s*W\.?(?=$|[^\p{L}])/giu, // S.A.W → (ﷺ)

  /\bP\.\s*B\.\s*U\.\s*H\.?(?=$|[^\p{L}])/giu, // P.B.U.H → (ﷺ)

  /\bS\s+A\s+W(?:\s+S)?(?=$|[^\p{L}])/gu, // S A W / S A W S → (ﷺ)

  /\bSAWS(?=$|[^\p{L}])/gu, // SAWS → (ﷺ)

  /\bSAW(?=$|[^\p{L}])/gu, // SAW → (ﷺ)

  /\bP\s+B\s+U\s+H(?=$|[^\p{L}])/gu, // P B U H → (ﷺ)

  /\bPBUH(?=$|[^\p{L}])/gu, // PBUH → (ﷺ)

  /\bmay\s+peace\s+and\s+blessings\s+be\s+upon\s+him\b/giu, // May peace and blessings be upon him → (ﷺ)

  /\bmay\s+peace\s+be\s+upon\s+him\b/giu, // May peace be upon him → (ﷺ)

  /\bpeace\s+and\s+blessings\s+be\s+upon\s+him\b/giu, // Peace and blessings be upon him → (ﷺ)

  /\bpeace\s+be\s+upon\s+him\b/giu, // Peace be upon him → (ﷺ)

];

export interface ReplacementRule {
  id: string;
  language: 'en';
  title: string;
  description: string;
  from: string;
  to: string;
  enabled: boolean;
  caseSensitive: boolean;
}

export const DEFAULT_REPLACEMENT_RULES: ReplacementRule[] = [
  { id: 'lord-to-rabb', language: 'en', title: 'Fix Inaccurate translation of Rabb', description: 'Lord is an inaccurate and restrictive translation of the word Rabb. The word Rabb is more detailed in meaning and has no alternative in the english language', from: 'Lord', to: 'Rabb', enabled: true, caseSensitive: false },
  { id: 'verse-to-ayat', language: 'en', title: 'Fix Mistranslation of Ayah', description: 'Verse means a part of a poem or Bible, and this is a grave mistranslation of the word Ayah.', from: 'Verse', to: 'Ayah', enabled: true, caseSensitive: false },
  { id: 'verses-to-ayat', language: 'en', title: 'Fix Mistranslation of Ayah', description: '', from: 'Verses', to: 'Ayah', enabled: true, caseSensitive: false },
  { id: 'ayat-to-ayah', language: 'en', title: 'Use Standard English letters for Ayah', description: '', from: 'Ayât', to: 'Ayah', enabled: true, caseSensitive: false },
  { id: 'quran-apostrophe', language: 'en', title: 'Use Standard English spelling for Quran', description: '', from: "Qur'an", to: 'Quran', enabled: true, caseSensitive: false },
  { id: 'ayesha-backtick', language: 'en', title: 'Use Standard English spelling for Ayesha', description: '', from: '`Ayesha', to: 'Ayesha', enabled: true, caseSensitive: false },
  { id: 'apostle-to-messenger', language: 'en', title: 'Apostle To more well known Messenger', description: '', from: 'Apostle', to: 'Messenger', enabled: true, caseSensitive: false },
  { id: 'apostles-to-messengers', language: 'en', title: 'Apostles To more well known Messengers', description: '', from: 'Apostles', to: 'Messengers', enabled: true, caseSensitive: false },
];

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function replaceCustomLiteral(text: string, source: string, replacement: string, caseSensitive: boolean): string {
  if (!source) return text;

  const haystack = caseSensitive ? text : text.toLocaleLowerCase('en-US');
  const needle = caseSensitive ? source : source.toLocaleLowerCase('en-US');
  let output = '';
  let cursor = 0;

  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;

    const before = text[index - 1];
    const after = text[index + source.length];

    // The configured source must be present literally. Only the surrounding
    // word boundary is flexible, so `'Ubaid` matches exactly `'Ubaid`.
    if (!isWordCharacter(before) && !isWordCharacter(after)) {
      output += text.slice(cursor, index) + replacement;
      cursor = index + source.length;
    } else {
      output += text.slice(cursor, index + source.length);
      cursor = index + source.length;
    }
  }

  return output + text.slice(cursor);
}



/** Convert English/transliterated text to plain ASCII-style Roman English.
 * Arabic script is never passed here; this helper only normalizes Latin text.
 */
export function convertToRomanEnglish(text: string): string {
  // ﷺ is a compatibility ligature whose NFKD decomposition expands into
  // Arabic words. Protect existing source blessings so Roman conversion only
  // affects the surrounding Latin/typographic English text.
  const protectedValue = protectExistingBlessings(text);
  const converted = protectedValue.text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[‘’‚‛ʻʼ]/gu, "'")
    .replace(/[“”„‟]/gu, '"')
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/…/gu, '...')
    .replace(/\u00A0/gu, ' ')
    .replace(/[ʿʾ]/gu, '')
    .replace(/[Ææ]/gu, (c) => c === 'Æ' ? 'AE' : 'ae')
    .replace(/[Œœ]/gu, (c) => c === 'Œ' ? 'OE' : 'oe')
    .replace(/[Ðð]/gu, (c) => c === 'Ð' ? 'D' : 'd')
    .replace(/[Þþ]/gu, (c) => c === 'Þ' ? 'TH' : 'th')
    .replace(/[Łł]/gu, (c) => c === 'Ł' ? 'L' : 'l')
    .replace(/[Øø]/gu, (c) => c === 'Ø' ? 'O' : 'o')
    .replace(/[Đđ]/gu, (c) => c === 'Đ' ? 'D' : 'd')
    .replace(/[Ħħ]/gu, (c) => c === 'Ħ' ? 'H' : 'h')
    .replace(/ı/gu, 'i')
    .replace(/[Ŧŧ]/gu, (c) => c === 'Ŧ' ? 'T' : 't')
    .replace(/[Əə]/gu, (c) => c === 'Ə' ? 'E' : 'e')
    .replace(/ß/gu, 'ss');
  return restoreBlessings(converted, protectedValue.tokens);
}

// RA CONVERSION CATALOG — document each accepted source form and its output so
// the supported variants remain visible when this list changes.
//
// RA source forms currently recognized:
//   • RA / R.A / R.A.                                  → رضي الله عنه
//   • (May Allah be pleased with Him)                 → (رضي اللّه عنه)
//   • (May Allah be pleased with Her)                 → (رضي اللّه عنها)
//   • (May Allah be pleased with them)                → (رضي اللّه عنهم)
//   • , may Allah be pleased with Him/Her/them,       → رضي اللّه عنه/عنها/عنهم
//   • may Allah be pleased with Him/Her/them           → رضي اللّه عنه/عنها/عنهم
// These comma-delimited and bare forms intentionally collapse the punctuation
// around the English salutation and leave exactly one space before the Arabic.
// Keep this expression free of lookbehind. Obsidian runs plugins in mobile webviews,
// and iOS versions below 16.4 do not support JavaScript regex lookbehind. The
// leading capture preserves the same left-boundary behavior without requiring it.
const STANDALONE_RA_PATTERN = /(^|[^A-Za-z0-9])R\.?A\.?(?![A-Za-z0-9])/giu;

const RA_ENGLISH_PATTERNS: readonly [RegExp,string][] = [
  [/\(\s*May\s+Allah\s+be\s+pleased\s+with\s+Him\s*\)/giu, '(رضي اللّه عنه)'], // (May Allah be pleased with Him) → (رضي اللّه عنه)

  [/\(\s*May\s+Allah\s+be\s+pleased\s+with\s+Her\s*\)/giu, '(رضي اللّه عنها)'], // (May Allah be pleased with Her) → (رضي اللّه عنها)

  [/\(\s*May\s+Allah\s+be\s+pleased\s+with\s+them\s*\)/giu, '(رضي اللّه عنهم)'], // (May Allah be pleased with them) → (رضي اللّه عنهم)

  [/,\s*May\s+Allah\s+be\s+pleased\s+with\s+Him\s*,?/giu, ' رضي اللّه عنه'], // , may Allah be pleased with Him → رضي اللّه عنه

  [/,\s*May\s+Allah\s+be\s+pleased\s+with\s+Her\s*,?/giu, ' رضي اللّه عنها'], // , may Allah be pleased with Her → رضي اللّه عنها

  [/,\s*May\s+Allah\s+be\s+pleased\s+with\s+them\s*,?/giu, ' رضي اللّه عنهم'], // , may Allah be pleased with them → رضي اللّه عنهم

  [/\bMay\s+Allah\s+be\s+pleased\s+with\s+Him\s*,?/giu, 'رضي اللّه عنه'], // May Allah be pleased with Him → رضي اللّه عنه

  [/\bMay\s+Allah\s+be\s+pleased\s+with\s+Her\s*,?/giu, 'رضي اللّه عنها'], // May Allah be pleased with Her → رضي اللّه عنها

  [/\bMay\s+Allah\s+be\s+pleased\s+with\s+them\s*,?/giu, 'رضي اللّه عنهم'], // May Allah be pleased with them → رضي اللّه عنهم

];

// Public RA entry point. English honorific phrases are normalized to the Arabic
// form while existing Arabic RA text remains stable. Both parenthesized and bare
// forms are supported because user/source text commonly uses either style.
export function normalizeStandaloneRa(text: string): string {
  let out=text;
  for(const [pattern,replacement] of RA_ENGLISH_PATTERNS) out=out.replace(pattern,replacement);
  return out.replace(STANDALONE_RA_PATTERN, (_match, prefix: string) => `${prefix}رَضِيَ ٱللَّٰهُ عَنْهُ`);
}

export type CodeSyntaxMode = 'replace'|'remove'|'none';

/**
 * Change Markdown code-span syntax only when explicitly requested.
 *
 * Normalization is often run on text copied from providers, so this helper keeps
 * code fragments from being accidentally treated as ordinary prose. `none` is a
 * true no-op and is kept for settings where the caller wants normalization without
 * altering Markdown syntax.
 */
export function modifyCodeSyntax(text: string, mode: CodeSyntaxMode): string {
  if (mode === 'replace') return text.replace(/`/gu, 'ʿ');
  if (mode === 'remove') return text.replace(/`/gu, '');
  return text;
}

/**
 * Apply user-configured English substitutions without touching Arabic text.
 *
 * Rules are applied in their configured order. This is significant when one
 * replacement creates text that another rule could match, so this function should
 * not be rewritten as an unordered object lookup or a single alternation regex
 * without preserving that ordering contract.
 */
export function applyEnglishReplacements(text: string, rules: readonly ReplacementRule[]): string {
  return rules
    .filter((rule) => rule.enabled && rule.language === 'en' && rule.from.trim().length > 0)
    .reduce((current, rule) => {
      if (rule.id !== 'ayat-to-ayah') {
        return replaceCustomLiteral(current, rule.from, rule.to, rule.caseSensitive);
      }

      // Ayât can arrive as Ayat after Roman-English/Unicode normalization.
      // Keep the canonical rule label as Ayât, but match both spellings.
      const pattern = /(^|[^\p{L}\p{N}_])Ay(?:a|â)t(?=$|[^\p{L}\p{N}_])/giu;
      return current.replace(pattern, (_match, prefix: string) => `${prefix}${rule.to}`);
    }, text);
}

export interface FetchedTextTransformOptions {
  textConversionsEnabled: boolean;
  blessingNormalization: boolean;
  raNormalization: boolean;
  romanEnglish: boolean;
  codeSyntaxMode: CodeSyntaxMode;
  replacementRules: readonly ReplacementRule[];
}

/**
 * Canonical transformation pipeline for fetched English/text output. Keeping the
 * ordering in one function prevents the main insertion path from drifting away
 * from the normalization module as new conversion stages are added.
 *
 * The stage order is part of the output contract; add regression coverage when
 * changing it because replacements can affect later normalization stages.
 */
export function transformFetchedEnglishText(text: string, options: FetchedTextTransformOptions): string {
  if (!options.textConversionsEnabled) return text;
  let out = options.blessingNormalization ? normalizeBlessing(text) : text;
  out = applyEnglishReplacements(out, options.replacementRules);
  out = options.romanEnglish ? convertToRomanEnglish(out) : out;
  out = options.raNormalization ? normalizeStandaloneRa(out) : out;
  return modifyCodeSyntax(out, options.codeSyntaxMode);
}

/** Canonical transformation entry point for fetched Arabic Quran text. */
export function transformFetchedArabicText(text: string, options: Pick<FetchedTextTransformOptions, 'textConversionsEnabled' | 'blessingNormalization'>): string {
  if (!options.textConversionsEnabled || !options.blessingNormalization) return text;
  return normalizeArabicBlessing(text);
}

export function transformText(text: string, language: 'ar' | 'en' | 'text', rules = DEFAULT_REPLACEMENT_RULES): string {
  let out = text;
  if (language !== 'ar') out = normalizeBlessing(out);
  if (language === 'en') out = applyEnglishReplacements(out, rules);
  if (language === 'text') out = normalizeBlessing(out);
  return out;
}
