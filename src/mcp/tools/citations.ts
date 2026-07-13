import { z, ZodError } from 'zod';
import type { Database } from '../../db/index';
import { parseBibtex } from '../../parsers/bibtex';
import { isValidDoi, normalizeDoi } from '../../parsers/doi';
import { ArxivResolver } from '../../retrieval/resolvers/arxiv';

const GetCitationArgs = z.object({
  doi: z.string().min(1, 'doi is required'),
});

const ListCitationsArgs = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ImportBibtexArgs = z.object({
  bibtex: z.string().min(1, 'bibtex is required'),
});

const SearchArxivArgs = z.object({
  title: z.string().min(1, 'title is required'),
});

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
    description:
      'List stored citations with cursor pagination. Pass nextCursor from a prior response to fetch the next page.',
    inputSchema: {
      type: 'object',
      properties: {
        cursor: {
          type: 'string',
          description: 'Opaque cursor from a previous list-citations response',
        },
        limit: {
          type: 'number',
          description: 'Page size (1–200, default 50)',
        },
      },
    },
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

export interface ToolContext {
  progressToken?: string | number;
  sendProgress?: (notification: {
    progress: number;
    total?: number;
    message?: string;
  }) => Promise<void> | void;
}

export async function handleCitationTool(
  name: string,
  args: Record<string, unknown>,
  db: Database,
  context: ToolContext = {}
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  try {
    switch (name) {
      case 'get-citation': {
        const { doi } = GetCitationArgs.parse(args);
        const citation = db.getCitation(doi);
        if (!citation) {
          return { content: [{ type: 'text', text: `Citation not found for DOI: ${doi}` }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(citation, null, 2) }] };
      }

      case 'list-citations': {
        const { cursor, limit } = ListCitationsArgs.parse(args);
        if (cursor === undefined && limit === undefined) {
          // Back-compat: callers without pagination args get the legacy
          // "all citations" array directly.
          const citations = db.getAllCitations();
          return { content: [{ type: 'text', text: JSON.stringify(citations, null, 2) }] };
        }
        const page = db.getAllCitations({ cursor, limit });
        return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
      }

      case 'import-bibtex': {
        const { bibtex } = ImportBibtexArgs.parse(args);
        const parsed = parseBibtex(bibtex);
        const imported: string[] = [];
        const skipped: string[] = [];
        const total = parsed.length;
        for (let i = 0; i < parsed.length; i += 1) {
          const entry = parsed[i];
          // Normalize and validate the DOI before it reaches the database — the
          // same guard the BibTeX workflow applies. Entries with a missing or
          // malformed DOI are skipped rather than inserted.
          const normalizedDoi = entry.doi ? normalizeDoi(entry.doi) : '';
          const accepted = normalizedDoi !== '' && isValidDoi(normalizedDoi);
          // parseBibtex yields '' (not undefined) for a missing key/DOI, so use
          // `||` — `??` would stop at the empty string and produce blank labels.
          const label = entry.bibtexKey || entry.doi || '(no DOI)';

          if (accepted) {
            db.addCitation({ ...entry, doi: normalizedDoi });
            imported.push(normalizedDoi);
          } else {
            skipped.push(label);
          }

          if (context.sendProgress) {
            await context.sendProgress({
              progress: i + 1,
              total,
              message: accepted ? `imported ${normalizedDoi}` : `skipped ${label}`,
            });
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: `Imported ${imported.length} citations${
                imported.length ? `: ${imported.join(', ')}` : ''
              }${
                skipped.length
                  ? `. Skipped ${skipped.length} (missing or invalid DOI): ${skipped.join(', ')}`
                  : ''
              }`,
            },
          ],
        };
      }

      case 'search-arxiv': {
        const { title } = SearchArxivArgs.parse(args);
        const arxiv = new ArxivResolver();
        const result = await arxiv.searchByTitle(title);
        if (!result.ok) {
          return {
            content: [{ type: 'text', text: `arXiv search failed: ${result.error}` }],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.value, null, 2) }] };
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

export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
