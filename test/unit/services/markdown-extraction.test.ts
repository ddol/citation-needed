import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from '../../../src/db/index';
import { reextractMarkdownFromLocalPdfs } from '../../../src/services/markdown-extraction';

describe('reextractMarkdownFromLocalPdfs', () => {
  let dir: string;
  let db: Database;
  let pdfDir: string;
  let markdownDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-md-reextract-'));
    pdfDir = path.join(dir, 'papers', 'pdf');
    markdownDir = path.join(dir, 'papers', 'markdown');
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.mkdirSync(markdownDir, { recursive: true });
    db = new Database(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedPdf(doi: string, bibtexKey: string): string {
    db.addCitation({ doi, title: bibtexKey, bibtexKey });
    const pdfPath = path.join(pdfDir, `${bibtexKey}.pdf`);
    fs.writeFileSync(pdfPath, `%PDF-1.4\n${bibtexKey}`);
    db.updatePdfPath(doi, pdfPath);
    return pdfPath;
  }

  test('writes markdown from local PDFs and records refreshed manifestations', async () => {
    const pdfPath = seedPdf('10.1/reextract', 'reextract2026');
    const extractMarkdown = jest.fn().mockResolvedValue('# Re-extracted\n\nTable repaired.');

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      markdownPath: markdownDir,
      extractMarkdown,
    });

    const markdownPath = path.join(markdownDir, 'reextract2026.md');
    expect(summary).toMatchObject({ scanned: 1, extracted: 1, missingPdf: 0, failed: 0 });
    expect(extractMarkdown).toHaveBeenCalledWith(pdfPath);
    expect(fs.readFileSync(markdownPath, 'utf-8')).toBe('# Re-extracted\n\nTable repaired.');

    const citation = db.getCitation('10.1/reextract');
    const markdownManifestation = db.getManifestation(citation!.id!, 'markdown-extracted');
    const pdfManifestation = db.getManifestation(citation!.id!, 'pdf');
    expect(markdownManifestation).toMatchObject({
      path: markdownPath,
      extractorName: '@opendocsg/pdf2md',
    });
    expect(markdownManifestation?.contentHash).toHaveLength(64);
    expect(pdfManifestation?.path).toBe(pdfPath);
    expect(pdfManifestation?.contentHash).toHaveLength(64);
  });

  test('reuses an existing markdown manifestation path when no output directory is passed', async () => {
    seedPdf('10.1/existing', 'existing2026');
    const citation = db.getCitation('10.1/existing');
    const existingMarkdownPath = path.join(dir, 'custom', 'paper.md');
    fs.mkdirSync(path.dirname(existingMarkdownPath), { recursive: true });
    db.upsertManifestation({
      citationId: citation!.id!,
      kind: 'markdown-extracted',
      path: existingMarkdownPath,
    });

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      extractMarkdown: jest.fn().mockResolvedValue('updated markdown'),
    });

    expect(summary.extracted).toBe(1);
    expect(fs.readFileSync(existingMarkdownPath, 'utf-8')).toBe('updated markdown');
  });

  test('reports missing local PDFs without attempting extraction', async () => {
    db.addCitation({ doi: '10.1/missing', bibtexKey: 'missing2026' });
    db.updatePdfPath('10.1/missing', path.join(pdfDir, 'missing2026.pdf'));
    const extractMarkdown = jest.fn();

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      markdownPath: markdownDir,
      extractMarkdown,
    });

    expect(summary).toMatchObject({ scanned: 1, extracted: 0, missingPdf: 1, failed: 0 });
    expect(extractMarkdown).not.toHaveBeenCalled();
  });

  test('emits progress updates without changing extraction behavior', async () => {
    seedPdf('10.1/progress-ok', 'progressok2026');
    db.addCitation({ doi: '10.1/progress-missing', bibtexKey: 'progressmissing2026' });
    db.updatePdfPath('10.1/progress-missing', path.join(pdfDir, 'progressmissing2026.pdf'));
    const onProgress = jest.fn();

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      markdownPath: markdownDir,
      extractMarkdown: jest.fn().mockResolvedValue('markdown'),
      onProgress,
    });

    expect(summary).toMatchObject({ scanned: 2, extracted: 1, missingPdf: 1, failed: 0 });
    expect(onProgress).toHaveBeenCalledWith({ current: 0, total: 2, status: 'starting' });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 2,
        doi: '10.1/progress-missing',
        status: 'missing-pdf',
      })
    );
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 2,
        doi: '10.1/progress-ok',
        status: 'extracted',
      })
    );
    expect(onProgress.mock.calls.map(([progress]) => progress.current)).toEqual([0, 1, 2]);
  });

  test('requires markdownPath when no existing markdown manifestation exists', async () => {
    seedPdf('10.1/no-md-path', 'nomdpath2026');

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      extractMarkdown: jest.fn().mockResolvedValue('markdown'),
    });

    expect(summary).toMatchObject({ scanned: 1, extracted: 0, missingPdf: 0, failed: 1 });
    expect(summary.errors[0]).toEqual({
      doi: '10.1/no-md-path',
      message: 'No Markdown path is known; pass --markdown-path to create one.',
    });
  });
});
