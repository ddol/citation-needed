import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import type { ResolverResult } from '../../models/retrieval';
import { getWithRetry } from '../http-retry';
import { selectBestMatch, TITLE_SEARCH_THRESHOLD } from '../title-match';
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

  private async queryArxiv(searchQuery: string): Promise<ArxivResult[]> {
    const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=5`;
    const xml = await getWithRetry<string>(url, {
      limiter: requestLimiter,
      maxAttempts: ARXIV_MAX_ATTEMPTS,
      baseMs: ARXIV_RETRY_BASE_MS,
      timeoutMs: ARXIV_TIMEOUT_MS,
      responseType: 'text',
      onRetry: (attempt, pause) =>
        logger.warn('arXiv query throttled; backing off', { attempt, pause }),
    });
    return this.parseAtomResponse(xml);
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

function stripQueryPunctuation(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * arXiv is searched *by title*, so the title is the only evidence that a hit is
 * the right paper — hence the strict threshold. Papers that predate arXiv
 * (Kalman 1960, Kuhn 1955) have no correct answer at all, and arXiv will still
 * return something.
 */
export function selectArxivMatch(
  expectedTitle: string,
  candidates: ArxivResult[]
): ArxivResult | undefined {
  return selectBestMatch(expectedTitle, candidates, (c) => c.title, TITLE_SEARCH_THRESHOLD);
}
