import fs from 'fs';
import os from 'os';
import path from 'path';

const mockRetrievePdf = jest.fn();
const mockRetrievalOrchestrator = jest.fn().mockImplementation(() => ({
  retrievePdf: mockRetrievePdf,
}));

jest.mock('../../../src/retrieval/index', () => ({
  RetrievalOrchestrator: mockRetrievalOrchestrator,
}));

import { processBibtexFile } from '../../../src/workflows/process-bibtex';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-workflow-test-'));
}

describe('processBibtexFile', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('defaults outputs next to the BibTeX file and writes markdown', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      const result = await processBibtexFile(bibtexPath, {
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async () => ({
          success: true,
          localPath: path.join(bibtexDir, 'papers', 'pdf', 'paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(path.join(bibtexDir, 'papers', 'pdf'));
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'papers', 'markdown'));
      expect(result.importedCount).toBe(1);
      expect(result.downloadedCount).toBe(1);
      expect(result.markdownCount).toBe(1);
      expect(
        fs.readFileSync(path.join(bibtexDir, 'papers', 'markdown', 'paper.md'), 'utf-8')
      ).toContain('# Test Paper');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses the configured paper path', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const customPaperPath = path.join(tempRoot, 'custom-papers');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

    try {
      const result = await processBibtexFile(bibtexPath, {
        paperPath: customPaperPath,
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async () => ({
          success: true,
          localPath: path.join(customPaperPath, 'paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(customPaperPath);
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'papers', 'markdown'));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('passes the configured paper path to the retrieval orchestrator', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const customPaperPath = path.join(tempRoot, 'custom-papers');
    const db = { addCitation: jest.fn() } as never;
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );
    mockRetrievePdf.mockResolvedValue({
      success: true,
      localPath: path.join(customPaperPath, 'paper.pdf'),
      source: 'cache',
      message: 'ok',
    });

    try {
      await processBibtexFile(bibtexPath, {
        paperPath: customPaperPath,
        db,
        authConfig: { email: 'reader@example.com' },
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(mockRetrievalOrchestrator).toHaveBeenCalledWith(
        db,
        expect.objectContaining({ email: 'reader@example.com' }),
        customPaperPath
      );
      expect(mockRetrievePdf).toHaveBeenCalledWith(
        '10.1234/test.paper',
        expect.objectContaining({ bibtexKey: 'paper' })
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('emits progress updates for skipped, successful, and failed entries', async () => {
    const tempRoot = makeTempRoot();
    const bibtexDir = path.join(tempRoot, 'refs');
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    const progressEvents: Array<{ label: string; stage: string; message?: string }> = [];

    fs.mkdirSync(bibtexDir, { recursive: true });
    fs.writeFileSync(
      bibtexPath,
      [
        '@article{skip, title={Skipped Paper}, author={No DOI Author}}',
        '@article{success, title={Successful Paper}, doi={10.1234/success}, author={Success Author}}',
        '@article{failure, title={Failed Paper}, doi={10.1234/failure}, author={Failure Author}}',
      ].join('\n\n'),
      'utf-8'
    );

    try {
      await processBibtexFile(bibtexPath, {
        db: { addCitation: jest.fn() } as never,
        retrievePdf: async (doi, entry) => {
          if (entry.bibtexKey === 'failure') {
            return {
              success: false,
              source: 'open-access',
              message: 'No PDF available',
            };
          }

          return {
            success: true,
            localPath: path.join(bibtexDir, 'papers', 'pdf', `${entry.bibtexKey}.pdf`),
            source: 'cache',
            message: `ok:${doi}`,
          };
        },
        extractMarkdown: async () => '# Markdown\n',
        onProgress: (progress) => {
          progressEvents.push({
            label: progress.label,
            stage: progress.stage,
            message: progress.message,
          });
        },
      });

      expect(progressEvents).toEqual([
        { label: 'skip', stage: 'skipped', message: 'Skipped: no DOI' },
        { label: 'success', stage: 'retrieving', message: 'Downloading PDF' },
        { label: 'success', stage: 'markdown', message: 'Generating Markdown' },
        {
          label: 'success',
          stage: 'completed',
          message: 'PDF downloaded and Markdown created',
        },
        { label: 'failure', stage: 'retrieving', message: 'Downloading PDF' },
        { label: 'failure', stage: 'failed', message: 'No PDF available' },
      ]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
