import type { Database } from '../../db/index';
import { TrustScorer } from '../../scoring/scorer';
import { extractPdfText } from '../../verification/extractor';

export const verificationToolDefinitions = [
  {
    name: 'verify-citation',
    description: 'Verify a citation against locally stored PDF',
    inputSchema: {
      type: 'object',
      properties: {
        doi: { type: 'string', description: 'DOI of the citation' },
        claim: { type: 'string', description: 'The claim to verify against the PDF' },
        pdfContent: { type: 'string', description: 'Optional PDF text content for verification' },
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
        score: { type: 'number', description: 'New absolute trust score (0-1)' },
        notes: { type: 'string', description: 'Reason for score update' },
        agentId: { type: 'string', description: 'Identifier of the agent making the update' },
      },
      required: ['doi', 'score'],
    },
  },
];

export async function handleVerificationTool(
  name: string,
  args: Record<string, unknown>,
  db: Database
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean } | null> {
  const scorer = new TrustScorer(db);

  switch (name) {
    case 'verify-citation': {
      const doi = args['doi'] as string;
      const claim = args['claim'] as string;
      let pdfContent = args['pdfContent'] as string | undefined;

      // Auto-read locally stored PDF when pdfContent is not provided
      if (!pdfContent) {
        const citation = db.getCitation(doi);
        if (citation?.pdfPath) {
          try {
            pdfContent = await extractPdfText(citation.pdfPath);
          } catch {
            // Fall through to title-based heuristic
          }
        }
      }

      const result = await scorer.verifyAndScore(doi, claim, pdfContent);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'update-trust-score': {
      const doi = args['doi'] as string;
      const score = args['score'] as number;
      const notes = args['notes'] as string | undefined;
      const agentId = args['agentId'] as string | undefined;

      const citation = db.getCitation(doi);
      if (!citation) {
        return {
          content: [{ type: 'text', text: `Citation not found for DOI: ${doi}` }],
          isError: true,
        };
      }

      db.updateTrustScore(doi, score, notes, agentId);
      return {
        content: [{ type: 'text', text: `Updated trust score for ${doi} to ${score}` }],
      };
    }

    default:
      return null;
  }
}
