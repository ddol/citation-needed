import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CitationFileIdentity {
  bibtexKey?: string;
  doi?: string;
  title?: string;
}

export function getDataDir(): string {
  return process.env.CITATION_NEEDED_DIR || path.join(os.homedir(), '.citation-needed');
}

export function getPdfDir(): string {
  return process.env.CITATION_NEEDED_PDF_DIR || path.join(getDataDir(), 'pdfs');
}

export function getDbPath(): string {
  return process.env.CITATION_NEEDED_DB || path.join(getDataDir(), 'citations.db');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function getCitationFileStem(identity: CitationFileIdentity): string {
  const preferredName = identity.bibtexKey?.trim() || identity.doi?.trim() || 'citation';
  return sanitizeFilename(preferredName);
}

export function getCitationDisplayName(identity: CitationFileIdentity): string {
  return identity.bibtexKey?.trim() || identity.doi?.trim() || identity.title?.trim() || 'citation';
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
