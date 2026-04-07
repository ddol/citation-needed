import type { Database } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('trust-scorer');

export type TrustLevel = 'high' | 'medium' | 'low' | 'unverified';

export class TrustScorer {
  constructor(private db: Database) {}

  async calculateScore(doi: string): Promise<number> {
    const citation = this.db.getCitation(doi);
    return citation?.trustScore ?? 0.5;
  }

  async updateScore(
    doi: string,
    delta: number,
    notes: string,
    agentId?: string
  ): Promise<number> {
    const current = await this.calculateScore(doi);
    const newScore = Math.min(1, Math.max(0, current + delta));
    this.db.updateTrustScore(doi, newScore, notes, agentId);
    return newScore;
  }

  async verifyAndScore(
    doi: string,
    agentClaim: string,
    pdfContent?: string
  ): Promise<{ score: number; verified: boolean; notes: string }> {
    const citation = this.db.getCitation(doi);
    if (!citation) {
      return { score: 0, verified: false, notes: `Citation not found for DOI: ${doi}` };
    }

    let verified = false;
    let notes = '';
    let delta = 0;

    if (pdfContent) {
      const claimWords = agentClaim
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);

      const matchCount = claimWords.filter((word) =>
        pdfContent.toLowerCase().includes(word)
      ).length;

      const matchRatio = claimWords.length > 0 ? matchCount / claimWords.length : 0;

      if (matchRatio >= 0.7) {
        verified = true;
        delta = 0.1;
        notes = `Claim verified: ${Math.round(matchRatio * 100)}% keyword match in PDF`;
      } else if (matchRatio >= 0.4) {
        verified = false;
        delta = 0;
        notes = `Partial match: ${Math.round(matchRatio * 100)}% keyword match in PDF`;
      } else {
        verified = false;
        delta = -0.05;
        notes = `Low match: ${Math.round(matchRatio * 100)}% keyword match in PDF`;
      }
    } else {
      const titleMatch =
        citation.title &&
        agentClaim.toLowerCase().includes(citation.title.toLowerCase().slice(0, 20));

      if (titleMatch) {
        verified = true;
        delta = 0.05;
        notes = 'Title match in agent claim (no PDF available)';
      } else {
        notes = 'No PDF available for verification';
      }
    }

    const newScore = await this.updateScore(doi, delta, notes, 'verifyAndScore');
    this.db.updateVerificationStatus(doi, verified ? 'verified' : 'failed');

    logger.debug('Score updated', { doi, newScore, verified });
    return { score: newScore, verified, notes };
  }

  getTrustLevel(score: number): TrustLevel {
    if (score >= 0.7) return 'high';
    if (score >= 0.4) return 'medium';
    if (score > 0) return 'low';
    return 'unverified';
  }
}
