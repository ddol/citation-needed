import fs from 'fs';
import path from 'path';
import type { Citation } from '../models/citation';
import { getCitationFileStem, sanitizeFilename } from '../utils/file';

/**
 * Locate the extracted Markdown file for a citation.
 *
 * The import pipeline writes Markdown as a sibling of the PDF directory
 * (`…/papers/pdf/<stem>.pdf` → `…/papers/markdown/<stem>.md`), so the stored
 * PDF path anchors the lookup. Tries the current stem naming first, then the
 * legacy DOI-based filename (mirroring OpenAccessDownloader.getLocalPath).
 * Returns null when the citation has no PDF path or no Markdown file exists.
 *
 * This is the single chokepoint for content resolution — it switches to a
 * manifestations-table lookup in core slice 2.
 */
export function resolveMarkdownPath(citation: Citation): string | null {
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
