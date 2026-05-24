import axios from 'axios';
import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';
import type { ResolverResult } from '../../models/retrieval';
import { ARXIV_RATE_LIMIT_MS, ARXIV_TIMEOUT_MS } from '../config';

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
    const strictQuery = `ti:${encodeURIComponent(normalizedTitle)}`;
    const broadQuery = `all:${encodeURIComponent(stripQueryPunctuation(normalizedTitle))}`;

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
    await requestLimiter.wait();

    try {
      const response = await axios.get<string>(url, {
        timeout: ARXIV_TIMEOUT_MS,
        responseType: 'text',
      });
      return this.parseAtomResponse(response.data);
    } catch (error) {
      if (shouldRetry(error)) {
        await requestLimiter.wait();
        const retryResponse = await axios.get<string>(url, {
          timeout: ARXIV_TIMEOUT_MS,
          responseType: 'text',
        });
        return this.parseAtomResponse(retryResponse.data);
      }

      throw error;
    }
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

function stripQueryPunctuation(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeAxiosError = error as { code?: string; response?: { status?: number } };
  return maybeAxiosError.code === 'ECONNABORTED' || maybeAxiosError.response?.status === 429;
}
