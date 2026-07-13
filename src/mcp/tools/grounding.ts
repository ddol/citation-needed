import { ZodError } from 'zod';
import type { Database } from '../../db/index';
import {
  ReadContentArgs,
  SearchCitationsArgs,
  VerifyQuoteArgs,
  toInputSchema,
} from '../../services/contracts';
import { SearchService } from '../../services/search';
import { ContentService } from '../../services/content';
import { VerifyQuoteService } from '../../services/verify-quote';
import { formatZodError } from './citations';

export const groundingToolDefinitions = [
  {
    name: 'search-citations',
    description:
      'Search the local corpus by title, author, journal, BibTeX key, or DOI. Returns trimmed summaries with matched fields and a pagination cursor; use get-citation for full details.',
    inputSchema: toInputSchema(SearchCitationsArgs),
  },
  {
    name: 'read-content',
    description: "Read a paper's extracted Markdown by DOI, paginated by character offset.",
    inputSchema: toInputSchema(ReadContentArgs),
  },
  {
    name: 'verify-quote',
    description:
      'Check whether a quoted passage appears in the corpus (or one paper, when doi is given). Matching is exact after normalization: whitespace, line-break hyphenation, unicode quotes/ligatures, and case are folded.',
    inputSchema: toInputSchema(VerifyQuoteArgs),
  },
];

function noMarkdownMessage(doi: string): string {
  return `No extracted Markdown for ${doi} — run the import pipeline (import-bibtex CLI) to download and extract it.`;
}

export async function handleGroundingTool(
  name: string,
  args: Record<string, unknown>,
  db: Database
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  try {
    switch (name) {
      case 'search-citations': {
        const request = SearchCitationsArgs.parse(args);
        const response = new SearchService(db).search(request);
        return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
      }

      case 'read-content': {
        const request = ReadContentArgs.parse(args);
        const result = new ContentService(db).read(request);
        if (result.status === 'unknown-doi') {
          return {
            content: [{ type: 'text', text: `Citation not found for DOI: ${request.doi}` }],
          };
        }
        if (result.status === 'no-markdown') {
          return { content: [{ type: 'text', text: noMarkdownMessage(request.doi) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.response, null, 2) }] };
      }

      case 'verify-quote': {
        const request = VerifyQuoteArgs.parse(args);
        const result = new VerifyQuoteService(db).verify(request);
        if (result.status === 'quote-too-short') {
          return {
            content: [
              {
                type: 'text',
                text: 'Quote too short to verify — provide at least 10 significant characters.',
              },
            ],
            isError: true,
          };
        }
        if (result.status === 'unknown-doi') {
          return {
            content: [{ type: 'text', text: `Citation not found for DOI: ${request.doi}` }],
          };
        }
        if (result.status === 'no-markdown') {
          return { content: [{ type: 'text', text: noMarkdownMessage(request.doi ?? '') }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.response, null, 2) }] };
      }

      default:
        return null;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        content: [
          { type: 'text', text: `Invalid arguments for ${name}: ${formatZodError(error)}` },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
