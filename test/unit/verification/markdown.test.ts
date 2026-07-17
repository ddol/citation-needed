import fs from 'fs';
import os from 'os';
import path from 'path';

import pdf2md from '@opendocsg/pdf2md';
import {
  addFigureSourceLinks,
  addMissingSourcePlaceholders,
  extractPdfMarkdown,
  formatGeneratedMarkdown,
  normalizeExtractionArtifacts,
  normalizeReferenceList,
  removeDuplicateMarkdownTables,
  repairCaptionBoundaries,
  repairEquationBlocks,
  repairLooseLineSpacing,
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

  test('applies reference and equation cleanup after extracting markdown', async () => {
    const pdfPath = tempPdfPath();
    try {
      fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nmock'));

      (pdf2md as jest.Mock).mockResolvedValueOnce(
        ['E = mc^2 (1)', '', 'REFERENCES [1] A. Author. First. [2] B. Author. Second.'].join('\n')
      );

      const result = await extractPdfMarkdown(pdfPath);

      expect(result).toContain(['```text', 'E = mc^2 (1)', '```'].join('\n'));
      expect(result).toContain('- [1] A. Author. First.');
      expect(result).toContain('- [2] B. Author. Second.');
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

describe('normalizeReferenceList', () => {
  test('splits IEEE bracketed references into a Markdown list', () => {
    const markdown = [
      '## References',
      '',
      '[1] A. Author, “First paper,” 2020. [2] B. Author, “Second paper,” 2021.',
      '[3] C. Author, “Third paper,” 2022.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '- [1] A. Author, “First paper,” 2020.',
        '- [2] B. Author, “Second paper,” 2021.',
        '- [3] C. Author, “Third paper,” 2022.',
      ].join('\n')
    );
  });

  test('splits same-line REFERENCES heading and entries', () => {
    const markdown = 'REFERENCES [1] A. Author, “First,” 2020. [2] B. Author, “Second,” 2021.';

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '- [1] A. Author, “First,” 2020.',
        '- [2] B. Author, “Second,” 2021.',
      ].join('\n')
    );
  });

  test('preserves numbered Springer-style references as a Markdown list', () => {
    const markdown = [
      'References',
      '',
      '1. First Author (2020) First title',
      '   continuation line',
      '2. Second Author (2021) Second title',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '1. First Author (2020) First title continuation line',
        '2. Second Author (2021) Second title',
      ].join('\n')
    );
  });

  test('splits author-year references without numeric labels', () => {
    const markdown = [
      '## References',
      '',
      'Baisa, N.L. (2018). Online tracking paper. Bergmann, P., Meinhardt, T., & Leal-Taixé, L. (2019). Tracking without bells.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '- Baisa, N.L. (2018). Online tracking paper.',
        '- Bergmann, P., Meinhardt, T., & Leal-Taixé, L. (2019). Tracking without bells.',
      ].join('\n')
    );
  });
});

describe('repairEquationBlocks', () => {
  test('wraps split equation blocks with labels in fenced text', () => {
    const markdown = ['∆x =', 'xg − xa', 'da', ', (1)', '', 'where da is the diagonal.'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      [
        '',
        '```text',
        '∆x =',
        'xg − xa',
        'da',
        ', (1)',
        '```',
        '',
        'where da is the diagonal.',
      ].join('\n')
    );
  });

  test('does not wrap numbered references as equations', () => {
    const markdown = ['## References', '', '[1] A. Author. Title.'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(markdown);
  });
});

describe('addFigureSourceLinks', () => {
  test('adds source PDF page links after standalone captions', () => {
    const markdown = ['Fig. 2. Architecture overview.', '', 'Body text.'].join('\n');
    const layout = ['page one', '\f', 'Fig. 2. Architecture overview.'].join('\n');

    expect(addFigureSourceLinks(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'Fig. 2. Architecture overview.',
        '',
        '> Figure source: [PDF page 2](../pdf/Paper.pdf#page=2)',
        '',
        'Body text.',
      ].join('\n')
    );
  });

  test('does not add links for prose figure mentions', () => {
    const markdown = 'The method is summarized in Figure 2. We discuss it next.';
    const layout = 'The method is summarized in Figure 2. We discuss it next.';

    expect(addFigureSourceLinks(markdown, layout, '/tmp/Paper.pdf')).toBe(markdown);
  });
});

describe('addMissingSourcePlaceholders', () => {
  test('adds placeholders for source figures and equations absent from Markdown', () => {
    const markdown = ['Intro text.', '<!-- PAGE_BREAK -->', 'Second page text.'].join('\n');
    const layout = [
      'Figure 1. Overview.',
      'x = y + z (1)',
      '\f',
      'Fig. 2. Detail.',
      'Second page.',
    ].join('\n');

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'Intro text.',
        '',
        'Figure 1. Source figure not extracted; see [PDF page 1](../pdf/Paper.pdf#page=1).',
        '',
        'Equation source = PDF page 1 (1)',
        '<!-- PAGE_BREAK -->',
        'Second page text.',
        '',
        'Figure 2. Source figure not extracted; see [PDF page 2](../pdf/Paper.pdf#page=2).',
        '',
      ].join('\n')
    );
  });
});

describe('repairLooseLineSpacing', () => {
  test('removes pathological blank lines inside wrapped prose', () => {
    const markdown = [
      '## Abstract',
      '',
      'This paragraph was',
      '',
      'split across many',
      '',
      'blank lines by OCR.',
      '',
      'Fig. 1. Caption remains separate.',
    ].join('\n');

    expect(repairLooseLineSpacing(markdown)).toBe(
      [
        '## Abstract',
        '',
        'This paragraph was',
        'split across many',
        'blank lines by OCR.',
        '',
        'Fig. 1. Caption remains separate.',
      ].join('\n')
    );
  });
});

describe('removeDuplicateMarkdownTables', () => {
  test('removes exact repeated Markdown table blocks near each other', () => {
    const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const markdown = [table, '', 'Paragraph.', '', table].join('\n');

    expect(removeDuplicateMarkdownTables(markdown)).toBe([table, '', 'Paragraph.', ''].join('\n'));
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

  test('demotes h2 author and affiliation headings before the abstract', () => {
    const markdown = [
      '## Paper Title',
      '',
      '## Ada Lovelace',
      '',
      '## Example University',
      '',
      '## Abstract',
    ].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      ['## Paper Title', '', 'Ada Lovelace', '', 'Example University', '', '## Abstract'].join('\n')
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
