import type { HadithProvider, QuranProvider } from '../domain/provider';
/**
 * Explicit runtime provider registry. Registration happens in main.ts rather than
 * through auto-discovery, making the supported source set easy to audit and keeping
 * provider lookup centralized for commands and settings.
 */
export class ProviderRegistry {
  private readonly quran = new Map<string,QuranProvider>();
  private readonly hadith = new Map<string,HadithProvider>();
  registerQuran(provider: QuranProvider): void { this.quran.set(provider.metadata.id, provider); }
  registerHadith(provider: HadithProvider): void { this.hadith.set(provider.metadata.id, provider); }
  getQuran(id:string): QuranProvider { const p=this.quran.get(id); if(!p) throw new Error(`Unknown Quran provider: ${id}`); return p; }
  getHadith(id:string): HadithProvider { const p=this.hadith.get(id); if(!p) throw new Error(`Unknown Hadith provider: ${id}`); return p; }
  listQuran(): QuranProvider[] { return [...this.quran.values()]; }
  listHadith(): HadithProvider[] { return [...this.hadith.values()]; }
}
