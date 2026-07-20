import fs from 'fs';
import path from 'path';
import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import { getCitationFileStem, sanitizeFilename } from '../utils/file';

/**
 * Locate the extracted Markdown file for a citation.
 *
 * Prefer the manifestation table: imported Markdown can live anywhere via
 * --markdown-path. The PDF-sibling lookup remains only for legacy rows that
 * predate Markdown manifestations.
 */
export function resolveMarkdownPath(citation: Citation, db?: Database): string | null {
  if (db && citation.id != null) {
    const manifestation = db.getManifestation?.(citation.id, 'markdown-extracted');
    if (manifestation && fs.existsSync(manifestation.path)) return manifestation.path;
  }

  if (!citation.pdfPath) return null;

  const markdownDir = path.join(path.dirname(citation.pdfPath), '..', 'markdown');
  const candidates = new Set([
    `${getCitationFileStem({ bibtexKey: citation.bibtexKey, doi: citation.doi })}.md`,
    `${sanitizeFilename(citation.doi)}.md`,
  ]);

  for (const filename of candidates) {
    const candidate = path.join(markdownDir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
