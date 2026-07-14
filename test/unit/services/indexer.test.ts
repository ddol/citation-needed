import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { IndexService } from '../../../src/services/indexer';
import { CHUNKER_VERSION } from '../../../src/services/chunker';

describe('IndexService', () => {
  let dir: string;
  let root: string;
  let db: Database;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-indexer-db-'));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-indexer-ws-'));
    fs.mkdirSync(path.join(root, 'papers', 'pdf'), { recursive: true });
    fs.mkdirSync(path.join(root, 'papers', 'markdown'), { recursive: true });
    db = new Database(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  function seed(doi: string, bibtexKey: string, markdown?: string, withPdf = false): void {
    db.addCitation({ doi, title: `Paper ${bibtexKey}`, bibtexKey });
    db.updatePdfPath(doi, path.join(root, 'papers', 'pdf', `${bibtexKey}.pdf`));
    if (withPdf) {
      fs.writeFileSync(path.join(root, 'papers', 'pdf', `${bibtexKey}.pdf`), 'fake-pdf-bytes');
    }
    if (markdown !== undefined) {
      fs.writeFileSync(path.join(root, 'papers', 'markdown', `${bibtexKey}.md`), markdown);
    }
  }

  test('indexes markdown into searchable chunks and hashes the pdf', async () => {
    seed('10.1/i.1', 'idx2024', '# Study\n\nLidar chunk indexing works.', true);
    seed('10.1/i.2', 'nomd2024'); // pdfPath recorded, no files on disk

    const summary = await new IndexService(db).indexCorpus();

    expect(summary).toMatchObject({
      scanned: 2,
      indexed: 1,
      unchanged: 0,
      missingMarkdown: 1,
      errors: [],
    });

    const { results } = db.searchFts('indexing');
    expect(results.map((r) => r.citation.doi)).toEqual(['10.1/i.1']);
    expect(results[0].matches[0].sectionPath).toEqual(['Study']);

    const citation = db.getCitation('10.1/i.1');
    const pdfManifestation = db.getManifestation(citation!.id!, 'pdf');
    expect(pdfManifestation?.contentHash).toHaveLength(64);
    const mdManifestation = db.getManifestation(citation!.id!, 'markdown-extracted');
    expect(mdManifestation?.contentHash).toHaveLength(64);
  });

  test('is idempotent: a second run does zero chunking work', async () => {
    seed('10.1/i.3', 'twice2024', '# Once\n\nOnly chunk me a single time.');
    const service = new IndexService(db);

    const first = await service.indexCorpus();
    expect(first.indexed).toBe(1);

    const second = await service.indexCorpus();
    expect(second.indexed).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  test('re-indexes when the markdown content changes', async () => {
    seed('10.1/i.4', 'change2024', '# V1\n\noriginal body');
    const service = new IndexService(db);
    await service.indexCorpus();

    fs.writeFileSync(
      path.join(root, 'papers', 'markdown', 'change2024.md'),
      '# V2\n\nrewritten body'
    );
    const summary = await service.indexCorpus();

    expect(summary.indexed).toBe(1);
    expect(db.searchFts('rewritten').results).toHaveLength(1);
    expect(db.searchFts('original').results).toHaveLength(0);
  });

  test('a chunker version bump eagerly re-chunks unchanged content', async () => {
    seed('10.1/i.5', 'bump2024', '# Stable\n\nsame content as before');
    const service = new IndexService(db);
    await service.indexCorpus();

    // Simulate an index written by an older chunker version.
    const citation = db.getCitation('10.1/i.5');
    const manifestation = db.getManifestation(citation!.id!, 'markdown-extracted');
    const state = db.getChunkIndexState(manifestation!.id);
    db.replaceChunks({
      manifestationId: manifestation!.id,
      citationId: citation!.id!,
      contentHash: state!.contentHash,
      chunkerVersion: CHUNKER_VERSION - 1,
      chunks: [{ ordinal: 0, sectionPath: [], text: 'stale chunking' }],
    });

    const summary = await service.indexCorpus();
    expect(summary.indexed).toBe(1);
    expect(db.searchFts('stale').results).toHaveLength(0);
    expect(db.searchFts('stable').results).toHaveLength(1);
  });
});
