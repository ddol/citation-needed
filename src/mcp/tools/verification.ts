import type { Database } from '../../db/index';
import { ClaimVerifier } from '../../verification/verifier';

export const verificationToolDefinitions = [
  {
    name: 'verify-citation',
    description: 'Verify a citation against locally stored PDF markdown',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI of the citation' },
        claim: { type: 'string', description: 'The claim to verify against the PDF markdown' },
        pdfMarkdown: { type: 'string', description: 'Optional PDF markdown content for verification' },
      },
      required: ['doi', 'claim'],
    },
  },
];

export async function handleVerificationTool(
  name: string,
  args: Record<string, unknown>,
  db: Database
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  const verifier = new ClaimVerifier();

  switch (name) {
    case 'verify-citation': {
      const doi = args['doi'] as string;
      const claim = args['claim'] as string;
      const pdfMarkdown = args['pdfMarkdown'] as string | undefined;
      const citation = db.getCitation(doi);

      if (!citation) {
        return {
          content: [{ type: 'text', text: `Citation not found for DOI: ${doi}` }],
          isError: true,
        };
      }

      const result = await verifier.verify(doi, claim, {
        pdfPath: citation.pdfPath,
        pdfMarkdown,
      });
      const status = result.verified ? 'verified' : result.pdfAvailable ? 'failed' : 'unverified';
      db.updateVerificationStatus(doi, status);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return null;
  }
}
