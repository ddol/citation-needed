import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import type { ResolverResult } from '../../models/retrieval';
import { getWithRetry, isThrottled } from '../http-retry';
import {
  SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS,
  SEMANTIC_SCHOLAR_MAX_ATTEMPTS,
  SEMANTIC_SCHOLAR_RATE_LIMIT_MS,
  SEMANTIC_SCHOLAR_RETRY_BASE_MS,
  SEMANTIC_SCHOLAR_THROTTLE_TRIP,
  SEMANTIC_SCHOLAR_TIMEOUT_MS,
} from '../config';

const logger = createLogger('semantic-scholar-resolver');
const requestLimiter = new RateLimiter(SEMANTIC_SCHOLAR_RATE_LIMIT_MS);

export const SEMANTIC_SCHOLAR_KEY_HINT =
  'set SEMANTIC_SCHOLAR_API_KEY for a guaranteed quota (free from semanticscholar.org)';

export interface SemanticScholarResult {
  pdfUrl: string;
  /** Upstream's title, for the caller to check against the citation. */
  title: string;
}

interface SemanticScholarWork {
  title?: string;
  openAccessPdf?: { url?: string | null } | null;
}

/**
 * Breaker state. Without an API key the pool is shared across every caller, so
 * once it starts refusing us it keeps refusing for a while: retrying each
 * remaining DOI adds load, digs the throttle deeper, and still fails — a
 * 56-entry import spent ~13 minutes doing exactly that.
 *
 * But the streak passes. An earlier version stayed open for the whole run and
 * cost that same import every paper only Semantic Scholar carries, which is
 * worse than the hammering it prevented. So: open, wait, then let one probe
 * through and close again if it lands.
 */
let consecutiveThrottles = 0;
let openedAt: number | undefined;

type BreakerState = 'closed' | 'open' | 'half-open';

function breakerState(): BreakerState {
  if (openedAt === undefined) return 'closed';
  return Date.now() - openedAt >= SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS ? 'half-open' : 'open';
}

/** Exported for tests; a run is a process, so the breaker is process-wide. */
export function resetSemanticScholarBreaker(): void {
  consecutiveThrottles = 0;
  openedAt = undefined;
}

/** True while the breaker is refusing calls outright (not yet probing). */
export function isSemanticScholarBreakerOpen(): boolean {
  return breakerState() === 'open';
}

/**
 * Semantic Scholar aggregates arXiv, publisher OA and institutional
 * repositories, so it reaches papers Unpaywall and arXiv miss on their own
 * (PCL via pointclouds.org, OctoMap via uni-freiburg).
 *
 * Keyed by DOI, but the DOI does not make the answer trustworthy: it returned
 * `koval2013precontact.pdf` for Held 2016. Callers must title-check the result.
 */
export class SemanticScholarResolver {
  private apiKey?: string;

  constructor(apiKey: string | undefined = process.env.SEMANTIC_SCHOLAR_API_KEY) {
    this.apiKey = apiKey?.trim() || undefined;
  }

  async getOpenAccessPdf(doi: string): Promise<ResolverResult<SemanticScholarResult | null>> {
    const stateBefore = breakerState();
    if (stateBefore === 'open') {
      // Throttled, not absent: this DOI was never looked up, so it is worth
      // retrying once the pool has cooled off.
      return {
        ok: false,
        throttled: true,
        error: `skipped: rate limited, cooling off for ${Math.round(SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS / 1000)}s; ${SEMANTIC_SCHOLAR_KEY_HINT}`,
      };
    }

    const url =
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}` +
      `?fields=title,openAccessPdf`;

    try {
      const data = await getWithRetry<SemanticScholarWork>(url, {
        limiter: requestLimiter,
        // An API key buys a guaranteed quota, so retrying is worth it. Without
        // one, extra attempts are just extra load on a pool already refusing us.
        maxAttempts: this.apiKey ? SEMANTIC_SCHOLAR_MAX_ATTEMPTS : 2,
        baseMs: SEMANTIC_SCHOLAR_RETRY_BASE_MS,
        timeoutMs: SEMANTIC_SCHOLAR_TIMEOUT_MS,
        headers: this.apiKey ? { 'x-api-key': this.apiKey } : undefined,
        onRetry: (attempt, pause) =>
          logger.warn('Semantic Scholar throttled; backing off', { doi, attempt, pause }),
      });

      // The pool is answering again: close the breaker.
      consecutiveThrottles = 0;
      openedAt = undefined;

      const pdfUrl = data.openAccessPdf?.url;
      if (!pdfUrl) return { ok: true, value: null };

      return { ok: true, value: { pdfUrl, title: data.title ?? '' } };
    } catch (err) {
      if (isThrottled(err)) {
        consecutiveThrottles += 1;
        // A failed probe means the streak is still running — start the cooldown
        // again rather than letting every subsequent DOI probe too.
        if (stateBefore === 'half-open' || consecutiveThrottles >= SEMANTIC_SCHOLAR_THROTTLE_TRIP) {
          openedAt = Date.now();
          logger.warn('Semantic Scholar breaker open; pausing lookups', {
            cooldownMs: SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS,
          });
        }
      } else {
        // A 404 is just an unknown DOI, not evidence the API is refusing us.
        consecutiveThrottles = 0;
      }

      const message = err instanceof Error ? err.message : String(err);
      const hint = isThrottled(err) && !this.apiKey ? `; ${SEMANTIC_SCHOLAR_KEY_HINT}` : '';
      logger.warn('Semantic Scholar lookup failed', { doi, err: message });
      return {
        ok: false,
        throttled: isThrottled(err),
        error: `Semantic Scholar lookup failed: ${message}${hint}`,
      };
    }
  }
}
