import { requestUrl, type RequestUrlParam } from 'obsidian';
import { AppError } from './errors';

export interface HttpClient {
  getText(url: string, signal: AbortSignal): Promise<{ status: number; text: string; headers: Record<string, string> }>;
  getJson<T>(url: string, signal: AbortSignal): Promise<{ status: number; json: T; headers: Record<string, string> }>;
}

interface ProviderHttpPolicy {
  key: string;
  /** Minimum spacing between request starts. Zero means no client-side throttling. */
  minIntervalMs: number;
  maxAttempts: number;
}

// A zero-interval default is intentional. Only providers for which the plugin has
// a concrete pacing reason receive a client-side interval; inventing a universal
// limit would unnecessarily throttle providers that explicitly permit normal use.
const DEFAULT_POLICY: ProviderHttpPolicy = { key: 'default', minIntervalMs: 0, maxAttempts: 4 };

// Al Quran Cloud documents a soft per-IP rate limit of about 10 requests/second.
// A small amount of headroom avoids intentionally operating on the published ceiling.
const PROVIDER_POLICIES: readonly { match: RegExp; policy: ProviderHttpPolicy }[] = [
  { match: /^https?:\/\/api\.alquran\.cloud(?:\/|$)/iu, policy: { key: 'alquran-cloud', minIntervalMs: 120, maxAttempts: 4 } },
];

function policyForUrl(url: string): ProviderHttpPolicy {
  return PROVIDER_POLICIES.find(item => item.match.test(url))?.policy ?? DEFAULT_POLICY;
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  return headers[name.toLowerCase()];
}

function retryAfterMs(headers: Record<string, string>): number | undefined {
  const value = headerValue(headers, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300_000, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(300_000, Math.max(0, date - Date.now()));
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** attempt);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(new AppError('Operation cancelled.', 'cancelled'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
    };
    const timer = setTimeout(() => done(resolve), ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      done(() => reject(new AppError('Operation cancelled.', 'cancelled')));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

class RequestScheduler {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();

  async run<T>(policy: ProviderHttpPolicy, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    if (policy.minIntervalMs <= 0) return task();

    const previous = this.tails.get(policy.key) ?? Promise.resolve();
    let resolveTail: (() => void) | undefined;
    const currentTail = new Promise<void>(resolve => { resolveTail = resolve; });
    this.tails.set(policy.key, currentTail);

    await previous.catch(() => undefined);
    try {
      const elapsed = Date.now() - (this.lastStart.get(policy.key) ?? 0);
      if (elapsed < policy.minIntervalMs) await sleep(policy.minIntervalMs - elapsed, signal);
      if (signal.aborted) throw new AppError('Operation cancelled.', 'cancelled');
      this.lastStart.set(policy.key, Date.now());
      return await task();
    } finally {
      resolveTail?.();
      if (this.tails.get(policy.key) === currentTail) this.tails.delete(policy.key);
    }
  }
}

// Public HTTP facade. Provider code should call this class through HttpClient and
// should never call `requestUrl` directly; that keeps retry/cancellation behavior
// consistent across all adapters and makes network behavior mockable in tests.
/**
 * Thin adapter around Obsidian's requestUrl API.
 *
 * Keeping this boundary in one class lets providers remain unaware of Obsidian
 * and makes the HTTP layer replaceable in unit tests. Retry, timeout, concurrency,
 * and cancellation policy belongs here/core helpers rather than being duplicated
 * inside every provider.
 */
export class ObsidianHttpClient implements HttpClient {
  private readonly scheduler = new RequestScheduler();

  async getText(url: string, signal: AbortSignal): Promise<{status:number;text:string;headers:Record<string,string>}> {
    if (signal.aborted) throw new AppError('Operation cancelled.', 'cancelled');
    const policy = policyForUrl(url);
    return this.scheduler.run(policy, signal, () => this.requestWithRetry(url, signal, policy));
  }

  private async requestWithRetry(url: string, signal: AbortSignal, policy: ProviderHttpPolicy): Promise<{status:number;text:string;headers:Record<string,string>}> {
    let lastNetworkError: unknown;
    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      if (signal.aborted) throw new AppError('Operation cancelled.', 'cancelled');
      try {
        const params: RequestUrlParam = { url, method: 'GET', throw: false };
        const response = await requestUrl(params);
        const headers = normalizeHeaders(response.headers);
        if (response.status >= 200 && response.status < 400) {
          if (signal.aborted) throw new AppError('Operation cancelled.', 'cancelled');
          return { status: response.status, text: response.text, headers };
        }
        if (!isRetryableStatus(response.status) || attempt >= policy.maxAttempts - 1) {
          throw new AppError(response.status === 429 ? 'Rate limited by provider.' : `HTTP Code ${response.status}`, 'http', response.status);
        }
        const delay = retryAfterMs(headers) ?? backoffMs(attempt);
        await sleep(delay, signal);
      } catch (error) {
        if (error instanceof AppError) {
          if (error.kind === 'cancelled') throw error;
          if (error.kind === 'http' && !isRetryableStatus(error.status ?? 0)) throw error;
          if (error.kind === 'http' && attempt >= policy.maxAttempts - 1) throw error;
          if (error.kind === 'http') continue;
        }
        lastNetworkError = error;
        if (attempt >= policy.maxAttempts - 1) {
          throw new AppError('Provider could not be reached.', 'network', undefined, { cause: error });
        }
        await sleep(backoffMs(attempt), signal);
      }
    }
    throw new AppError('Provider could not be reached.', 'network', undefined, { cause: lastNetworkError });
  }

  async getJson<T>(url: string, signal: AbortSignal) {
    const raw = await this.getText(url, signal);
    try {
      return { status: raw.status, json: JSON.parse(raw.text) as T, headers: raw.headers };
    } catch (e) {
      throw new AppError('Malformed JSON response.', 'parse', raw.status, { cause: e });
    }
  }
}
