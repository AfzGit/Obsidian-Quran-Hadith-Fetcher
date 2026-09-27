import type { OfflineDatabaseDefinition } from './offline';
import type {
  CollectionDefinition,
  HadithReference,
  HadithResult,
  ProviderCapabilities,
  ProviderMetadata,
  QuranReference,
  QuranResult,
  TranslationDefinition,
} from './models';

export interface FetchContext {
  signal: AbortSignal;
}

export interface ProviderHealth {
  providerId: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  errorKind?: 'network' | 'http' | 'timeout' | 'parse' | 'unknown';
  message?: string;
}

export interface QuranProvider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;
  listTranslations(ctx: FetchContext): Promise<TranslationDefinition[]>;
  listOfflineDatabases(ctx: FetchContext): Promise<OfflineDatabaseDefinition[]>;
  fetchQuran(reference: QuranReference, translation: TranslationDefinition, ctx: FetchContext): Promise<QuranResult>;
  healthCheck(ctx: FetchContext): Promise<ProviderHealth>;
}


export interface HadithProvider {
  readonly metadata: ProviderMetadata;
  readonly capabilities: ProviderCapabilities;
  listCollections(ctx: FetchContext): Promise<CollectionDefinition[]>;
  listTranslations(ctx: FetchContext): Promise<TranslationDefinition[]>;
  listOfflineDatabases(ctx: FetchContext): Promise<OfflineDatabaseDefinition[]>;
  fetchHadith(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult>;
  fetchHadithRange(reference: HadithReference, translation: TranslationDefinition, ctx: FetchContext): Promise<HadithResult[]>;
  healthCheck(ctx: FetchContext): Promise<ProviderHealth>;
}
