import axios from 'axios';
import { createLogger } from '../../utils/logger';
import { VERSION } from '../../utils/version';
import type { ResolverResult } from '../../models/retrieval';
import { DEFAULT_CONTACT_EMAIL, RESOLVER_TIMEOUT_MS } from '../config';

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
  constructor(private email: string = process.env.CITATION_NEEDED_EMAIL || DEFAULT_CONTACT_EMAIL) {}

  async resolve(doi: string): Promise<ResolverResult<DoiMetadata | null>> {
    try {
      const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
      const response = await axios.get<CrossrefResponse>(url, {
        timeout: RESOLVER_TIMEOUT_MS,
        headers: {
          'User-Agent': `citation-needed/${VERSION} (mailto:${this.email})`,
        },
      });

      const work = response.data.message;
      if (!work) return { ok: true, value: null };

      const title = Array.isArray(work.title) ? work.title[0] : work.title;
      const authors = (work.author || []).map((a: CrossrefAuthor) =>
        `${a.given || ''} ${a.family || ''}`.trim()
      );
      const year =
        work['published-print']?.['date-parts']?.[0]?.[0] ||
        work['published-online']?.['date-parts']?.[0]?.[0] ||
        undefined;
      const journal =
        (Array.isArray(work['container-title'])
          ? work['container-title'][0]
          : work['container-title']) || undefined;

      return {
        ok: true,
        value: {
          doi,
          title,
          authors,
          year,
          journal,
          publisher: work.publisher,
          url: work.URL,
          isOpenAccess: undefined,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('DOI resolve failed', { doi, err: message });
      return { ok: false, error: `Crossref lookup failed: ${message}` };
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
