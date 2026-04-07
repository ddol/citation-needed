import type { Database } from '../../db/index';
import { TrustScorer } from '../../scoring/scorer';

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
      const pdfContent = args['pdfContent'] as string | undefined;
      const result = await scorer.verifyAndScore(doi, claim, pdfContent);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    case 'update-trust-score': {
      const doi = args['doi'] as string;
      const score = args['score'] as number;
      const notes = args['notes'] as string | undefined;
      const agentId = args['agentId'] as string | undefined;
      db.updateTrustScore(doi, score, notes, agentId);
      return {
        content: [{ type: 'text', text: `Updated trust score for ${doi} to ${score}` }],
      };
    }

    default:
      return null;
  }
}
