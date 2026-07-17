import fs from 'fs';
import os from 'os';
import path from 'path';
import { scoreMarkdownQuality } from '../../../src/services/markdown-quality';

describe('scoreMarkdownQuality', () => {
  let dir: string;
  let pdfDir: string;
  let markdownDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-md-quality-'));
    pdfDir = path.join(dir, 'pdf');
    markdownDir = path.join(dir, 'markdown');
    fs.mkdirSync(pdfDir, { recursive: true });
    fs.mkdirSync(markdownDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writePaper(stem: string, markdown: string): string {
    fs.writeFileSync(path.join(pdfDir, `${stem}.pdf`), `%PDF-1.4\n${stem}`);
    fs.writeFileSync(path.join(markdownDir, `${stem}.md`), markdown);
    return path.join(pdfDir, `${stem}.pdf`);
  }

  test('scores well-formed Markdown with table coverage, page breaks, and top-page arXiv metadata', async () => {
    const pdfPath = writePaper(
      'good-paper',
      [
        'arXiv:1904.01416v3',
        '',
        '## Introduction',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        '',
        'Table 1. Results.',
        '',
        '<!-- PAGE_BREAK -->',
        '',
        '## Method',
        '',
        'This page has body text.',
      ].join('\n')
    );
    const layout = [
      'arXiv:1904.01416v3',
      '',
      'Metric      Value',
      'Alpha           1',
      'Beta            2',
      '',
      'Table 1. Results.',
      '\f',
      'Second page body text.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary).toMatchObject({
      papers: 1,
      scored: 1,
      missingMarkdown: 0,
      missingPdf: 0,
      totalSourceTables: 1,
      totalMissingMarkdownTables: 0,
    });
    expect(report.papers[0]).toMatchObject({
      id: 'good-paper',
      pdfPath,
      sourceTablesByPage: [
        { page: 1, count: 1, tableNumbers: ['1'] },
        { page: 2, count: 0, tableNumbers: [] },
      ],
      markdownTableNumbers: ['1'],
      missingMarkdownTables: [],
      headingIssues: [],
    });
    expect(report.papers[0].metrics).toMatchObject({
      sourcePages: 2,
      markdownPages: 2,
      sourceTableCount: 1,
      markdownTableCount: 1,
      tableCoverageScore: 1,
      tableFormattingScore: 1,
      headingFlowScore: 1,
      arxivPlacementScore: 1,
    });
    expect(report.papers[0].metrics.score).toBeGreaterThan(85);
  });

  test('does not count two-column prose with citations as a source table', async () => {
    writePaper('two-column-prose', ['## Introduction', '', 'Body text only.'].join('\n'));
    const layout = [
      'This line has prose [1, 2] in one column       and more prose [3, 4] in another',
      'Another paragraph line 2020 with text          continues with citations 2019',
      'A third line mentions Table 1 in prose         but is not a caption line',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('does not count two-column references pages as source tables', async () => {
    writePaper('references-page', ['## References', '', '[1] Example reference.'].join('\n'));
    const layout = [
      'References                                      Conference on Examples',
      '[1] First Author. Title.                         [4] Fourth Author. Title.',
      '[2] Second Author. Longer title.                 [5] Fifth Author. Title.',
      '[3] Third Author. Another title.                 [6] Sixth Author. Title.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('flags missing Markdown tables and incoherent repeated h3 heading blocks', async () => {
    writePaper(
      'broken-paper',
      [
        '# Paper',
        '',
        '### 1',
        '### 2',
        '### 3',
        '### 4',
        '',
        'Metric Value Alpha 1 Beta 2',
        '',
        'Table 1: Results.',
      ].join('\n')
    );
    const layout = [
      'arXiv:1904.01416v3',
      '',
      'Metric      Value',
      'Alpha           1',
      'Beta            2',
      '',
      'Table 1: Results.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    const paper = report.papers[0];
    expect(paper.sourceTablesByPage).toEqual([{ page: 1, count: 1, tableNumbers: ['1'] }]);
    expect(paper.missingMarkdownTables).toEqual(['1']);
    expect(paper.issues).toContain('missing-markdown-tables:1');
    expect(paper.issues).toContain('heading-flow-issues');
    expect(paper.headingIssues.map((issue) => issue.message)).toContain(
      'four consecutive h3 headings look like metadata, not document structure'
    );
    expect(paper.metrics).toMatchObject({
      sourceTableCount: 1,
      markdownTableCount: 0,
      tableCoverageScore: 0,
      arxivPlacementScore: 0,
    });
    expect(paper.metrics.headingFlowScore).toBeLessThan(1);
    expect(paper.metrics.score).toBeLessThan(60);
  });

  test('counts unnumbered source table blocks by page and matches them by Markdown table presence', async () => {
    writePaper(
      'unnumbered-paper',
      ['## Results', '', '| Dataset | Count |', '| --- | --- |', '| A | 10 |', '| B | 20 |'].join(
        '\n'
      )
    );
    const layout = ['Dataset      Count', 'A               10', 'B               20'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(1);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 1, tableNumbers: [] }]);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
    expect(report.papers[0].metrics.tableCoverageScore).toBe(1);
  });

  test('reports missing Markdown files without reading source layout as a successful score', async () => {
    fs.writeFileSync(path.join(pdfDir, 'missing-md.pdf'), '%PDF-1.4\nmissing');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue('Body text'),
    });

    expect(report.summary).toMatchObject({ papers: 1, scored: 0, missingMarkdown: 1 });
    expect(report.papers[0].issues).toContain('missing-markdown');
    expect(report.papers[0].metrics.score).toBeLessThan(40);
  });

  test('does not award a strong baseline-match score when PDF layout text is unavailable', async () => {
    writePaper(
      'layout-missing',
      ['## Results', '', '| Dataset | Count |', '| --- | --- |', '| A | 10 |', '| B | 20 |'].join(
        '\n'
      )
    );

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(undefined),
    });

    expect(report.papers[0].issues).toContain('source-layout-unavailable');
    expect(report.papers[0].metrics).toMatchObject({
      sourcePages: 0,
      sourceTableCount: 0,
      tableCoverageScore: 0,
      pageBreakScore: 0,
      arxivPlacementScore: 0,
      completenessScore: 0,
      tableFormattingScore: 1,
    });
    expect(report.papers[0].metrics.score).toBeLessThanOrEqual(40);
  });
});
