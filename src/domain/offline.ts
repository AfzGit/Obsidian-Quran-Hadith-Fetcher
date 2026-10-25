import type { ProviderKind } from './models';
import type { HttpClient } from '../core/http';

export interface OfflineDatabasePart {
  id: string;
  label: string;
  url: string;
  fileName: string;
}

export type OfflineDatabaseCategory = 'quran' | 'quran-translation' | 'hadith';

export interface OfflineDatabaseDefinition {
  id: string;
  providerId: string;
  kind: ProviderKind;
  category?: OfflineDatabaseCategory;
  categories?: readonly OfflineDatabaseCategory[];
  label: string;
  description: string;
  parts: readonly OfflineDatabasePart[];
}

export interface InstalledOfflineDatabase {
  id: string;
  providerId: string;
  kind: ProviderKind;
  category?: OfflineDatabaseCategory;
  categories?: readonly OfflineDatabaseCategory[];
  label: string;
  description: string;
  installedAt: number;
  sizeBytes: number;
  parts: readonly string[];
}

export interface OfflineInstallProgress {
  databaseId: string;
  completed: number;
  total: number;
  partLabel: string;
}

export interface OfflineDatabaseStore {
  listInstalled(): Promise<InstalledOfflineDatabase[]>;
  getJson<T>(databaseId: string, partId: string): Promise<T | null>;
  /**
   * Cheap identity for the installed copy of a database. Implementations return a
   * value that changes whenever the database is reinstalled, or `null` when it is
   * not installed. Optional so lightweight/test stores stay simple; `undefined`
   * means the caller cannot detect replacements.
   */
  revision?(databaseId: string): Promise<string | null>;
  install(
    definition: OfflineDatabaseDefinition,
    http: HttpClient,
    signal: AbortSignal,
    onProgress?: (progress: OfflineInstallProgress) => void,
  ): Promise<InstalledOfflineDatabase>;
  remove(databaseId: string): Promise<void>;
}
