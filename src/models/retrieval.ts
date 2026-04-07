export interface RetrievalAttempt {
  id?: number;
  citationId: number;
  source: string; // 'arxiv' | 'unpaywall' | 'doi-resolver' | 'playwright' | 'direct'
  url?: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  createdAt?: string;
}

export interface RetrievalResult {
  success: boolean;
  pdfUrl?: string;
  localPath?: string;
  source: string;
  message: string;
}
