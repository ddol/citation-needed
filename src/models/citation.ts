export type VerificationStatus = 'unverified' | 'downloaded' | 'verified' | 'failed' | 'not-found';
export type AccessType = 'open-access' | 'institutional' | 'unknown';

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
  verificationStatus?: VerificationStatus;
  accessType?: AccessType;
  lastVerified?: string;
  createdAt?: string;
  updatedAt?: string;
}
