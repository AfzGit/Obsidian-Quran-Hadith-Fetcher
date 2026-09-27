const QURAN_WEBSITES = {
  'quran-unlocked': 'https://quran.islamunlocked.com/quran/en-hilali-khan/quran:$surah:$ayah',
  'quran-com': 'https://quran.com/$surah/$ayah',
  'quran-wbw': 'https://quranwbw.com/$surah/$ayah',
} as const;
export type QuranWebsite = keyof typeof QURAN_WEBSITES | 'custom';
/**
 * Validate a custom Quran URL template without making a network request. Returning
 * explicit errors lets the settings UI reject malformed links before they are shown
 * or opened; URL generation remains a separate deterministic operation.
 */
export function validateTemplate(template:string): string[] { const tokens = template.match(/\$[A-Za-z]+/g) ?? []; return [...new Set(tokens)].filter(t => !['$surah','$ayah','$ayahlast'].includes(t)); }
export function makeQuranUrl(website: QuranWebsite, template:string, surah:number, ayah:number, ayahLast:number, translationId:string='hilali-khan'):string {
  if(website==='quran-unlocked') {
    // Quran Unlocked links use the public site route:
    // https://quran.islamunlocked.com/quran/{translation-route}/quran:{surah}:{ayah}[-{ayahLast}]
    // Keep the Hilali-Khan translation on its canonical `en-hilali-khan` route.
    const routeId=translationId==='hilali-khan' ? 'en-hilali-khan' : translationId;
    const range=`${surah}:${ayah}${ayahLast>ayah?`-${ayahLast}`:''}`;
    return `https://quran.islamunlocked.com/quran/${encodeURIComponent(routeId)}/quran:${range}`;
  }

  const raw=website==='custom'?template:QURAN_WEBSITES[website];
  const invalid=validateTemplate(raw); if(invalid.length) throw new Error(`Unknown URL placeholders: ${invalid.join(', ')}`);
  return raw
    .replaceAll('$surah', encodeURIComponent(String(surah)))
    .replaceAll('$ayahlast', encodeURIComponent(String(ayahLast)))
    .replaceAll('$ayah', encodeURIComponent(String(ayah)));
}
export { QURAN_WEBSITES };
