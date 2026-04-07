import type { PublisherAdapter } from './index';

export class SpringerAdapter implements PublisherAdapter {
  name = 'Springer';

  handles(doi: string): boolean {
    return doi.startsWith('10.1007/') || doi.startsWith('10.1038/');
  }

  getLandingPageUrl(doi: string): string {
    return `https://link.springer.com/article/${doi}`;
  }

  getPdfUrl(_doi: string): string | null {
    return null; // OA only via Unpaywall
  }
}
