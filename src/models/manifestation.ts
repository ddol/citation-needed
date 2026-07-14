export type ManifestationKind = 'pdf' | 'markdown-extracted';

/**
 * A concrete file representing a citation. Manifestations are the source of
 * truth for file locations; the legacy citations.pdf_path column is a
 * transition fallback only.
 */
export interface Manifestation {
  id: number;
  citationId: number;
  kind: ManifestationKind;
  path: string;
  contentHash?: string;
  extractorName?: string;
  extractorVersion?: string;
  createdAt: string;
  lastSeenAt?: string;
}

export interface ManifestationInput {
  citationId: number;
  kind: ManifestationKind;
  path: string;
  contentHash?: string;
  extractorName?: string;
  extractorVersion?: string;
}
