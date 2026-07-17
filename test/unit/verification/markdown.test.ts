import fs from 'fs';
import os from 'os';
import path from 'path';

import pdf2md from '@opendocsg/pdf2md';
import {
  extractPdfMarkdown,
  formatGeneratedMarkdown,
  normalizeExtractionArtifacts,
  repairCaptionBoundaries,
  repairMarkdownHeadings,
  repairMarkdownTables,
} from '../../../src/verification/markdown';

jest.mock('@opendocsg/pdf2md', () => jest.fn());
jest.mock('prettier', () => ({
  format: jest.fn(async (markdown: string) =>
    markdown === '| Metric | Value |\n| --- | --- |\n| Accuracy | 0.91 |'
      ? '| Metric   | Value |\n| -------- | ----- |\n| Accuracy | 0.91  |\n'
      : markdown
  ),
}));

function tempPdfPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-pdf-md-'));
  return path.join(dir, 'paper.pdf');
}

describe('extractPdfMarkdown', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('throws a clear error when PDF file does not exist', async () => {
    await expect(extractPdfMarkdown('/tmp/does-not-exist.pdf')).rejects.toThrow(
      'PDF file not found: /tmp/does-not-exist.pdf'
    );
  });

  test('reads PDF bytes, converts with pdf2md, and trims output', async () => {
    const pdfPath = tempPdfPath();
    try {
      fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nmock'));

      (pdf2md as jest.Mock).mockResolvedValueOnce('\n\n# Heading\n\nBody\n\n');

      const result = await extractPdfMarkdown(pdfPath);

      expect(result).toBe('# Heading\n\nBody');
      expect(pdf2md).toHaveBeenCalledTimes(1);
      expect(Buffer.isBuffer((pdf2md as jest.Mock).mock.calls[0][0])).toBe(true);
    } finally {
      fs.rmSync(path.dirname(pdfPath), { recursive: true, force: true });
    }
  });

  test('applies table repair after extracting markdown', async () => {
    const pdfPath = tempPdfPath();
    try {
      fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nmock'));

      (pdf2md as jest.Mock).mockResolvedValueOnce('\n\nMetric  Value\nAccuracy  0.91\n\n');

      const result = await extractPdfMarkdown(pdfPath);

      expect(result).toBe('| Metric   | Value |\n| -------- | ----- |\n| Accuracy | 0.91  |');
    } finally {
      fs.rmSync(path.dirname(pdfPath), { recursive: true, force: true });
    }
  });
});

describe('formatGeneratedMarkdown', () => {
  test('formats markdown tables with Prettier', async () => {
    await expect(
      formatGeneratedMarkdown('| Metric | Value |\n| --- | --- |\n| Accuracy | 0.91 |')
    ).resolves.toBe('| Metric   | Value |\n| -------- | ----- |\n| Accuracy | 0.91  |');
    expect(jest.mocked(require('prettier').format)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ parser: 'markdown', proseWrap: 'always', printWidth: 100 })
    );
  });
});

describe('normalizeExtractionArtifacts', () => {
  test('replaces bad epsilon control glyphs and removes other C0 controls', () => {
    expect(normalizeExtractionArtifacts('∀\u000f > 0\u0001 and text')).toBe('∀ε > 0 and text');
  });
});

describe('repairCaptionBoundaries', () => {
  test('splits embedded figure captions onto their own line', () => {
    const markdown = [
      'This paragraph introduces the method. Fig. 1. Overview of the complete pipeline.',
      '',
      'Next paragraph.',
    ].join('\n');

    expect(repairCaptionBoundaries(markdown)).toBe(
      [
        'This paragraph introduces the method.',
        '',
        'Fig. 1. Overview of the complete pipeline.',
        '',
        'Next paragraph.',
      ].join('\n')
    );
  });

  test('leaves citations and fenced code untouched', () => {
    const markdown = [
      'Prior work [12] reports a Table 1 result without starting a caption.',
      '```',
      'prefix text Fig. 2. code sample',
      '```',
    ].join('\n');

    expect(repairCaptionBoundaries(markdown)).toBe(markdown);
  });
});

