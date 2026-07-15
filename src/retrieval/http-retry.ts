import axios from 'axios';
import type { RateLimiter } from '../utils/rate-limiter';

/**
 * Shared throttle-aware GET for retrieval upstreams.
 *
 * Every source here rate-limits, and a throttled request is not an absent
 * paper: when a 429 escapes as a failed lookup it reads as "no PDF found",
 * which is exactly how a real import lost 36 of 54 arXiv hits.
 */

interface TransientError {
  code?: string;
  response?: { status?: number; headers?: Record<string, unknown> };
}

export function isTransient(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const { code, response } = error as TransientError;
  const status = response?.status;
  // 429 = throttled; 5xx = upstream having a moment. Both are worth another try.
  return code === 'ECONNABORTED' || status === 429 || (status != null && status >= 500);
}

/** Honour Retry-After when the upstream sends it, else exponential backoff. */
export function backoffMs(error: unknown, attempt: number, baseMs: number): number {
  const header = (error as TransientError)?.response?.headers?.['retry-after'];
  const retryAfterSeconds = Number(header);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return baseMs * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface RetryOptions {
  limiter: RateLimiter;
  maxAttempts: number;
  baseMs: number;
  timeoutMs: number;
  responseType?: 'text' | 'json';
  headers?: Record<string, string>;
  onRetry?: (attempt: number, pauseMs: number) => void;
}

export function isThrottled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as TransientError).response?.status === 429;
}

/** GET `url`, retrying transient failures. Throws the last error if all fail. */
export async function getWithRetry<T>(url: string, options: RetryOptions): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
    await options.limiter.wait();

    try {
      const response = await axios.get<T>(url, {
        timeout: options.timeoutMs,
        responseType: options.responseType ?? 'json',
        ...(options.headers ? { headers: options.headers } : {}),
      });
      return response.data;
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === options.maxAttempts - 1) break;
      const pause = backoffMs(error, attempt, options.baseMs);
      options.onRetry?.(attempt + 1, pause);
      await sleep(pause);
    }
  }

  throw lastError;
}
