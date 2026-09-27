import { DEFAULT_FORMATTING, type FormattingConfig } from '../core/formatting';
import { DEFAULT_REPLACEMENT_RULES, type ReplacementRule } from '../core/normalization';
import type { QuranWebsite } from '../core/url';
import type { OutputOptions, QuranRangeMode } from '../domain/models';
import { COMMAND_DEFINITIONS, defaultCommandVisibility, type CommandVisibility } from '../core/commands';

export interface Settings {
  schemaVersion:number;
  quranProvider:string;
  hadithProvider:string;
  quranLanguage:string;
  quranTranslation:string;
  hadithLanguage:string;
  hadithTranslation:string;
  quranWebsite:QuranWebsite;
  customQuranUrl:string;
  formatting:FormattingConfig;
  replacementRules:ReplacementRule[];
  blessingNormalization:boolean;
  cacheEnabled:boolean;
  romanEnglish:boolean;
  raNormalization:boolean;
  textConversionsEnabled:boolean;
  quranFetchLimit:number;
  hadithFetchLimit:number;
  commandVisibility:CommandVisibility;
  lastQuranOptions:OutputOptions;
  lastHadithOptions:OutputOptions;
}

export const DEFAULT_QURAN_OPTIONS: OutputOptions = {
  arabic:true, english:true, grading:false, link:true,
  quranRangeMode:'line-by-line', quranFootnotes:false,
  hadithSeparateIsnad:true,
};

export const DEFAULT_HADITH_OPTIONS: OutputOptions = {
  arabic:true, english:true, grading:true, link:true,
  quranRangeMode:'line-by-line', quranFootnotes:false,
  hadithSeparateIsnad:true,
};

function mergeReplacementRules(raw: unknown, legacyRabbConversion?: boolean): ReplacementRule[] {
  const source = Array.isArray(raw) ? raw : [];
  const defaults = structuredClone(DEFAULT_REPLACEMENT_RULES);
  const byId = new Map<string, ReplacementRule>();
  for (const rule of source) {
    if (!rule || typeof rule !== 'object') continue;
    const value = rule as Partial<ReplacementRule> & { description?: string; title?: string; caseSensitive?: boolean };
    if (typeof value.id !== 'string' || typeof value.from !== 'string' || typeof value.to !== 'string') continue;
    // Unsaved Add-conversion drafts from older builds could leave a blank custom row behind.
    // A valid custom conversion always has both sides populated, so discard only blank custom
    // placeholders during settings migration; existing/default rules are left untouched.
    if (value.id.startsWith('custom-') && (!value.from.trim() || !value.to.trim())) continue;
    const base = defaults.find(item => item.id === value.id);
    byId.set(value.id, {
      ...(base ?? {id:value.id, language:'en', title:value.title ?? value.description ?? 'Custom replacement', description:'', from:value.from, to:value.to, enabled:true, caseSensitive:false}),
      ...value,
      language:'en',
      title:typeof value.title === 'string' ? value.title : (base?.title ?? (value.description ?? 'Custom replacement')),
      description:typeof value.description === 'string' ? value.description : (base?.description ?? ''),
      caseSensitive:false,
    });
  }
  for (const rule of defaults) {
    if (!byId.has(rule.id)) byId.set(rule.id, rule);
  }
  const lord = byId.get('lord-to-rabb');
  if (lord && typeof legacyRabbConversion === 'boolean') lord.enabled = legacyRabbConversion;
  return [...byId.values()];
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion:14, quranProvider:'alquran-cloud', hadithProvider:'hadith-api',
  quranLanguage:'en', quranTranslation:'hilali-khan', hadithLanguage:'en', hadithTranslation:'eng', quranWebsite:'quran-unlocked', customQuranUrl:'https://www.myquranwebsite.com/$surah/$ayah-$ayahlast',
  formatting:{...DEFAULT_FORMATTING,showLink:true,quranAyahOpen:'{',quranAyahClose:'}',quranAyahStyle:'curly',callout:'quote',customCalloutType:''}, replacementRules:DEFAULT_REPLACEMENT_RULES.map(x=>({...x})),
  blessingNormalization:true, cacheEnabled:true, romanEnglish:true, raNormalization:false, textConversionsEnabled:true,
  quranFetchLimit:30, hadithFetchLimit:15, commandVisibility:defaultCommandVisibility(),
  lastQuranOptions:structuredClone(DEFAULT_QURAN_OPTIONS), lastHadithOptions:structuredClone(DEFAULT_HADITH_OPTIONS),
};