describe('repairMarkdownHeadings', () => {
  test('demotes pre-abstract author metadata and normalizes real section headings', () => {
    const markdown = [
      '## Paper Title',
      '',
      '### Ada Lovelace Bob Smith',
      '',
      '### University of Examples',
      '',
      '### Abstract',
      '',
      '### 1. Introduction',
      '',
      '#### 1.1. Contributions',
    ].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      [
        '## Paper Title',
        '',
        'Ada Lovelace Bob Smith',
        '',
        'University of Examples',
        '',
        '## Abstract',
        '',
        '## 1. Introduction',
        '',
        '### 1.1. Contributions',
      ].join('\n')
    );
  });

  test('demotes formula fragments and figure labels emitted as headings', () => {
    const markdown = [
      '## gt:',
      '#### |TP| + |FN|',
      '#### (1)',
      '#### APH = 100',
      '#### TOP F,SL,SR,R',
      '### 4.1 CLEARMOT',
    ].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      ['gt:', '|TP| + |FN|', '(1)', 'APH = 100', 'TOP F,SL,SR,R', '### 4.1 CLEARMOT'].join('\n')
    );
  });

  test('demotes wrapped prose headings while preserving roman numeral sections', () => {
    const markdown = [
      '## Abstract—This paper introduces a benchmark.',
      '',
      '##### dynamic agents are essential for robots and automated vehicles',
      '',
      '#### II. RELATED WORK',
      '',
      '#### Datasets and Benchmarks: LiDAR datasets for autonomous driving are important.',
    ].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      [
        '## Abstract',
        '',
        'This paper introduces a benchmark.',
        '',
        'dynamic agents are essential for robots and automated vehicles',
        '',
        '## II. RELATED WORK',
        '',
        'Datasets and Benchmarks: LiDAR datasets for autonomous driving are important.',
      ].join('\n')
    );
  });

  test('normalizes all-caps section labels that were emitted too deeply', () => {
    const markdown = ['#### ACKNOWLEDGEMENTS', '#### S.1. ADDITIONAL DATASET DETAILS'].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      ['## ACKNOWLEDGEMENTS', '## S.1. ADDITIONAL DATASET DETAILS'].join('\n')
    );
  });
});

describe('repairMarkdownTables', () => {
  test('repairs pipe-delimited table blocks', () => {
    const markdown = [
      'Metric | Value | Notes',
      'Accuracy | 0.91 | baseline',
      'F1 | 0.88 | tuned',
    ].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      [
        '| Metric | Value | Notes |',
        '| --- | --- | --- |',
        '| Accuracy | 0.91 | baseline |',
        '| F1 | 0.88 | tuned |',
      ].join('\n')
    );
  });

  test('repairs whitespace-aligned table blocks', () => {
    const markdown = [
      'Method  Precision  Recall',
      'A       0.91       0.80',
      'B       0.87       0.82',
    ].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      [
        '| Method | Precision | Recall |',
        '| --- | --- | --- |',
        '| A | 0.91 | 0.80 |',
        '| B | 0.87 | 0.82 |',
      ].join('\n')
    );
  });

  test('leaves uneven rows unchanged', () => {
    const markdown = ['A | B', '1 | 2 | 3'].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(markdown);
  });

  test('does not convert prose, lists, or fenced code blocks', () => {
    const markdown = [
      'This sentence has  two spaces but is prose.',
      '- Item  one',
      '```',
      'Metric  Value',
      'Accuracy  0.91',
      '```',
    ].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(markdown);
  });

  test('normalizes cell whitespace', () => {
    const markdown = ['Metric | Notes', 'Mean   score | uses   spacing'].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      '| Metric | Notes |\n| --- | --- |\n| Mean score | uses spacing |'
    );
  });

  test('escapes literal pipes inside whitespace-aligned cells', () => {
    const markdown = ['Model  Notes', 'A|B    uses pipe'].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      '| Model | Notes |\n| --- | --- |\n| A\\|B | uses pipe |'
    );
  });
});
