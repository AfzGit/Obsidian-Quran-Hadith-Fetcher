const LANGUAGE_ALIASES: Record<string, string> = {
  arabic: 'ar', bengali: 'bn', english: 'en', french: 'fr', german: 'de', hindi: 'hi',
  indonesian: 'id', malay: 'ms', persian: 'fa', russian: 'ru', spanish: 'es', tamil: 'ta',
  telugu: 'te', turkish: 'tr', urdu: 'ur',
};

const FALLBACK_LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic', bn: 'Bengali', de: 'German', en: 'English', es: 'Spanish', fa: 'Persian',
  fr: 'French', ha: 'Hausa', hi: 'Hindi', id: 'Indonesian', it: 'Italian', ko: 'Korean',
  ku: 'Kurdish', ml: 'Malayalam', ms: 'Malay', nl: 'Dutch', no: 'Norwegian', pt: 'Portuguese',
  ru: 'Russian', sd: 'Sindhi', so: 'Somali', sv: 'Swedish', ta: 'Tamil', te: 'Telugu', tr: 'Turkish',
  ur: 'Urdu', uz: 'Uzbek', zh: 'Chinese',
};

const displayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'language' })
  : null;

/**
 * Canonicalize provider language labels into a stable comparison key. Providers may
 * vary in capitalization or common code spelling, but settings and UI grouping need
 * equivalent languages to compare consistently.
 */
export function normalizeLanguageCode(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (LANGUAGE_ALIASES[normalized]) return LANGUAGE_ALIASES[normalized];
  if (/^[a-z]{2,3}$/u.test(normalized)) return normalized;
  return trimmed;
}

export function languageName(value: string): string {
  const code = normalizeLanguageCode(value);
  try {
    const display = displayNames?.of(code);
    if (display) return display;
  } catch {
    // Unknown/non-BCP-47 language labels are already human-readable.
  }
  return FALLBACK_LANGUAGE_NAMES[code.toLowerCase()] || (value.trim() || code);
}
