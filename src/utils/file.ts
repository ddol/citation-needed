import fs from 'fs';
import path from 'path';
import os from 'os';

export function getDataDir(): string {
  return process.env.SOBER_SOURCES_DIR || path.join(os.homedir(), '.sober-sources');
}

export function getPdfDir(): string {
  return process.env.SOBER_SOURCES_PDF_DIR || path.join(getDataDir(), 'pdfs');
}

export function getDbPath(): string {
  return process.env.SOBER_SOURCES_DB || path.join(getDataDir(), 'citations.db');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
