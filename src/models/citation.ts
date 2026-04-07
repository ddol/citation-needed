export interface Citation {
  id?: number;
  doi: string;
  url?: string;
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
  bibtexKey?: string;
  pdfPath?: string;
  trustScore?: number;
  verificationStatus?: 'unverified' | 'downloaded' | 'verified' | 'failed' | 'not-found';
  accessType?: 'open-access' | 'institutional' | 'unknown';
  lastVerified?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrustEvent {
  id?: number;
  citationId: number;
  eventType: string;
  scoreDelta: number;
  notes?: string;
  agentId?: string;
  createdAt?: string;
}

export type TrustLevel = 'high' | 'medium' | 'low' | 'unverified';
