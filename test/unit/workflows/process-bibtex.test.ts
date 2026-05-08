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
          localPath: path.join(bibtexDir, 'papers', '10.1234_test.paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(path.join(bibtexDir, 'papers'));
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'markdown'));
      expect(result.importedCount).toBe(1);
      expect(result.downloadedCount).toBe(1);
      expect(result.markdownCount).toBe(1);
      expect(
        fs.readFileSync(path.join(bibtexDir, 'markdown', '10.1234_test.paper.md'), 'utf-8')
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
          localPath: path.join(customPaperPath, '10.1234_test.paper.pdf'),
          source: 'cache',
          message: 'ok',
        }),
        extractMarkdown: async () => '# Test Paper\n',
      });

      expect(result.paperPath).toBe(customPaperPath);
      expect(result.markdownPath).toBe(path.join(bibtexDir, 'markdown'));
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
      localPath: path.join(customPaperPath, '10.1234_test.paper.pdf'),
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
      expect(mockRetrievePdf).toHaveBeenCalledWith('10.1234/test.paper');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