function normalizeOptions(raw:unknown, defaults:OutputOptions):OutputOptions {
  const source=raw && typeof raw==='object' ? raw as (Partial<OutputOptions> & {quranMergeAyahs?:boolean}) : {};
  return { ...defaults, ...source,
    quranRangeMode:(['line-by-line','merged','alternate','numbered'] as const).includes(source.quranRangeMode as QuranRangeMode)
      ? source.quranRangeMode as QuranRangeMode
      : source.quranMergeAyahs === true ? 'merged' : defaults.quranRangeMode,
    quranFootnotes:source.quranFootnotes === true,
    hadithSeparateIsnad:source.hadithSeparateIsnad !== false,
  };
}

function normalizeFormatting(raw: FormattingConfig): FormattingConfig {
  const allowed = new Set(['none','quote','note','abstract','info','todo','tip','success','question','warning','failure','danger','bug','example','cite','custom']);
  const callout = allowed.has(raw.callout) ? raw.callout : 'quote';
  return {...raw, callout, customCalloutType:typeof raw.customCalloutType === 'string' ? raw.customCalloutType : ''};
}

// Migration is a pure compatibility transform. Do not perform network/filesystem
// work here. Every new persisted field needs a default, validation, and (when
// applicable) a migration from its previous name/meaning.
/**
 * Convert persisted plugin data into the current settings schema. Older releases can
 * contain partial or differently shaped values, so migration preserves valid choices,
 * fills missing fields from defaults, and avoids trusting persisted shapes blindly.
 */
