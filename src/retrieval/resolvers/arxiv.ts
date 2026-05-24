import axios from 'axios';
import { createLogger } from '../../utils/logger';
import { RateLimiter } from '../../utils/rate-limiter';

const logger = createLogger('arxiv-resolver');
const requestLimiter = new RateLimiter(2000);

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

  async searchByTitle(title: string): Promise<ArxivResult[]> {
    const normalizedTitle = normalizeTitle(title);
    const strictQuery = `ti:${encodeURIComponent(normalizedTitle)}`;
    const broadQuery = `all:${encodeURIComponent(stripQueryPunctuation(normalizedTitle))}`;

    try {
      const strictResults = await this.queryArxiv(strictQuery);
      if (strictResults.length > 0) {
        return strictResults;
      }

      if (broadQuery === strictQuery) {
        return [];
      }

      return this.queryArxiv(broadQuery);
    } catch (err) {
      logger.warn('arXiv search failed', { title: normalizedTitle, err: String(err) });
      return [];
    }
  }

  private async queryArxiv(searchQuery: string): Promise<ArxivResult[]> {
    const url = `https://export.arxiv.org/api/query?search_query=${searchQuery}&max_results=5`;
    await requestLimiter.wait();

    try {
      const response = await axios.get<string>(url, {
        timeout: 30000,
        responseType: 'text',
      });
      return this.parseAtomResponse(response.data);
    } catch (error) {
      if (shouldRetry(error)) {
        await requestLimiter.wait();
        const retryResponse = await axios.get<string>(url, {
          timeout: 30000,
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
    let entryMatch: RegExpExecArray | null;

    while ((entryMatch = entryRegex.exec(xml)) !== null) {
      const entry = entryMatch[1];
      const idMatch = /<id>([\s\S]*?)<\/id>/.exec(entry);
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(entry);

      if (!idMatch) continue;
      const rawId = idMatch[1].trim();
      const arxivIdMatch = /arxiv\.org\/abs\/([^\s]+)/i.exec(rawId);
      if (!arxivIdMatch) continue;

      const arxivId = arxivIdMatch[1].replace(/v\d+$/, '');
      const entryTitle = titleMatch
        ? titleMatch[1].trim().replace(/\s+/g, ' ')
        : '';

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
  return title.replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeAxiosError = error as { code?: string; response?: { status?: number } };
  return maybeAxiosError.code === 'ECONNABORTED' || maybeAxiosError.response?.status === 429;
}

/** @deprecated Use ArxivResolver */
export const ArxivRetriever = ArxivResolver;
