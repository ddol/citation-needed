import type { PublisherAdapter } from './index';

export class ElsevierAdapter implements PublisherAdapter {
  name = 'Elsevier';

  handles(doi: string): boolean {
    return doi.startsWith('10.1016/');
  }

  getLandingPageUrl(doi: string): string {
    return `https://doi.org/${doi}`;
  }

  getPdfUrl(_doi: string): string | null {
    return null;
  }
}
