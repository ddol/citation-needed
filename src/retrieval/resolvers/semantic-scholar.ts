import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import type { ResolverResult } from '../../models/retrieval';
import { getWithRetry } from '../http-retry';
import {
  SEMANTIC_SCHOLAR_MAX_ATTEMPTS,
  SEMANTIC_SCHOLAR_RATE_LIMIT_MS,
  SEMANTIC_SCHOLAR_RETRY_BASE_MS,
  SEMANTIC_SCHOLAR_TIMEOUT_MS,
} from '../config';

const logger = createLogger('semantic-scholar-resolver');
const requestLimiter = new RateLimiter(SEMANTIC_SCHOLAR_RATE_LIMIT_MS);

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
 * Semantic Scholar aggregates arXiv, publisher OA and institutional
 * repositories, so it reaches papers Unpaywall and arXiv miss on their own
 * (PCL via pointclouds.org, OctoMap via uni-freiburg).
 *
 * Keyed by DOI, but the DOI does not make the answer trustworthy: it returned
 * `koval2013precontact.pdf` for Held 2016. Callers must title-check the result.
 */
export class SemanticScholarResolver {
  async getOpenAccessPdf(doi: string): Promise<ResolverResult<SemanticScholarResult | null>> {
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}` +
      `?fields=title,openAccessPdf`;

    try {
      const data = await getWithRetry<SemanticScholarWork>(url, {
        limiter: requestLimiter,
        maxAttempts: SEMANTIC_SCHOLAR_MAX_ATTEMPTS,
        baseMs: SEMANTIC_SCHOLAR_RETRY_BASE_MS,
        timeoutMs: SEMANTIC_SCHOLAR_TIMEOUT_MS,
        onRetry: (attempt, pause) =>
          logger.warn('Semantic Scholar throttled; backing off', { doi, attempt, pause }),
      });

      const pdfUrl = data.openAccessPdf?.url;
      if (!pdfUrl) return { ok: true, value: null };

      return { ok: true, value: { pdfUrl, title: data.title ?? '' } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Semantic Scholar lookup failed', { doi, err: message });
      return { ok: false, error: `Semantic Scholar lookup failed: ${message}` };
    }
  }
}