export function migrateSettings(raw:unknown):Settings {
  if(!raw || typeof raw!=='object') return structuredClone(DEFAULT_SETTINGS);
  const rawSource=raw as Partial<Settings> & {schemaVersion?:number;arabicEnabled?:boolean;englishEnabled?:boolean;hadithGradingEnabled?:boolean;linkInsertion?:boolean;quranMergeAyahs?:boolean;quranRangeMode?:QuranRangeMode;rabbConversion?:boolean;romanEnglish?:boolean;romanEnglishAyat?:boolean;disableAllTextConversions?:boolean;};
  const {arabicEnabled:_arabicEnabled,englishEnabled:_englishEnabled,hadithGradingEnabled:_hadithGradingEnabled,linkInsertion:_linkInsertion,rabbConversion:_legacyRabbConversion,romanEnglish:_sourceRomanEnglish,romanEnglishAyat:_legacyRomanEnglishAyat,disableAllTextConversions:_legacyDisableAllTextConversions, ...source}=rawSource;
  const legacyApiHadithDefault=source.schemaVersion !== undefined && source.schemaVersion < 8 && source.hadithProvider === 'hadith-api';
  const legacyProviderDefaults=source.schemaVersion !== undefined && source.schemaVersion < 11;
  const legacyQuran={...DEFAULT_QURAN_OPTIONS,
    arabic:_arabicEnabled ?? DEFAULT_QURAN_OPTIONS.arabic,
    english:_englishEnabled ?? DEFAULT_QURAN_OPTIONS.english,
    link:_linkInsertion ?? DEFAULT_QURAN_OPTIONS.link,
  };
  const legacyHadith={...DEFAULT_HADITH_OPTIONS,
    arabic:_arabicEnabled ?? DEFAULT_HADITH_OPTIONS.arabic,
    english:_englishEnabled ?? DEFAULT_HADITH_OPTIONS.english,
    grading:_hadithGradingEnabled ?? DEFAULT_HADITH_OPTIONS.grading,
    link:_linkInsertion ?? DEFAULT_HADITH_OPTIONS.link,
  };
  const sourceCommandVisibility = source.commandVisibility as Record<string, boolean> | undefined;
  const normalizedCommandVisibility: Record<string, boolean> = { ...(sourceCommandVisibility ?? {}) };
  if (typeof normalizedCommandVisibility['insert-quran'] === 'boolean' && typeof normalizedCommandVisibility['fetch-quran'] !== 'boolean') normalizedCommandVisibility['fetch-quran']=normalizedCommandVisibility['insert-quran'];
  if (typeof normalizedCommandVisibility['insert-hadith'] === 'boolean' && typeof normalizedCommandVisibility['fetch-hadith'] !== 'boolean') normalizedCommandVisibility['fetch-hadith']=normalizedCommandVisibility['insert-hadith'];
  if (typeof normalizedCommandVisibility['disable-all-text-conversions'] === 'boolean' && typeof normalizedCommandVisibility['toggle-text-conversions'] !== 'boolean') normalizedCommandVisibility['toggle-text-conversions']=normalizedCommandVisibility['disable-all-text-conversions'];
  delete normalizedCommandVisibility['insert-quran'];
  delete normalizedCommandVisibility['insert-hadith'];
  delete normalizedCommandVisibility['disable-all-text-conversions'];
  const knownDefaults = defaultCommandVisibility();
  const legacyAllEnabledIds = Object.keys(knownDefaults);
  const isPreV13Settings = source.schemaVersion === undefined || source.schemaVersion < 13;
  const allLegacyCommandsWereEnabled = isPreV13Settings
    && !!sourceCommandVisibility
    && legacyAllEnabledIds.every(id => normalizedCommandVisibility[id] === true);
  const migratedCommandVisibility = allLegacyCommandsWereEnabled
    ? knownDefaults
    : { ...knownDefaults, ...normalizedCommandVisibility };
  return {
    ...structuredClone(DEFAULT_SETTINGS), ...source, schemaVersion:14, quranProvider:legacyProviderDefaults && source.quranProvider==='quran-unlocked' ? 'alquran-cloud' : (typeof source.quranProvider==='string' && source.quranProvider.trim() ? source.quranProvider : DEFAULT_SETTINGS.quranProvider),
    replacementRules:mergeReplacementRules(source.replacementRules, _legacyRabbConversion),
    formatting:normalizeFormatting({...DEFAULT_FORMATTING,...source.formatting}),
    quranLanguage:typeof source.quranLanguage==='string'&&source.quranLanguage.trim()?source.quranLanguage:'en',
    quranTranslation:typeof source.quranTranslation==='string'&&source.quranTranslation.trim()?source.quranTranslation:'hilali-khan',
    hadithLanguage:legacyApiHadithDefault?'en':(typeof source.hadithLanguage==='string'&&source.hadithLanguage.trim()?source.hadithLanguage:'en'),
    hadithTranslation:legacyApiHadithDefault?'eng':(typeof source.hadithTranslation==='string'&&source.hadithTranslation.trim()?source.hadithTranslation:'eng'),
    romanEnglish:typeof _sourceRomanEnglish === 'boolean' ? _sourceRomanEnglish : (_legacyRomanEnglishAyat === true || _sourceRomanEnglish === undefined),
    raNormalization:source.raNormalization === true,
    // Legacy setting was named `disableAllTextConversions`, so its boolean had the opposite meaning.
    textConversionsEnabled:typeof source.textConversionsEnabled === 'boolean'
      ? source.textConversionsEnabled
      : typeof _legacyDisableAllTextConversions === 'boolean'
        ? !_legacyDisableAllTextConversions
        : DEFAULT_SETTINGS.textConversionsEnabled,
    quranFetchLimit:typeof source.quranFetchLimit==='number' && Number.isInteger(source.quranFetchLimit) && source.quranFetchLimit > 0 ? source.quranFetchLimit : DEFAULT_SETTINGS.quranFetchLimit,
    hadithFetchLimit:typeof source.hadithFetchLimit==='number' && Number.isInteger(source.hadithFetchLimit) && source.hadithFetchLimit > 0 ? source.hadithFetchLimit : DEFAULT_SETTINGS.hadithFetchLimit,
    commandVisibility:migratedCommandVisibility,
    lastQuranOptions:normalizeOptions(source.lastQuranOptions,legacyQuran),
    lastHadithOptions:normalizeOptions(source.lastHadithOptions,legacyHadith),
  };
}
