import fs from 'fs';
import type { Database } from '../db/index';
import { sha256File, sha256String } from '../utils/hash';
import { CHUNKER_VERSION, chunkMarkdown } from './chunker';
import { resolveMarkdownPath } from './markdown-locator';

export interface IndexSummary {
  scanned: number;
  indexed: number;
  unchanged: number;
  missingMarkdown: number;
  errors: Array<{ doi: string; message: string }>;
}

/**
 * One-shot corpus (re)indexer — the bridge until a job pipeline exists.
 *
 * For every citation: backfill manifestations from files on disk (with
 * content hashes), then chunk the extracted Markdown into the FTS index.
 * Idempotent: a manifestation whose source hash and chunker version are
 * unchanged is skipped; a CHUNKER_VERSION bump eagerly re-chunks everything.
 */
export class IndexService {
  constructor(private readonly db: Database) {}

  async indexCorpus(): Promise<IndexSummary> {
    const summary: IndexSummary = {
      scanned: 0,
      indexed: 0,
      unchanged: 0,
      missingMarkdown: 0,
      errors: [],
    };

    for (const citation of this.db.getAllCitations()) {
      summary.scanned += 1;
      if (citation.id == null) continue;

      try {
        if (citation.pdfPath && fs.existsSync(citation.pdfPath)) {
          this.db.upsertManifestation({
            citationId: citation.id,
            kind: 'pdf',
            path: citation.pdfPath,
            // eslint-disable-next-line no-await-in-loop
            contentHash: await sha256File(citation.pdfPath),
          });
        }

        const markdownPath = resolveMarkdownPath(citation);
        if (!markdownPath) {
          summary.missingMarkdown += 1;
          continue;
        }

        const markdown = fs.readFileSync(markdownPath, 'utf-8');
        const contentHash = sha256String(markdown);
        const manifestationId = this.db.upsertManifestation({
          citationId: citation.id,
          kind: 'markdown-extracted',
          path: markdownPath,
          contentHash,
        });

        const state = this.db.getChunkIndexState(manifestationId);
        if (
          state &&
          state.contentHash === contentHash &&
          state.chunkerVersion === CHUNKER_VERSION
        ) {
          summary.unchanged += 1;
          continue;
        }

        this.db.replaceChunks({
          manifestationId,
          citationId: citation.id,
          contentHash,
          chunkerVersion: CHUNKER_VERSION,
          chunks: chunkMarkdown(markdown),
        });
        summary.indexed += 1;
      } catch (error) {
        summary.errors.push({
          doi: citation.doi,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return summary;
  }
}
