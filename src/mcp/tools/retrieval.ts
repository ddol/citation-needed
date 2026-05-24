import { z, ZodError } from 'zod';
import type { Database } from '../../db/index';
import type { AuthConfig } from '../../models/auth';
import { UnpaywallResolver } from '../../retrieval/resolvers/unpaywall';
import { OpenAccessDownloader } from '../../retrieval/downloaders/open-access';

const DownloadPdfArgs = z.object({
  doi: z.string().min(1, 'doi is required'),
  pdfUrl: z.string().url().optional(),
  useUnpaywall: z.boolean().optional(),
  email: z.string().email().optional(),
});

export const retrievalToolDefinitions = [
  {
    name: 'download-pdf',
    description: 'Trigger PDF download for a citation (tries open-access first)',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI of the citation' },
        pdfUrl: { type: 'string', description: 'Direct URL to the PDF (optional)' },
        useUnpaywall: { type: 'boolean', description: 'Try Unpaywall to find OA version' },
        email: { type: 'string', description: 'Email for Unpaywall API' },
      },
      required: ['doi'],
    },
  },
];

export async function handleRetrievalTool(
  name: string,
  args: Record<string, unknown>,
  db: Database,
  authConfig: AuthConfig = {}
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  try {
    switch (name) {
      case 'download-pdf': {
        const parsed = DownloadPdfArgs.parse(args);
        const email = parsed.email || authConfig.email;

        const downloader = new OpenAccessDownloader({ email });
        let resolvedUrl = parsed.pdfUrl;

        if (!resolvedUrl && parsed.useUnpaywall && email) {
          const unpaywall = new UnpaywallResolver(email);
          const lookup = await unpaywall.getOpenAccessPdf(parsed.doi);
          if (!lookup.ok) {
            return {
              content: [{ type: 'text', text: `Unpaywall lookup failed: ${lookup.error}` }],
              isError: true,
            };
          }
          resolvedUrl = lookup.value || undefined;
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

        const localPath = await downloader.download(parsed.doi, resolvedUrl);

        const citation = db.getCitation(parsed.doi);
        if (!citation) {
          return {
            content: [
              {
                type: 'text',
                text: `PDF saved to: ${localPath}, but DOI ${parsed.doi} not found in database. Import the citation first to track it.`,
              },
            ],
            isError: true,
          };
        }

        db.transaction(() => {
          db.updatePdfPath(parsed.doi, localPath);
          db.updateVerificationStatus(parsed.doi, 'downloaded');
        });
        return { content: [{ type: 'text', text: `PDF saved to: ${localPath}` }] };
      }

      default:
        return null;
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid arguments for ${name}: ${error.issues
              .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
              .join('; ')}`,
          },
        ],
        isError: true,
      };
    }
    throw error;
  }
}
