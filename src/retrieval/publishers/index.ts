import { SpringerAdapter } from './springer';
import { ElsevierAdapter } from './elsevier';
import { AcmAdapter } from './acm';

export interface PublisherAdapter {
  name: string;
  handles(doi: string): boolean;
  getLandingPageUrl(doi: string): string;
  getPdfUrl?(doi: string): string | null;
}

export const publishers: PublisherAdapter[] = [
  new SpringerAdapter(),
  new ElsevierAdapter(),
  new AcmAdapter(),
];

export function getAdapter(doi: string): PublisherAdapter | null {
  return publishers.find((p) => p.handles(doi)) ?? null;
}

export { SpringerAdapter } from './springer';
export { ElsevierAdapter } from './elsevier';
export { AcmAdapter } from './acm';
