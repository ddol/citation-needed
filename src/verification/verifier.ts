import type { TrustScorer } from '../scoring/scorer';
import { extractPdfText } from './extractor';
import { createLogger } from '../utils/logger';

const logger = createLogger('claim-verifier');

export interface VerificationResult {
  verified: boolean;
  confidence: number;      // 0-1
  matchedKeywords: string[];
  totalKeywords: number;
  notes: string;
  pdfAvailable: boolean;
}

export class ClaimVerifier {
  constructor(private scorer: TrustScorer) {}

  async verify(
    doi: string,
    claim: string,
    pdfPath?: string
  ): Promise<VerificationResult> {
    if (!pdfPath) {
      return {
        verified: false,
        confidence: 0,
        matchedKeywords: [],
        totalKeywords: 0,
        notes: 'No PDF available for verification',
        pdfAvailable: false,
      };
    }

    let pdfText: string;
    try {
      pdfText = await extractPdfText(pdfPath);
    } catch (err) {
      logger.warn('PDF text extraction failed', { pdfPath, err: String(err) });
      return {
        verified: false,
        confidence: 0,
        matchedKeywords: [],
        totalKeywords: 0,
        notes: `PDF extraction failed: ${String(err)}`,
        pdfAvailable: true,
      };
    }

    const keywords = this.extractKeywords(claim);
    const { matched, ratio } = this.calculateMatch(keywords, pdfText);

    const verified = ratio >= 0.7;
    const notes = `${Math.round(ratio * 100)}% keyword match (${matched.length}/${keywords.length})`;

    logger.debug('Claim verification', { doi, verified, ratio });

    return {
      verified,
      confidence: ratio,
      matchedKeywords: matched,
      totalKeywords: keywords.length,
      notes,
      pdfAvailable: true,
    };
  }

  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .filter((w) => /^[a-z]+$/.test(w));
  }

  private calculateMatch(
    claimWords: string[],
    pdfText: string
  ): { matched: string[]; ratio: number } {
    const lower = pdfText.toLowerCase();
    const matched = claimWords.filter((w) => lower.includes(w));
    const ratio = claimWords.length > 0 ? matched.length / claimWords.length : 0;
    return { matched, ratio };
  }
}
