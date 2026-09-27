import type { CacheEntry, CacheKey } from '../domain/models';

export interface CacheStore {
  get<T>(key: CacheKey): Promise<CacheEntry<T> | null>;
  set<T>(entry: CacheEntry<T>): Promise<void>;
  delete(key: CacheKey): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Runtime cache: fast, process-local results only. This cache is deliberately
 * disposable; durable provider datasets use PersistentJsonCache instead.
 *
 * The cache is bounded with a small LRU policy. Quran lookups are stored per
 * ayah, so a long-lived Obsidian session can otherwise accumulate thousands of
 * objects even though each individual request is limited to a small range.
 * Keeping the bound here makes every provider safe by default without inventing
 * a user-visible cache expiry policy.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly values = new Map<string, CacheEntry<unknown>>();

  private readonly maxEntries: number;

  constructor(maxEntries = 512) {
    // A non-finite or non-positive limit should never accidentally disable eviction.
    // Normalizing it here makes the cache bounded even if a future caller supplies
    // an invalid setting value.
    this.maxEntries = Number.isFinite(maxEntries) ? Math.max(1, Math.floor(maxEntries)) : 512;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.values.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    // Map insertion order provides a cheap LRU implementation: a read moves the
    // entry to the end so frequently used values survive eviction longer.
    this.values.delete(key);
    this.values.set(key, entry as CacheEntry<unknown>);
    return entry;
  }

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    // Replace an existing entry at the newest position in the LRU order.
    this.values.delete(entry.key);
    this.values.set(entry.key, entry as CacheEntry<unknown>);

    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }

  /** Exposed for focused tests and diagnostics without leaking the backing map. */
  get size(): number {
    return this.values.size;
  }
}

/**
 * Single-flight helper for network operations.
 *
 * When two identical requests arrive before the first finishes, only the first
 * task is executed and every caller awaits the same promise. This prevents
 * duplicate downloads caused by rapid repeated commands, overlapping UI actions,
 * or concurrent range workers. Failed work is removed immediately so a later
 * request can retry instead of inheriting a permanently rejected promise.
 */
export class SingleFlight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing;

    const promise = Promise.resolve().then(task);
    this.pending.set(key, promise);
    // Use `then` with both fulfillment and rejection handlers rather than an
    // unobserved `finally` promise; the latter would create an unhandled rejection
    // when the shared task fails even though every caller correctly awaits `promise`.
    void promise.then(
      () => { if (this.pending.get(key) === promise) this.pending.delete(key); },
      () => { if (this.pending.get(key) === promise) this.pending.delete(key); },
    );
    return promise;
  }

  get size(): number {
    return this.pending.size;
  }
}

/**
 * A cache is an optimization, not part of a successful fetch's correctness.
 * Providers use this helper when persisting a result so an unavailable cache
 * directory, full disk, or transient Vault error cannot turn a successful
 * network response into a failed fetch. The failure is logged for diagnostics.
 */
export async function setCacheBestEffort<T>(store: CacheStore, entry: CacheEntry<T>): Promise<void> {
  try {
    await store.set(entry);
  } catch (error) {
    console.warn('[Quran Hadith Fetcher] Cache write failed; continuing without cache.', error);
  }
}

export interface PersistentJsonStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Persistent cache writes follow the same "best effort" rule as the runtime
 * cache. Hadith JSON remains usable when its on-disk cache cannot be written.
 */
export async function setPersistentCacheBestEffort<T>(store: PersistentJsonStore | undefined, key: string, value: T): Promise<void> {
  if (!store) return;
  try {
    await store.set(key, value);
  } catch (error) {
    console.warn('[Quran Hadith Fetcher] Persistent cache write failed; continuing without cache.', error);
  }
}

/**
 * Build a deterministic cache key from named dimensions.
 *
 * Sorting keys is important: callers that provide the same dimensions in a
 * different object insertion order must still address the same cache entry.
 * Values are URI-encoded so separators in provider IDs, translations, or custom
 * identifiers cannot accidentally change the key structure.
 */
export function makeCacheKey(parts: Record<string, string | number | undefined>): string {
  return Object.keys(parts).sort().map((key) => `${key}=${encodeURIComponent(String(parts[key] ?? ''))}`).join('&');
}

export interface JsonFileAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  remove(path: string, recursive?: boolean): Promise<void>;
}

// Persistent JSON cache: use this for data that is expensive to download and can
// safely be reconstructed from a stored JSON value, such as Hadith JSON books.
// A cache key is encoded into a filename rather than used as a raw path so user
// or provider values cannot accidentally create nested directories.
export class PersistentJsonCache implements PersistentJsonStore {
  private rootReady = false;
  // Concurrent writes must share mkdir work so adapters do not race on the same folders.
  private rootPromise?: Promise<void>;

  constructor(private readonly adapter: JsonFileAdapter, private readonly root: string) {}

  private async ensureRoot(): Promise<void> {
    if (this.rootReady) return;
    if (this.rootPromise) return this.rootPromise;
    const pending = (async () => {
      const parts = this.root.split('/').filter(Boolean);
      let current = this.root.startsWith('/') ? '/' : '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
      }
      this.rootReady = true;
    })();
    this.rootPromise = pending;
    try {
      await pending;
    } finally {
      if (this.rootPromise === pending) this.rootPromise = undefined;
    }
  }

  private path(key: string): string {
    const safe = encodeURIComponent(key).replace(/%/gu, '_').slice(0, 180) || 'cache';
    return `${this.root}/${safe}.json`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const path = this.path(key);
      if (!(await this.adapter.exists(path))) return null;
      const parsed = JSON.parse(await this.adapter.read(path)) as { version?: number; key?: string; value?: unknown };
      // Version 1 entries from previous releases did not store the original key.
      // They remain readable because existing provider keys are short and stable;
      // new entries use version 2 so future key-truncation/collision protection can
      // verify that a filename really belongs to the requested cache key.
      if (parsed.version === 2) return parsed.key === key && 'value' in parsed ? parsed.value as T : null;
      return parsed.version === 1 && 'value' in parsed ? parsed.value as T : null;
    } catch {
      // Corrupt or temporarily unreadable cache files behave as misses; the next fetch can rebuild them.
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureRoot();
    await this.adapter.write(this.path(key), JSON.stringify({ version: 2, key, storedAt: Date.now(), value }));
  }

  async delete(key: string): Promise<void> {
    const path = this.path(key);
    if (await this.adapter.exists(path)) await this.adapter.remove(path);
  }

  async clear(): Promise<void> {
    if (await this.adapter.exists(this.root)) await this.adapter.remove(this.root, true);
    this.rootReady = false;
  }
}
