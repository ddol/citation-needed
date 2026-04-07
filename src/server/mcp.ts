import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDatabase } from '../db/index';
import { parseBibtex } from '../bibtex/parser';
import { TrustScorer } from '../trust/scorer';
import { ArxivRetriever } from '../retrieval/arxiv';
import { PdfDownloader } from '../retrieval/downloader';
import { UnpaywallRetriever } from '../retrieval/unpaywall';

export function createMcpServer(): Server {
  const server = new Server(
    { name: 'sober-sources', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get-citation',
        description: 'Get citation details and trust score by DOI',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string', description: 'The DOI of the citation' },
          },
          required: ['doi'],
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
        name: 'verify-citation',
        description: 'Verify a citation against locally stored PDF',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string', description: 'DOI of the citation' },
            claim: {
              type: 'string',
              description: 'The claim to verify against the PDF',
            },
            pdfContent: {
              type: 'string',
              description: 'Optional PDF text content for verification',
            },
          },
          required: ['doi', 'claim'],
        },
      },
      {
        name: 'update-trust-score',
        description: 'Update trust score with feedback',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string', description: 'DOI of the citation' },
            score: {
              type: 'number',
              description: 'New absolute trust score (0-1)',
            },
            notes: { type: 'string', description: 'Reason for score update' },
            agentId: {
              type: 'string',
              description: 'Identifier of the agent making the update',
            },
          },
          required: ['doi', 'score'],
        },
      },
      {
        name: 'download-pdf',
        description: 'Trigger PDF download for a citation',
        inputSchema: {
          type: 'object',
          properties: {
            doi: { type: 'string', description: 'DOI of the citation' },
            pdfUrl: {
              type: 'string',
              description: 'Direct URL to the PDF (optional)',
            },
            useUnpaywall: {
              type: 'boolean',
              description: 'Try Unpaywall to find OA version',
            },
            email: {
              type: 'string',
              description: 'Email for Unpaywall API (required if useUnpaywall)',
            },
          },
          required: ['doi'],
        },
      },
      {
        name: 'list-citations',
        description: 'List all citations with trust scores',
        inputSchema: {
          type: 'object',
          properties: {},
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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const db = getDatabase();
    const scorer = new TrustScorer(db);

    try {
      switch (name) {
        case 'get-citation': {
          const doi = (args as { doi: string }).doi;
          const citation = db.getCitation(doi);
          if (!citation) {
            return {
              content: [
                { type: 'text', text: `Citation not found for DOI: ${doi}` },
              ],
            };
          }
          const trustLevel = scorer.getTrustLevel(citation.trustScore ?? 0.5);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...citation, trustLevel }, null, 2),
              },
            ],
          };
        }

        case 'import-bibtex': {
          const bibtex = (args as { bibtex: string }).bibtex;
          const parsed = parseBibtex(bibtex);
          const imported: string[] = [];
          for (const entry of parsed) {
            if (entry.doi || entry.title) {
              db.addCitation(entry);
              imported.push(entry.doi || entry.title || 'unknown');
            }
          }
          return {
            content: [
              {
                type: 'text',
                text: `Imported ${imported.length} citations: ${imported.join(', ')}`,
              },
            ],
          };
        }

        case 'verify-citation': {
          const { doi, claim, pdfContent } = args as {
            doi: string;
            claim: string;
            pdfContent?: string;
          };
          const result = await scorer.verifyAndScore(doi, claim, pdfContent);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'update-trust-score': {
          const { doi, score, notes, agentId } = args as {
            doi: string;
            score: number;
            notes?: string;
            agentId?: string;
          };
          db.updateTrustScore(doi, score, notes, agentId);
          return {
            content: [
              {
                type: 'text',
                text: `Updated trust score for ${doi} to ${score}`,
              },
            ],
          };
        }

        case 'download-pdf': {
          const { doi, pdfUrl, useUnpaywall, email } = args as {
            doi: string;
            pdfUrl?: string;
            useUnpaywall?: boolean;
            email?: string;
          };
          const downloader = new PdfDownloader(db);
          let resolvedUrl = pdfUrl;

          if (!resolvedUrl && useUnpaywall && email) {
            const unpaywall = new UnpaywallRetriever(email);
            resolvedUrl = (await unpaywall.getOpenAccessPdf(doi)) || undefined;
          }

          if (!resolvedUrl) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No PDF URL available. Provide pdfUrl or use useUnpaywall with email.',
                },
              ],
            };
          }

          const localPath = await downloader.downloadOpenAccess(doi, resolvedUrl);
          return {
            content: [{ type: 'text', text: `PDF saved to: ${localPath}` }],
          };
        }

        case 'list-citations': {
          const citations = db.getAllCitations();
          const withLevels = citations.map((c) => ({
            ...c,
            trustLevel: scorer.getTrustLevel(c.trustScore ?? 0.5),
          }));
          return {
            content: [
              { type: 'text', text: JSON.stringify(withLevels, null, 2) },
            ],
          };
        }

        case 'search-arxiv': {
          const { title } = args as { title: string };
          const arxiv = new ArxivRetriever();
          const results = await arxiv.searchByTitle(title);
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
