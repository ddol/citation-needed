import { extractPdfMarkdown } from './markdown';
import { createLogger } from '../utils/logger';

const logger = createLogger('claim-verifier');

export interface VerificationResult {
  verified: boolean;
  matchedKeywords: string[];
  totalKeywords: number;
  notes: string;
  pdfAvailable: boolean;
}

export interface VerifyOptions {
  pdfPath?: string;
  pdfMarkdown?: string;
}

export class ClaimVerifier {
  async verify(
    doi: string,
    claim: string,
    options: VerifyOptions = {}
  ): Promise<VerificationResult> {
    const { pdfPath, pdfMarkdown } = options;

    if (!pdfPath && !pdfMarkdown) {
      return {
        verified: false,
        matchedKeywords: [],
        totalKeywords: 0,
        notes: 'No PDF available for verification',
        pdfAvailable: false,
      };
    }

    let markdown = pdfMarkdown;
    if (!markdown && pdfPath) {
      try {
        markdown = await extractPdfMarkdown(pdfPath);
      } catch (err) {
        logger.warn('PDF markdown extraction failed', { pdfPath, err: String(err) });
        return {
          verified: false,
          matchedKeywords: [],
          totalKeywords: 0,
          notes: `PDF extraction failed: ${String(err)}`,
          pdfAvailable: true,
        };
      }
    }

    const keywords = this.extractKeywords(claim);
    if (keywords.length === 0) {
      return {
        verified: false,
        matchedKeywords: [],
        totalKeywords: 0,
        notes: 'No claim keywords available for verification',
        pdfAvailable: true,
      };
    }

    const matchedKeywords = this.findMatchedKeywords(keywords, markdown || '');
    const matchRatio = matchedKeywords.length / keywords.length;
    const verified = matchRatio >= 0.7;
    const notes = `${Math.round(matchRatio * 100)}% keyword match (${matchedKeywords.length}/${keywords.length})`;

    logger.debug('Claim verification', { doi, verified, matchedKeywords: matchedKeywords.length, totalKeywords: keywords.length });

    return {
      verified,
      matchedKeywords,
      totalKeywords: keywords.length,
      notes,
      pdfAvailable: true,
    };
  }

  private extractKeywords(text: string): string[] {
    return Array.from(
      new Set(
        text
          .toLowerCase()
          .split(/\s+/)
          .filter((word) => word.length > 4)
          .filter((word) => /^[a-z]+$/.test(word))
      )
    );
  }

  private findMatchedKeywords(claimWords: string[], markdown: string): string[] {
    const normalizedMarkdown = markdown
      .toLowerCase()
      .replace(/[`*_>#\[\]()|~-]/g, ' ')
      .replace(/\s+/g, ' ');

    return claimWords.filter((word) => normalizedMarkdown.includes(word));
  }
}
