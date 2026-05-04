import fs from 'fs';
import os from 'os';
import path from 'path';
import { processBibtexFile } from '../../../src/workflows/process-bibtex';

describe('processBibtexFile', () => {
  const tempRoot = path.join(os.tmpdir(), 'citation-needed-workflow-test');

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('defaults outputs next to the BibTeX file and writes markdown', async () => {
    const bibtexDir = path.join(tempRoot, 'refs');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

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
  });

  test('uses the configured paper path', async () => {
    const bibtexDir = path.join(tempRoot, 'refs');
    const customPaperPath = path.join(tempRoot, 'custom-papers');
    fs.mkdirSync(bibtexDir, { recursive: true });
    const bibtexPath = path.join(bibtexDir, 'library.bib');
    fs.writeFileSync(
      bibtexPath,
      `@article{paper, title={Test Paper}, doi={10.1234/test.paper}, author={Test Author}}`,
      'utf-8'
    );

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
    expect(result.markdownPath).toBe(path.join(tempRoot, 'markdown'));
  });
});
