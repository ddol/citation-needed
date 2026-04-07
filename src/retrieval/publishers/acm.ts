import type { PublisherAdapter } from './index';

export class AcmAdapter implements PublisherAdapter {
  name = 'ACM';

  handles(doi: string): boolean {
    return doi.startsWith('10.1145/');
  }

  getLandingPageUrl(doi: string): string {
    return `https://dl.acm.org/doi/${doi}`;
  }

  getPdfUrl(_doi: string): string | null {
    return null;
  }
}
