export interface NumberRange { start:number; end:number; }

/**
 * Collapse a list of ayah numbers into the smallest set of inclusive ranges.
 *
 * The input is deduplicated and sorted because callers may collect missing ayahs
 * from several cache/offline sources in arbitrary order. Keeping this helper here
 * means providers can turn `1,2,3,7,8` into `1-3` and `7-8` before making requests.
 */
export function contiguousRanges(numbers:readonly number[]):NumberRange[]{
  const sorted=[...new Set(numbers)].sort((a,b)=>a-b);
  if(!sorted.length) return [];
  const ranges:NumberRange[]=[];
  let start=sorted[0]!;
  let end=start;
  for(const number of sorted.slice(1)){
    if(number===end+1){ end=number; continue; }
    ranges.push({start,end});
    start=end=number;
  }
  ranges.push({start,end});
  return ranges;
}

// Bounded concurrency protects providers from accidental request bursts while
// still allowing independent targeted requests to proceed in parallel. Result
// positions are kept stable even though workers finish in an arbitrary order.
export async function mapWithConcurrency<T,R>(items:readonly T[], concurrency:number, worker:(item:T,index:number)=>Promise<R>):Promise<R[]>{
  if(!items.length) return [];
  const width=Math.max(1,Math.floor(concurrency));
  const results=new Array<R>(items.length);
  let nextIndex=0;
  // Workers claim indexes directly instead of slicing the input for every runner.
  // This avoids an unnecessary array allocation and keeps range fetching cheap even
  // when a provider returns many independent targeted items.
  const runners=Array.from({length:Math.min(width,items.length)},async()=>{
    while(nextIndex<items.length){
      const index=nextIndex++;
      results[index]=await worker(items[index]!,index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Standard Quran ayah counts by surah. The count is used only as a bandwidth
 * heuristic: a whole-surah download should be preferred only when a meaningful
 * fraction of a surah is missing, not merely because several small targeted
 * requests would technically be required.
 *
 * The array index is the one-based Surah number minus one; keep all 114 entries
 * in canonical order and cover any changes with a regression test.
 */
export const QURAN_SURAH_AYAH_COUNTS: readonly number[] = [
  7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,36,5,19,37,44,46,30,22,25,20,15,21,10,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6
];

/**
 * Decide whether to fetch a complete surah. The economic request-count check is
 * combined with a coverage check so large surahs do not become whole downloads
 * when the user only needs a few missing ayahs. `minimumMissingCoverage` defaults
 * to 20%, which is intentionally conservative for ordinary short lookups.
 */
export function shouldFetchWholeQuranSurah(
  reference: {surah:number; startAyah:number; endAyah:number},
  missingCount: number,
  requestsPerAyah: number,
  wholeSurahRequests: number,
  minimumMissingCount: number,
  minimumMissingCoverage = 0.20,
): boolean {
  if (missingCount < minimumMissingCount) return false;
  const totalAyahs = QURAN_SURAH_AYAH_COUNTS[reference.surah - 1];
  if (!totalAyahs || totalAyahs <= 0) return false;
  const coverage = missingCount / totalAyahs;
  if (coverage < Math.max(0, Math.min(1, minimumMissingCoverage))) return false;
  const targetedRequests = missingCount * Math.max(1, requestsPerAyah);
  return targetedRequests > Math.max(1, wholeSurahRequests);
}
