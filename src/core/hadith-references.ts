import { AppError } from './errors';
import type { HadithReference, HadithResult, TranslationDefinition } from '../domain/models';
import type { FetchContext, HadithProvider } from '../domain/provider';

function missing(error: unknown): boolean {
  return error instanceof AppError && (error.kind === 'parse' || (error.kind === 'http' && error.status === 404));
}

function numbers(reference: HadithReference): HadithReference[] {
  const end = reference.endHadithNumber ?? reference.hadithNumber;
  if (typeof reference.hadithNumber !== 'number' || typeof end !== 'number') return [{...reference, endHadithNumber: undefined}];
  const start = reference.hadithNumber;
  return Array.from({length:end - start + 1}, (_, offset) =>
    ({kind:'hadith', collectionId:reference.collectionId, hadithNumber:start + offset})
  );
}

/**
 * Resolve references in UI order. Muslim's bare number is a lookup convenience:
 * lettered canonical records win; an unsuffixed record is used only when no
 * lettered record exists. Only confirmed misses end suffix probing.
 */
export async function fetchHadithReferences(
  provider: HadithProvider, references: readonly HadithReference[], translation: TranslationDefinition,
  ctx: FetchContext, maximum: number,
): Promise<HadithResult[]> {
  const expanded = references.flatMap(numbers);
  if (expanded.length > maximum) throw new AppError(`Hadith fetch limit is ${maximum} hadiths.`, 'validation');
  const results: HadithResult[] = [];
  for (const reference of expanded) {
    const isMuslim = reference.collectionId.toLowerCase() === 'muslim';
    const explicit = typeof reference.hadithNumber === 'string' && /[a-z]$/iu.test(reference.hadithNumber);
    if (!isMuslim || explicit) { results.push(await provider.fetchHadith(reference, translation, ctx)); continue; }
    const base = String(reference.hadithNumber);
    const lettered: HadithResult[] = [];
    const seenContent = new Set<string>();
    for (let code = 97; code <= 122; code++) {
      try {
        const result = await provider.fetchHadith({...reference, hadithNumber:`${base}${String.fromCharCode(code)}`}, translation, ctx);
        // Hadith Unlocked redirects a missing suffix (for example 204c) to the
        // first record for the base number. Its JSON response is therefore 200,
        // not a conventional not-found; repeated text is the confirmed boundary.
        const identity = `${result.arabic ?? ''}\u0000${result.english ?? ''}`;
        if (seenContent.has(identity)) break;
        seenContent.add(identity);
        lettered.push(result);
      }
      catch (error) { if (missing(error)) break; throw error; }
    }
    if (lettered.length) { results.push(...lettered); }
    else {
      try { results.push(await provider.fetchHadith(reference, translation, ctx)); }
      catch (error) { if (missing(error)) throw new AppError(`Hadith ${base} was not found in Sahih Muslim.`, 'parse'); throw error; }
    }
    if (results.length > maximum) throw new AppError(`Hadith fetch limit is ${maximum} hadiths.`, 'validation');
  }
  return results;
}
