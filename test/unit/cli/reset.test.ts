import path from 'path';
import os from 'os';
import fs from 'fs';
import { Database } from '../../../src/db/index';
import { resetDatabase } from '../../../src/cli/commands/reset';

// Per-suite mkdtemp dir: a shared fixture directory races across parallel Jest
// workers, where another suite's afterAll cleanup deletes this suite's DB
// mid-test.
function makeTestDb(): { db: Database; dbDir: string } {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-reset-db-'));
  return { db: new Database(path.join(dbDir, 'citations.db')), dbDir };
}

describe('resetDatabase', () => {
  let db: Database;
  let dbDir: string;
  let tempDir: string;

  function seedCitation(doi: string, pdfPath?: string): number {
    const stored = db.addCitation({ doi, title: `Paper ${doi}` });
    const id = stored.id as number;
    // pdf_path is never set by the insert; the orchestrator writes it after a
    // successful download.
    if (pdfPath) db.updatePdfPath(doi, pdfPath);
    db.logRetrieval({ citationId: id, source: 'test:arxiv', success: true });
    return id;
  }

  beforeEach(() => {
    ({ db, dbDir } = makeTestDb());
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-reset-files-'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('without --yes it reports counts and changes nothing', () => {
    seedCitation('10/a');
    seedCitation('10/b');

    const summary = resetDatabase(db, {});

    expect(summary.applied).toBe(false);
    expect(summary.counts.citations).toBe(2);
    expect(summary.counts.retrievalLog).toBe(2);
    expect(db.getAllCitations()).toHaveLength(2);
  });

  test('with --yes it deletes citations and cascades to retrieval_log', () => {
    seedCitation('10/a');
    seedCitation('10/b');

    const summary = resetDatabase(db, { yes: true });

    expect(summary.applied).toBe(true);
    expect(summary.counts.citations).toBe(2);
    expect(db.getAllCitations()).toEqual([]);
    expect(db.getRowCounts()).toEqual({
      citations: 0,
      retrievalLog: 0,
      manifestations: 0,
      chunks: 0,
    });
  });

  test('keeps files on disk unless --files is passed', () => {
    const pdf = path.join(tempDir, 'paper.pdf');
    fs.writeFileSync(pdf, '%PDF');
    seedCitation('10/a', pdf);

    const summary = resetDatabase(db, { yes: true });

    expect(summary.trackedFiles).toEqual([pdf]);
    expect(summary.deletedFiles).toEqual([]);
    expect(fs.existsSync(pdf)).toBe(true);
  });

  // The reset exists to clear wrong PDFs that would otherwise be served from
  // cache on the next import, so --files must actually remove them.
  test('with --files it deletes the tracked PDFs from disk', () => {
    const pdf = path.join(tempDir, 'paper.pdf');
    fs.writeFileSync(pdf, '%PDF');
    seedCitation('10/a', pdf);

    const summary = resetDatabase(db, { yes: true, files: true });

    expect(summary.deletedFiles).toEqual([pdf]);
    expect(fs.existsSync(pdf)).toBe(false);
    expect(db.getAllCitations()).toEqual([]);
  });

  test('reports files that no longer exist without failing', () => {
    seedCitation('10/a', path.join(tempDir, 'missing.pdf'));

    const summary = resetDatabase(db, { yes: true, files: true });

    expect(summary.trackedFiles).toEqual([]);
    expect(summary.failedFiles).toEqual([]);
    expect(summary.applied).toBe(true);
  });

  test('is a no-op on an already empty database', () => {
    const summary = resetDatabase(db, { yes: true });

    expect(summary.applied).toBe(true);
    expect(summary.counts.citations).toBe(0);
    expect(summary.trackedFiles).toEqual([]);
  });
});
