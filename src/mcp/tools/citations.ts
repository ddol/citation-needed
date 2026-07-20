import { z, ZodError } from 'zod';
import type { Database } from '../../db/index';
import { parseBibtex } from '../../parsers/bibtex';
import { ArxivResolver } from '../../retrieval/resolvers/arxiv';
import { ImportService, toImportReport } from '../../services/import';

/** Progress total: how many entries the import will visit, before it starts. */
function countBibtexEntries(bibtex: string): number {
  return parseBibtex(bibtex).length;
}

const GetCitationArgs = z.object({
  doi: z.string().min(1, 'doi is required'),
});

const ListCitationsArgs = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const ImportBibtexArgs = z.object({
  bibtex: z.string().min(1, 'bibtex is required'),
  paperPath: z.string().optional(),
  markdownPath: z.string().optional(),
  metadataOnly: z.boolean().optional(),
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
    description:
      'Import citations from a BibTeX string. Runs the full pipeline by default: ' +
      'stores metadata, downloads open-access PDFs, and extracts Markdown for grounding. ' +
      'Set metadataOnly to store metadata without fetching anything.',
    inputSchema: {
      type: 'object',
      properties: {
        bibtex: { type: 'string', description: 'BibTeX formatted string' },
        paperPath: { type: 'string', description: 'Directory for downloaded PDFs' },
        markdownPath: { type: 'string', description: 'Directory for extracted Markdown' },
        metadataOnly: {
          type: 'boolean',
          description: 'Store citation metadata only, skipping downloads and extraction',
        },
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
        const parsedArgs = ImportBibtexArgs.parse(args);
        // One pipeline, shared with the CLI: an agent that imports a .bib gets
        // the PDFs and extracted Markdown that make the corpus groundable, not
        // metadata rows it then has to fetch a second way.
        const total = countBibtexEntries(parsedArgs.bibtex);
        let done = 0;
        const summary = await new ImportService(db).import({
          source: { bibtex: parsedArgs.bibtex },
          paperPath: parsedArgs.paperPath,
          markdownPath: parsedArgs.markdownPath,
          metadataOnly: parsedArgs.metadataOnly,
          onProgress: (progress) => {
            if (!context.sendProgress) return;
            // `settled`, not a terminal-looking stage: the retry banner also
            // reads as 'skipped', and a retried entry reaches a terminal stage
            // twice. Counting either would push `progress` past `total`.
            if (!progress.settled) return;
            done += 1;
            // Fire and forget: a slow or broken progress channel must not stall
            // the import, and the tool result carries the real outcome.
            Promise.resolve(
              context.sendProgress({
                progress: done,
                total,
                message: `${progress.label}: ${progress.message ?? progress.stage}`,
              })
            ).catch(() => undefined);
          },
        });

        return {
          content: [{ type: 'text', text: JSON.stringify(toImportReport(summary), null, 2) }],
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
