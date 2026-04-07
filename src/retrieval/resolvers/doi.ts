import axios from 'axios';
import { createLogger } from '../../utils/logger';

const logger = createLogger('doi-resolver');

export interface DoiMetadata {
  doi: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  publisher?: string;
  url?: string;
  isOpenAccess?: boolean;
}

export class DoiResolver {
  async resolve(doi: string): Promise<DoiMetadata | null> {
    try {
      const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
      const response = await axios.get<CrossrefResponse>(url, {
        timeout: 15000,
        headers: {
          'User-Agent': `sober-sources/0.1.0 (mailto:${process.env.SOBER_SOURCES_EMAIL || 'sober-sources@example.com'})`,
        },
      });

      const work = response.data.message;
      if (!work) return null;

      const title = Array.isArray(work.title) ? work.title[0] : work.title;
      const authors = (work.author || []).map(
        (a: CrossrefAuthor) => `${a.given || ''} ${a.family || ''}`.trim()
      );
      const year =
        work['published-print']?.['date-parts']?.[0]?.[0] ||
        work['published-online']?.['date-parts']?.[0]?.[0] ||
        undefined;
      const journal =
        (Array.isArray(work['container-title']) ? work['container-title'][0] : work['container-title']) ||
        undefined;

      return {
        doi,
        title,
        authors,
        year,
        journal,
        publisher: work.publisher,
        url: work.URL,
        isOpenAccess: undefined,
      };
    } catch (err) {
      logger.warn('DOI resolve failed', { doi, err: String(err) });
      return null;
    }
  }
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefWork {
  title?: string | string[];
  author?: CrossrefAuthor[];
  'published-print'?: { 'date-parts'?: number[][] };
  'published-online'?: { 'date-parts'?: number[][] };
  'container-title'?: string | string[];
  publisher?: string;
  URL?: string;
  'is-referenced-by-count'?: number;
}

interface CrossrefResponse {
  message: CrossrefWork;
}
