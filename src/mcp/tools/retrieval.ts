import type { Database } from '../../db/index';
import type { AuthConfig } from '../../models/auth';
import { UnpaywallResolver } from '../../retrieval/resolvers/unpaywall';
import { OpenAccessDownloader } from '../../retrieval/downloaders/open-access';

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
  switch (name) {
    case 'download-pdf': {
      const doi = args['doi'] as string;
      const pdfUrl = args['pdfUrl'] as string | undefined;
      const useUnpaywall = args['useUnpaywall'] as boolean | undefined;
      const email = (args['email'] as string | undefined) || authConfig.email;

      const downloader = new OpenAccessDownloader();
      let resolvedUrl = pdfUrl;

      if (!resolvedUrl && useUnpaywall && email) {
        const unpaywall = new UnpaywallResolver(email);
        resolvedUrl = (await unpaywall.getOpenAccessPdf(doi)) || undefined;
      }

      if (!resolvedUrl) {
        return {
          content: [{
            type: 'text',
            text: 'No PDF URL available. Provide pdfUrl or use useUnpaywall with email.',
          }],
        };
      }

      const localPath = await downloader.download(doi, resolvedUrl);

      const citation = db.getCitation(doi);
      if (!citation) {
        return {
          content: [{
            type: 'text',
            text: `PDF saved to: ${localPath}, but DOI ${doi} not found in database. Import the citation first to track it.`,
          }],
          isError: true,
        };
      }

      db.updatePdfPath(doi, localPath);
      db.updateVerificationStatus(doi, 'downloaded');
      return { content: [{ type: 'text', text: `PDF saved to: ${localPath}` }] };
    }

    default:
      return null;
  }
}
