import { App, normalizePath } from 'obsidian';
import { AppError } from '../core/errors';
import type { HttpClient } from '../core/http';
import type {
  InstalledOfflineDatabase,
  OfflineDatabaseDefinition,
  OfflineDatabasePart,
  OfflineDatabaseStore,
  OfflineInstallProgress,
} from '../domain/offline';

interface OfflineManifest extends Omit<InstalledOfflineDatabase, 'parts'> {
  version: 1;
  parts: Record<string, { fileName: string; bytes: number; sha256?: string }>;
}

interface OfflineAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

const MANIFEST_FILE = 'manifest.json';
const DB_ROOT_NAME = 'offline';

function safePartFileName(part: OfflineDatabasePart): string {
  const name = part.fileName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  return name || `${part.id}.json`;
}

function safeDatabaseName(id: string): string { return encodeURIComponent(id); }


async function sha256(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

// Offline storage uses a staged-install model. A complete, validated temporary
// copy is published only after all parts succeed, so cancellation or a broken
// download cannot destroy the user's previous known-good dataset.
export class ObsidianOfflineDatabaseStore implements OfflineDatabaseStore {
  private readonly verifiedParts = new Set<string>();
  private readonly installLocks = new Map<string, Promise<InstalledOfflineDatabase>>();
  private readonly adapter: OfflineAdapter;
  private readonly root: string;

  constructor(app: App, pluginId: string) {
    this.adapter = app.vault.adapter as unknown as OfflineAdapter;
    this.root = normalizePath(`${app.vault.configDir}/plugins/${pluginId}/${DB_ROOT_NAME}`);
  }

  private async ensureDirectory(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const parts = normalized.split('/').filter(Boolean);
    let current = normalized.startsWith('/') ? '/' : '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
    }
  }

  private manifestPath(databaseId: string): string {
    return normalizePath(`${this.root}/${safeDatabaseName(databaseId)}/${MANIFEST_FILE}`);
  }

  private async readManifest(databaseId: string): Promise<OfflineManifest | null> {
    const path = this.manifestPath(databaseId);
    if (!(await this.adapter.exists(path))) return null;
    try {
      const raw = await this.adapter.read(path);
      const parsed = JSON.parse(raw) as Partial<OfflineManifest>;
      if (parsed.version !== 1 || parsed.id !== databaseId || typeof parsed.providerId !== 'string' || (parsed.kind !== 'quran' && parsed.kind !== 'hadith') || (parsed.category !== undefined && parsed.category !== 'quran' && parsed.category !== 'quran-translation' && parsed.category !== 'hadith') || (parsed.categories !== undefined && (!Array.isArray(parsed.categories) || parsed.categories.some(value=>value !== 'quran' && value !== 'quran-translation' && value !== 'hadith'))) || typeof parsed.label !== 'string' || !parsed.parts || typeof parsed.parts !== 'object') {
        throw new Error('Invalid offline manifest');
      }
      const partEntries=Object.entries(parsed.parts as Record<string, unknown>);
      const fileNames=new Set<string>();
      for(const [partId,value] of partEntries){
        if(!partId || !value || typeof value!=='object') throw new Error('Invalid offline manifest part');
        const item=value as Record<string,unknown>;
        if(typeof item.fileName!=='string' || !item.fileName || typeof item.bytes!=='number' || !Number.isFinite(item.bytes) || item.bytes<0) throw new Error('Invalid offline manifest part');
        if(fileNames.has(item.fileName)) throw new Error('Duplicate offline manifest file');
        fileNames.add(item.fileName);
        if(item.sha256!==undefined && (typeof item.sha256!=='string' || !/^[0-9a-f]{64}$/iu.test(item.sha256))) throw new Error('Invalid offline manifest checksum');
      }
      return parsed as OfflineManifest;
    } catch (error) {
      throw new AppError('The offline database manifest is corrupted. Reinstall it.', 'parse', undefined, { cause: error });
    }
  }

  private async tryRemovePath(path: string): Promise<boolean> {
    const delays = [0, 100, 250, 500, 1000, 2000, 4000];
    for (const delay of delays) {
      if (delay) await new Promise<void>(resolve => setTimeout(resolve, delay));
      try {
        if (!(await this.adapter.exists(path))) return true;
        await this.adapter.remove(path, true);
        return true;
      } catch {
        // Retry below. Windows/OneDrive can transiently hold a directory.
      }
    }
    return false;
  }

  private async cleanupRemovingDirectories(): Promise<void> {
    if (!(await this.adapter.exists(this.root))) return;
    const listing = await (this.adapter as unknown as { list(path: string): Promise<{ files: string[]; folders: string[] }> }).list(this.root);
    await Promise.all(listing.folders
      .filter(folder => folder.includes('.removing-'))
      .map(folder => this.tryRemovePath(normalizePath(`${this.root}/${folder}`))));
  }

  private categoriesForManifest(manifest:OfflineManifest): readonly ('quran'|'quran-translation'|'hadith')[] {
    if(manifest.categories?.length) return manifest.categories;
    if(manifest.category) return [manifest.category];
    if(manifest.kind==='hadith') return ['hadith'];
    if(manifest.providerId==='quran-project') return ['quran','quran-translation'];
    if(manifest.providerId==='quran-api') return manifest.id==='quran-api:arabic' ? ['quran'] : ['quran-translation'];
    return ['quran'];
  }

  async listInstalled(): Promise<InstalledOfflineDatabase[]> {
    await this.cleanupRemovingDirectories();
    if (!(await this.adapter.exists(this.root))) return [];
    const listing = await (this.adapter as unknown as { list(path: string): Promise<{ files: string[]; folders: string[] }> }).list(this.root);
    const ids = listing.folders
      .filter(folder => !folder.endsWith('.installing') && !folder.endsWith('.backup') && !folder.includes('.installing-') && !folder.includes('.backup-') && !folder.includes('.removing-'))
      .map(folder => {
        const encoded = folder.slice(this.root.length + 1);
        try { return decodeURIComponent(encoded); } catch { return encoded; }
      });
    const manifests = await Promise.all(ids.map(id => this.readManifest(id)));
    const installed: InstalledOfflineDatabase[] = [];
    for (const manifest of manifests) {
      if (!manifest) continue;
      installed.push({
        id: manifest.id,
        providerId: manifest.providerId,
        kind: manifest.kind,
        category: manifest.category ?? this.categoriesForManifest(manifest)[0],
        categories: this.categoriesForManifest(manifest),
        label: manifest.label,
        description: manifest.description,
        installedAt: manifest.installedAt,
        sizeBytes: manifest.sizeBytes,
        parts: Object.keys(manifest.parts),
      });
    }
    return installed.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Read and parse one installed offline database part. Checksums are verified lazily
   * on first access so installation stays fast while later disk corruption is still
   * detected before data is returned; verification is process-local by design.
   */
  async getJson<T>(databaseId: string, partId: string): Promise<T | null> {
    const manifest = await this.readManifest(databaseId);
    if (!manifest) return null;
    const part = manifest.parts[partId];
    if (!part) return null;
    const key = `${databaseId}:${partId}`;
    const path = normalizePath(`${this.root}/${safeDatabaseName(databaseId)}/${part.fileName}`);
    try {
      const text = await this.adapter.read(path);
      const parsed = JSON.parse(text) as T;
      if (!this.verifiedParts.has(key) && part.sha256) {
        const actual = await sha256(text);
        if (actual && actual !== part.sha256) {
          this.verifiedParts.delete(key);
          throw new AppError('The offline database is corrupted. Please reinstall it.', 'parse');
        }
        this.verifiedParts.add(key);
      }
      return parsed;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('The offline database could not be read. Please reinstall it.', 'parse', undefined, { cause: error });
    }
  }

  /**
   * Install an offline database through the transactional install path. A per-ID
   * promise lock deduplicates concurrent installs, preventing two UI actions from
   * writing competing partial copies of the same database.
   */
  async install(
    definition: OfflineDatabaseDefinition,
    http: HttpClient,
    signal: AbortSignal,
    onProgress?: (progress: OfflineInstallProgress) => void,
  ): Promise<InstalledOfflineDatabase> {
    const existing = this.installLocks.get(definition.id);
    if (existing) return existing;

    const promise = this.installUnlocked(definition, http, signal, onProgress);
    this.installLocks.set(definition.id, promise);
    try {
      return await promise;
    } finally {
      this.installLocks.delete(definition.id);
    }
  }

  private async renameWithRetry(oldPath:string,newPath:string):Promise<void> {
    const delays=[0,100,250,500,1000,2000,4000];
    let lastError:unknown;
    for(const delay of delays){
      if(delay) await new Promise<void>(resolve=>setTimeout(resolve,delay));
      try{ await this.adapter.rename(oldPath,newPath); return; }catch(error){ lastError=error; }
    }
    const detail=lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
    throw new AppError(`The offline database is currently in use and cannot be replaced. Close any process using its files and try again. (${detail})`,'unknown',undefined,{cause:lastError});
  }

  private async installUnlocked(
    definition: OfflineDatabaseDefinition,
    http: HttpClient,
    signal: AbortSignal,
    onProgress?: (progress: OfflineInstallProgress) => void,
  ): Promise<InstalledOfflineDatabase> {
    if (!definition.parts.length) throw new AppError('This offline database has no downloadable data.', 'validation');
    const uniqueParts = new Set(definition.parts.map(part => part.id));
    if (uniqueParts.size !== definition.parts.length) throw new AppError('This offline database has duplicate data parts.', 'validation');
    const uniqueFiles = new Set<string>();
    for (const part of definition.parts) {
      if (!/^https?:\/\//iu.test(part.url)) throw new AppError(`Offline source for “${part.label}” must use HTTP(S).`, 'validation');
      const fileName = safePartFileName(part);
      if (uniqueFiles.has(fileName)) throw new AppError('This offline database has duplicate file names.', 'validation');
      uniqueFiles.add(fileName);
    }

    await this.ensureDirectory(this.root);
    const finalDir = normalizePath(`${this.root}/${safeDatabaseName(definition.id)}`);
    const tempDir = `${finalDir}.installing-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    await this.ensureDirectory(tempDir);

    const manifestParts: OfflineManifest['parts'] = {};
    let sizeBytes = 0;

    try {
      for (let index = 0; index < definition.parts.length; index++) {
        if (signal.aborted) throw new AppError('Operation cancelled.', 'cancelled');
        const part = definition.parts[index]!;
        onProgress?.({ databaseId: definition.id, completed: index, total: definition.parts.length, partLabel: part.label });
        const raw = await http.getText(part.url, signal);
        if (!raw.text.trim()) throw new AppError(`Downloaded data for “${part.label}” is empty.`, 'parse', raw.status);
        try { JSON.parse(raw.text); } catch (error) { throw new AppError(`Downloaded data for “${part.label}” is not valid JSON.`, 'parse', raw.status, { cause: error }); }
        const fileName = safePartFileName(part);
        const path = normalizePath(`${tempDir}/${fileName}`);
        await this.adapter.write(path, raw.text);
        const bytes = byteLength(raw.text);
        sizeBytes += bytes;
        manifestParts[part.id] = { fileName, bytes, sha256: await sha256(raw.text) };
        onProgress?.({ databaseId: definition.id, completed: index + 1, total: definition.parts.length, partLabel: part.label });
      }

      const manifest: OfflineManifest = {
        version: 1,
        id: definition.id,
        providerId: definition.providerId,
        kind: definition.kind,
        category: definition.category,
        categories: definition.categories,
        label: definition.label,
        description: definition.description,
        installedAt: Date.now(),
        sizeBytes,
        parts: manifestParts,
      };
      await this.adapter.write(normalizePath(`${tempDir}/${MANIFEST_FILE}`), JSON.stringify(manifest));

      // Replace atomically where the vault adapter permits it: keep the previous
      // complete database until the new directory has been renamed successfully.
      const backupDir = `${finalDir}.backup-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      if (await this.adapter.exists(finalDir)) await this.renameWithRetry(finalDir, backupDir);
      try {
        await this.renameWithRetry(tempDir, finalDir);
      } catch (error) {
        if (await this.adapter.exists(backupDir) && !(await this.adapter.exists(finalDir))) {
          try { await this.adapter.rename(backupDir, finalDir); } catch { /* preserve original error */ }
        }
        throw error;
      }
      if (await this.adapter.exists(backupDir)) {
        if (!(await this.tryRemovePath(backupDir))) {
          const cleanupPath=`${backupDir}.removing-${Date.now()}`;
          try { await this.adapter.rename(backupDir,cleanupPath); void this.tryRemovePath(cleanupPath); } catch { /* stale backup cleanup is non-fatal */ }
        }
      }
      for (const part of definition.parts) this.verifiedParts.delete(`${definition.id}:${part.id}`);
      return {
        id: manifest.id,
        providerId: manifest.providerId,
        kind: manifest.kind,
        category: manifest.category ?? this.categoriesForManifest(manifest)[0],
        categories: this.categoriesForManifest(manifest),
        label: manifest.label,
        description: manifest.description,
        installedAt: manifest.installedAt,
        sizeBytes: manifest.sizeBytes,
        parts: Object.keys(manifest.parts),
      };
    } catch (error) {
      try { if (await this.adapter.exists(tempDir)) await this.adapter.remove(tempDir, true); } catch { /* best effort cleanup */ }
      // Never remove the backup here: it is the last known-good copy and may be
      // needed after a failed adapter rename or an interrupted vault operation.
      throw error;
    }
  }

  private async removeWithRetry(path: string): Promise<void> {
    if (await this.tryRemovePath(path)) return;

    // A rename is usually allowed even when recursive deletion is temporarily
    // blocked by Windows/OneDrive. Move the directory out of the installed set
    // first, then retry deletion. The tombstone is intentionally excluded from
    // listInstalled(), so a successful logical removal never gets reported as
    // still installed. It will be cleaned up on the next store operation if the
    // filesystem remains locked.
    const removingPath = normalizePath(`${path}.removing-${Date.now()}`);
    try {
      if (await this.adapter.exists(path)) {
        await this.adapter.rename(path, removingPath);
        void this.tryRemovePath(removingPath);
        return;
      }
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AppError(`The offline database could not be removed. Close any process using its files and try again. (${detail})`, 'unknown', undefined, {cause:error});
    }
  }

  async remove(databaseId: string): Promise<void> {
    const finalDir = normalizePath(`${this.root}/${safeDatabaseName(databaseId)}`);
    if (await this.adapter.exists(finalDir)) await this.removeWithRetry(finalDir);
    for (const key of [...this.verifiedParts]) if (key.startsWith(`${databaseId}:`)) this.verifiedParts.delete(key);
  }
}
