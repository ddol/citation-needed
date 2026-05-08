import type { Database } from '../../db/index';
import { parseBibtex } from '../../parsers/bibtex';
import { ArxivResolver } from '../../retrieval/resolvers/arxiv';

export const citationToolDefinitions = [
  {
    name: 'get-citation',
    description: 'Get citation details by DOI',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'The DOI of the citation' },
      },
      required: ['doi'],
    },
  },
  {
    name: 'list-citations',
    description: 'List all stored citations',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'import-bibtex',
    description: 'Import citations from a BibTeX string',
    inputSchema: {
      type: 'object',
      properties: {
        bibtex: { type: 'string', description: 'BibTeX formatted string' },
      },
      required: ['bibtex'],
    },
  },
  {
    name: 'search-arxiv',
    description: 'Search arXiv for a paper by title',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title to search for' },
      },
      required: ['title'],
    },
  },
];

export async function handleCitationTool(
  name: string,
  args: Record<string, unknown>,
  db: Database
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  switch (name) {
    case 'get-citation': {
      const doi = args['doi'] as string;
      const citation = db.getCitation(doi);
      if (!citation) {
        return { content: [{ type: 'text', text: `Citation not found for DOI: ${doi}` }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(citation, null, 2) }] };
    }

    case 'list-citations': {
      const citations = db.getAllCitations();
      return { content: [{ type: 'text', text: JSON.stringify(citations, null, 2) }] };
    }

    case 'import-bibtex': {
      const bibtex = args['bibtex'] as string;
      const parsed = parseBibtex(bibtex);
      const imported: string[] = [];
      for (const entry of parsed) {
        if (entry.doi) {
          db.addCitation({ ...entry, doi: entry.doi });
          imported.push(entry.doi);
        }
      }
      return {
        content: [{ type: 'text', text: `Imported ${imported.length} citations: ${imported.join(', ')}` }],
      };
    }

    case 'search-arxiv': {
      const title = args['title'] as string;
      const arxiv = new ArxivResolver();
      const results = await arxiv.searchByTitle(title);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    default:
      return null;
  }
}
