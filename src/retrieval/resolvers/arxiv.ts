import axios from 'axios';
import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import type { ResolverResult } from '../../models/retrieval';
import {
  ARXIV_MAX_ATTEMPTS,
  ARXIV_RATE_LIMIT_MS,
  ARXIV_RETRY_BASE_MS,
  ARXIV_TIMEOUT_MS,
} from '../config';

const logger = createLogger('arxiv-resolver');
const requestLimiter = new RateLimiter(ARXIV_RATE_LIMIT_MS);

export interface ArxivResult {
  arxivId: string;
  pdfUrl: string;
  title: string;
}

export class ArxivResolver {
  getPdfUrl(arxivId: string): string {
    const cleanId = arxivId.replace(/v\d+$/, '');
    return `https://arxiv.org/pdf/${cleanId}`;
  }

  async searchByTitle(title: string): Promise<ResolverResult<ArxivResult[]>> {
    const normalizedTitle = normalizeTitle(title);
    // The phrase MUST stay quoted. arXiv splits an unquoted field value on
    // whitespace and ORs the terms across all fields, so `ti:Foo Bar Baz`
    // becomes `ti:Foo OR all:Bar OR all:Baz` — a query that matches most of
    // the corpus and ranks an unrelated paper first.
    const strictQuery = `ti:${encodeURIComponent(quotePhrase(normalizedTitle))}`;
    const broadQuery = `all:${encodeURIComponent(quotePhrase(stripQueryPunctuation(normalizedTitle)))}`;

    try {
      const strictResults = await this.queryArxiv(strictQuery);
      if (strictResults.length > 0) {
        return { ok: true, value: strictResults };
      }

      if (broadQuery === strictQuery) {
        return { ok: true, value: [] };
      }

      const broadResults = await this.queryArxiv(broadQuery);
      return { ok: true, value: broadResults };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('arXiv search failed', { title: normalizedTitle, err: message });
      return { ok: false, error: `arXiv search failed: ${message}` };
    }
  }

  /**
   * arXiv throttles hard, and a throttled query is not an absent paper: a 429
   * that escapes here becomes "no PDF found" for a paper that arXiv hosts. So
   * back off and retry rather than surfacing the failure as a miss.
   */
  private async queryArxiv(searchQuery: string): Promise<ArxivResult[]> {
    const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=5`;
    let lastError: unknown;

    for (let attempt = 0; attempt < ARXIV_MAX_ATTEMPTS; attempt += 1) {
      await requestLimiter.wait();

      try {
        const response = await axios.get<string>(url, {
          timeout: ARXIV_TIMEOUT_MS,
          responseType: 'text',
        });
        return this.parseAtomResponse(response.data);
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error) || attempt === ARXIV_MAX_ATTEMPTS - 1) {
          break;
        }
        const pause = backoffMs(error, attempt);
        logger.warn('arXiv query throttled; backing off', { attempt: attempt + 1, pause });
        await sleep(pause);
      }
    }

    throw lastError;
  }

  private parseAtomResponse(xml: string): ArxivResult[] {
    const results: ArxivResult[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;

    for (const entryMatch of xml.matchAll(entryRegex)) {
      const entry = entryMatch[1];
      const idMatch = /<id>([\s\S]*?)<\/id>/.exec(entry);
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(entry);

      if (!idMatch) continue;
      const rawId = idMatch[1].trim();
      const arxivIdMatch = /arxiv\.org\/abs\/([^\s]+)/i.exec(rawId);
      if (!arxivIdMatch) continue;

      const arxivId = arxivIdMatch[1].replace(/v\d+$/, '');
      const entryTitle = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

      results.push({
        arxivId,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
        title: entryTitle,
      });
    }

    return results;
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

/** Wrap in double quotes so arXiv treats the value as a single phrase. */
function quotePhrase(value: string): string {
  return `"${value.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * Collapse a title to comparable form: LaTeX braces, punctuation, case and
 * whitespace all vary between BibTeX and arXiv for the same paper.
 */
function normalizeForCompare(title: string): string {
  return title
    .replace(/[{}\\]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 1 = identical after normalization, 0 = nothing in common. */
export function titleSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const longest = Math.max(left.length, right.length);
  return (longest - levenshtein(left, right)) / longest;
}

/**
 * arXiv ranks by relevance and always answers with *something*, so a returned
 * result is a candidate, not a match. Papers that predate arXiv (Kalman 1960,
 * Kuhn 1955) have no correct answer at all. Require a near-exact title before
 * trusting a hit — a missing PDF is recoverable, a wrong one is silent
 * corruption.
 */
export const ARXIV_TITLE_MATCH_THRESHOLD = 0.9;

export function selectArxivMatch(
  expectedTitle: string,
  candidates: ArxivResult[]
): ArxivResult | undefined {
  let best: ArxivResult | undefined;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = titleSimilarity(expectedTitle, candidate.title);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= ARXIV_TITLE_MATCH_THRESHOLD ? best : undefined;
}

function stripQueryPunctuation(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface RetryableError {
  code?: string;
  response?: { status?: number; headers?: Record<string, unknown> };
}

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code, response } = error as RetryableError;
  const status = response?.status;
  // 429 = throttled; 5xx = arXiv having a moment. Both are worth another try.
  return code === 'ECONNABORTED' || status === 429 || (status != null && status >= 500);
}

/** Honour Retry-After when arXiv sends it, else exponential backoff. */
function backoffMs(error: unknown, attempt: number): number {
  const header = (error as RetryableError)?.response?.headers?.['retry-after'];
  const retryAfterSeconds = Number(header);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return ARXIV_RETRY_BASE_MS * 2 ** attempt;
}
