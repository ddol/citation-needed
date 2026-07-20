import fs from 'fs';
import path from 'path';
import type { Citation } from '../models/citation';
import type { Database } from '../db/index';
import { getCitationFileStem, sanitizeFilename } from '../utils/file';
import { sha256String } from '../utils/hash';

/**
 * Locate the extracted Markdown file for a citation.
 *
 * Manifestations are the source of truth: `--markdown-path` puts extracted
 * Markdown anywhere the user likes, so guessing at a path next to the PDF is
 * wrong for every import that used the flag. The PDF-sibling stem lookup is a
 * fallback for rows written before Markdown manifestations existed, and a hit
 * there heals the gap by recording the manifestation it should have had.
 *
 * The manifestation path is existence-checked rather than trusted. A row whose
 * file has been moved or deleted must not shadow a copy the fallback can still
 * find, and it must not hand callers a path that fails on read.
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
    if (fs.existsSync(candidate)) {
      healManifestation(citation, candidate, db);
      return candidate;
    }
  }
  return null;
}

/**
 * Record a manifestation for Markdown only the stem fallback could find, so the
 * next lookup takes the manifestation path and the file becomes visible to
 * everything else keyed on manifestations (indexing, quality scoring).
 *
 * No extractor name or version: we did not extract this file and will not claim
 * a provenance we cannot verify. The content hash is real, so a re-extraction
 * can still tell whether the bytes changed. Healing is best effort by design,
 * since a read-only or legacy database must not turn a successful lookup into a
 * failure.
 */
function healManifestation(citation: Citation, markdownPath: string, db?: Database): void {
  if (!db || citation.id == null || typeof db.upsertManifestation !== 'function') return;
  try {
    db.upsertManifestation({
      citationId: citation.id,
      kind: 'markdown-extracted',
      path: markdownPath,
      contentHash: sha256String(fs.readFileSync(markdownPath, 'utf-8')),
    });
  } catch {
    // Self-healing is an optimisation, never a precondition for reading.
  }
}
