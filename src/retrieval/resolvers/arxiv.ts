import axios from 'axios';
import { createLogger } from '../../utils/logger';

const logger = createLogger('arxiv-resolver');

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
    const url = `http://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent(title)}&max_results=5`;

    try {
      const response = await axios.get<string>(url, {
        timeout: 15000,
        responseType: 'text',
      });
      return this.parseAtomResponse(response.data);
    } catch (err) {
      logger.warn('arXiv search failed', { title, err: String(err) });
      return [];
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

/** @deprecated Use ArxivResolver */
export const ArxivRetriever = ArxivResolver;
