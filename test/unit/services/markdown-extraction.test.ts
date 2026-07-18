import fs from 'fs';
import os from 'os';
import path from 'path';
import * as dbModule from '../../../src/db/index';
import * as markdownModule from '../../../src/verification/markdown';
import { Database } from '../../../src/db/index';
import {
  reextractMarkdownFromLocalPdfs,
  reextractMarkdownFromPdfFolder,
} from '../../../src/services/markdown-extraction';

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

  test('returns an empty summary when a DOI filter does not match a citation', async () => {
    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      doi: '10.1/not-found',
      markdownPath: markdownDir,
      extractMarkdown: jest.fn(),
    });

    expect(summary).toMatchObject({ scanned: 0, extracted: 0, missingPdf: 0, failed: 0 });
  });

  test('uses the default database and extractor when options omit them', async () => {
    const pdfPath = path.join(pdfDir, 'default2026.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\ndefault');

    const fakeDb = {
      getCitation: jest.fn().mockReturnValue({
        id: 17,
        doi: '10.1/default',
        bibtexKey: 'default2026',
        pdfPath,
      }),
      getAllCitations: jest.fn(),
      getManifestation: jest.fn().mockReturnValue(undefined),
      upsertManifestation: jest.fn(),
    };

    const getDatabaseSpy = jest.spyOn(dbModule, 'getDatabase').mockReturnValue(fakeDb as never);
    const extractSpy = jest
      .spyOn(markdownModule, 'extractPdfMarkdown')
      .mockResolvedValue('default markdown');

    try {
      const summary = await reextractMarkdownFromLocalPdfs({
        doi: '10.1/default',
        markdownPath: markdownDir,
      });

      expect(summary).toMatchObject({ scanned: 1, extracted: 1, missingPdf: 0, failed: 0 });
      expect(getDatabaseSpy).toHaveBeenCalled();
      expect(extractSpy).toHaveBeenCalledWith(pdfPath);
      expect(fakeDb.getAllCitations).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(markdownDir, 'default2026.md'), 'utf-8')).toBe(
        'default markdown'
      );
    } finally {
      getDatabaseSpy.mockRestore();
      extractSpy.mockRestore();
    }
  });

  test('reports non-Error extractor failures using their string value', async () => {
    seedPdf('10.1/string-failure', 'stringfailure2026');

    const summary = await reextractMarkdownFromLocalPdfs({
      db,
      markdownPath: markdownDir,
      extractMarkdown: jest.fn().mockRejectedValue('extractor exploded'),
    });

    expect(summary).toMatchObject({ scanned: 1, extracted: 0, missingPdf: 0, failed: 1 });
    expect(summary.errors).toEqual([{ doi: '10.1/string-failure', message: 'extractor exploded' }]);
  });

  test('extracts markdown directly from a local PDF folder without DB rows', async () => {
    const nestedPdfDir = path.join(pdfDir, 'nested');
    fs.mkdirSync(nestedPdfDir, { recursive: true });
    const firstPdf = path.join(pdfDir, 'first.pdf');
    const secondPdf = path.join(nestedPdfDir, 'second.pdf');
    fs.writeFileSync(firstPdf, '%PDF-1.4\nfirst');
    fs.writeFileSync(secondPdf, '%PDF-1.4\nsecond');
    const extractMarkdown = jest.fn(
      async (pdfPath: string) => `markdown for ${path.basename(pdfPath)}`
    );
    const onProgress = jest.fn();

    const summary = await reextractMarkdownFromPdfFolder({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      recursive: true,
      extractMarkdown,
      onProgress,
    });

    expect(summary).toMatchObject({ scanned: 2, extracted: 2, missingPdf: 0, failed: 0 });
    expect(extractMarkdown).toHaveBeenCalledWith(firstPdf);
    expect(extractMarkdown).toHaveBeenCalledWith(secondPdf);
    expect(fs.readFileSync(path.join(markdownDir, 'first.md'), 'utf-8')).toBe(
      'markdown for first.pdf'
    );
    expect(fs.readFileSync(path.join(markdownDir, 'nested', 'second.md'), 'utf-8')).toBe(
      'markdown for second.pdf'
    );
    expect(onProgress.mock.calls.map(([progress]) => progress.current)).toEqual([0, 1, 2]);
  });

  test('returns an empty folder summary when the paper path does not exist', async () => {
    const summary = await reextractMarkdownFromPdfFolder({
      paperPath: path.join(dir, 'missing-pdf-root'),
      markdownPath: markdownDir,
      extractMarkdown: jest.fn(),
    });

    expect(summary).toMatchObject({ scanned: 0, extracted: 0, missingPdf: 0, failed: 0 });
  });

  test('uses the default folder extractor and ignores nested PDFs when recursive is false', async () => {
    const topLevelPdf = path.join(pdfDir, 'alpha.pdf');
    const nestedDir = path.join(pdfDir, 'nested');
    const nestedPdf = path.join(nestedDir, 'beta.pdf');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(topLevelPdf, '%PDF-1.4\nalpha');
    fs.writeFileSync(nestedPdf, '%PDF-1.4\nbeta');

    const extractSpy = jest
      .spyOn(markdownModule, 'extractPdfMarkdown')
      .mockResolvedValue('folder markdown');

    try {
      const summary = await reextractMarkdownFromPdfFolder({
        paperPath: pdfDir,
        markdownPath: markdownDir,
      });

      expect(summary).toMatchObject({ scanned: 1, extracted: 1, missingPdf: 0, failed: 0 });
      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(extractSpy).toHaveBeenCalledWith(topLevelPdf);
      expect(fs.existsSync(path.join(markdownDir, 'nested', 'beta.md'))).toBe(false);
    } finally {
      extractSpy.mockRestore();
    }
  });

  test('reports non-Error folder extraction failures using their string value', async () => {
    const pdfPath = path.join(pdfDir, 'broken.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\nbroken');

    const summary = await reextractMarkdownFromPdfFolder({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      extractMarkdown: jest.fn().mockRejectedValue('folder extractor exploded'),
    });

    expect(summary).toMatchObject({ scanned: 1, extracted: 0, missingPdf: 0, failed: 1 });
    expect(summary.errors).toEqual([{ doi: 'broken', message: 'folder extractor exploded' }]);
  });
});
