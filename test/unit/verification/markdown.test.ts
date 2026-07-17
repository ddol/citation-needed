import fs from 'fs';
import os from 'os';
import path from 'path';

import pdf2md from '@opendocsg/pdf2md';
import {
  addFigureSourceLinks,
  addMissingSourcePlaceholders,
  extractPdfMarkdown,
  formatGeneratedMarkdown,
  normalizeDisplayMathBlocks,
  normalizeExtractionArtifacts,
  normalizeReferenceList,
  removeDuplicateMarkdownTables,
  repairCaptionBoundaries,
  repairEquationBlocks,
  repairLooseLineSpacing,
  repairMarkdownHeadings,
  repairMarkdownTables,
} from '../../../src/verification/markdown';
import { extractPdfMarkdown as exportedExtractPdfMarkdown } from '../../../src/verification';

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

      expect(result).toContain(['$$', 'E = mc^2', '\\tag{1}', '$$'].join('\n'));
      expect(result).toContain('1. A. Author. First.');
      expect(result).toContain('2. B. Author. Second.');
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

  test('returns unformatted markdown when Prettier fails', async () => {
    jest.mocked(require('prettier').format).mockRejectedValueOnce(new Error('bad markdown'));

    await expect(formatGeneratedMarkdown('raw | markdown')).resolves.toBe('raw | markdown');
  });

  test('logs non-error formatter failures and returns unformatted markdown', async () => {
    jest.mocked(require('prettier').format).mockRejectedValueOnce('string failure');

    await expect(formatGeneratedMarkdown('raw markdown')).resolves.toBe('raw markdown');
  });
});

describe('verification exports', () => {
  test('re-exports the PDF Markdown extractor', () => {
    expect(exportedExtractPdfMarkdown).toBe(extractPdfMarkdown);
  });

  test('falls back to unknown when the extractor package version cannot be read', () => {
    jest.isolateModules(() => {
      jest.doMock('@opendocsg/pdf2md/package.json', () => {
        throw new Error('missing package metadata');
      });

      const isolated =
        require('../../../src/verification/markdown') as typeof import('../../../src/verification/markdown');

      expect(isolated.PDF_MARKDOWN_EXTRACTOR_VERSION).toBe('unknown');
    });
    jest.dontMock('@opendocsg/pdf2md/package.json');
  });

  test('falls back to unknown when extractor package metadata has no version', () => {
    jest.isolateModules(() => {
      jest.doMock('@opendocsg/pdf2md/package.json', () => ({}));

      const isolated =
        require('../../../src/verification/markdown') as typeof import('../../../src/verification/markdown');

      expect(isolated.PDF_MARKDOWN_EXTRACTOR_VERSION).toBe('unknown');
    });
    jest.dontMock('@opendocsg/pdf2md/package.json');
  });
});

describe('normalizeExtractionArtifacts', () => {
  test('replaces bad epsilon control glyphs and removes other C0 controls', () => {
    expect(normalizeExtractionArtifacts('∀\u000f > 0\u0001 and text')).toBe('∀ε > 0 and text');
  });
});

describe('repairCaptionBoundaries', () => {
  test('leaves empty lines, standalone captions, and weak embedded captions unchanged', () => {
    const markdown = [
      '',
      'Figure 3. Already standalone.',
      `${' '.repeat(25)}Fig. 4.`,
      'Short prefix Fig. 4. not enough boundary evidence',
      'Prefix without punctuation Fig. 5. also stays inline',
    ].join('\n');

    expect(repairCaptionBoundaries(markdown)).toBe(markdown);
  });

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
  test('normalizes an empty references heading and leaves unstructured references untouched', () => {
    expect(normalizeReferenceList(['Intro.', 'References'].join('\n'))).toBe(
      ['Intro.', '## References'].join('\n')
    );

    const unstructured = ['## References', '', 'This is not a structured bibliography.'].join('\n');
    expect(normalizeReferenceList(unstructured)).toBe(unstructured);
  });

  test('splits IEEE bracketed references into a numbered Markdown list', () => {
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
        '1. A. Author, “First paper,” 2020.',
        '2. B. Author, “Second paper,” 2021.',
        '3. C. Author, “Third paper,” 2022.',
      ].join('\n')
    );
  });

  test('splits same-line REFERENCES heading and entries', () => {
    const markdown = 'REFERENCES [1] A. Author, “First,” 2020. [2] B. Author, “Second,” 2021.';

    expect(normalizeReferenceList(markdown)).toBe(
      ['## References', '', '1. A. Author, “First,” 2020.', '2. B. Author, “Second,” 2021.'].join(
        '\n'
      )
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
        '1. Baisa, N.L. (2018). Online tracking paper.',
        '2. Bergmann, P., Meinhardt, T., & Leal-Taixé, L. (2019). Tracking without bells.',
      ].join('\n')
    );
  });

  test('converts unordered reference entries into a numbered Markdown list', () => {
    const markdown = [
      '## References',
      '',
      '- [4] First Author. First title.',
      '  Continued venue details.',
      '- Second Author. Second title.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '4. First Author. First title. Continued venue details.',
        '2. Second Author. Second title.',
      ].join('\n')
    );
  });

  test('keeps a single bracketed reference as a numbered list entry', () => {
    const markdown = ['## References', '', '[7] Solo Author. Single cited work.'].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      ['## References', '', '7. Solo Author. Single cited work.'].join('\n')
    );
  });

  test('terminates bracketed references before trailing figure appendix text', () => {
    const markdown = [
      '## References',
      '',
      '[1] First Author. First title. 1',
      '[2] Last Author. Last title. In ICRA, 2015. 2 Figure 6: Point cloud labeling tool.',
      '## A. Consistent Labels for LiDAR Sequences',
      'Body text with citation [3] that is not a reference entry.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '1. First Author. First title. 1',
        '2. Last Author. Last title. In ICRA, 2015. 2',
      ].join('\n')
    );
  });

  test('prefers bracketed bibliography entries over later appendix bullets', () => {
    const markdown = [
      '## References',
      '',
      '[1] First Author. First title. 1 [2] Second Author. Second title. 2',
      '- Lidar extrinsics: appendix detail, not a bibliography entry.',
      '- Camera extrinsics: appendix detail, not a bibliography entry.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '1. First Author. First title. 1',
        '2. Second Author. Second title. 2',
      ].join('\n')
    );
  });

  test('terminates numbered references before supplementary material headings', () => {
    const markdown = [
      '## References',
      '',
      '1. First Author. First title. 1',
      '2. Last Author. Last title. In ICCV, 2019. 2 ## Supplementary Material ## A. Dataset details',
      '3. False body item created from appendix text.',
    ].join('\n');

    expect(normalizeReferenceList(markdown)).toBe(
      [
        '## References',
        '',
        '1. First Author. First title. 1',
        '2. Last Author. Last title. In ICCV, 2019. 2',
      ].join('\n')
    );
  });
});

describe('repairEquationBlocks', () => {
  test('leaves label-only and reference-heading context unchanged', () => {
    const labelOnly = ['This longer sentence has no equation context.', '(1)'].join('\n');
    expect(repairEquationBlocks(labelOnly)).toBe(labelOnly);

    const referenceHeading = ['References', 'E = mc^2 (2)'].join('\n');
    expect(repairEquationBlocks(referenceHeading)).toBe(referenceHeading);
  });

  test('wraps split equation blocks with labels in GitHub display math', () => {
    const markdown = ['∆x =', 'xg − xa', 'da', ', (1)', '', 'where da is the diagonal.'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      [
        '',
        '$$',
        '\\begin{aligned}',
        '\\Delta x = \\\\',
        'xg - xa \\\\',
        'da',
        '\\end{aligned}',
        '\\tag{1}',
        '$$',
        '',
        'where da is the diagonal.',
      ].join('\n')
    );
  });

  test('keeps blank-separated equation fragments in one display math block', () => {
    const markdown = [
      'Lcontr^ =',
      '',
      '1',
      '',
      '|Pos||Neg|',
      '',
      '∑',
      '',
      'i∈Pos',
      '',
      '(14)',
    ].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      [
        '',
        '$$',
        '\\begin{aligned}',
        'Lcontr^ = \\\\',
        '1 \\\\',
        '|Pos||Neg| \\\\',
        '\\sum \\\\',
        'i\\in Pos',
        '\\end{aligned}',
        '\\tag{14}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('does not include page breaks or prose prefixes inside display math', () => {
    const markdown = [
      'Intro sentence: Ldist^ = BCE(Dfeat, K)',
      '<!-- PAGE_BREAK -->',
      '(11)',
      '',
      'Next paragraph.',
    ].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      ['', '$$', 'Ldist^ = BCE(Dfeat, K)', '\\tag{11}', '$$', '', 'Next paragraph.'].join('\n')
    );
  });

  test('does not wrap numbered references as equations', () => {
    const markdown = ['## References', '', '[1] A. Author. Title.'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(markdown);
  });

  test('leaves equation-like lines inside fenced blocks unchanged', () => {
    const markdown = ['```text', 'E = mc^2 (1)', '```', '', 'Body.'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(markdown);
  });

  test('leaves existing display math blocks unchanged', () => {
    const markdown = [
      '$$',
      '\\begin{aligned}',
      'AP = 100 \\\\',
      '\\tag{5}',
      '\\end{aligned}',
      '$$',
    ].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(markdown);
  });

  test('stops split equation recovery at figure captions and structural headings', () => {
    const figureCaptionBeforeEquation = ['Fig. 2. Pipeline overview.', 'E = mc^2', '(1)'].join(
      '\n'
    );
    const structuralLineBeforeEquation = ['## Method', 'E = mc^2', '(2)'].join('\n');
    const tableCaptionBeforeEquation = ['Table 1. Metrics.', 'E = mc^2', '(3)'].join('\n');

    expect(repairEquationBlocks(figureCaptionBeforeEquation)).toBe(
      ['Fig. 2. Pipeline overview.', '', '$$', 'E = mc^2', '\\tag{1}', '$$', ''].join('\n')
    );
    expect(repairEquationBlocks(structuralLineBeforeEquation)).toBe(
      ['## Method', '', '$$', 'E = mc^2', '\\tag{2}', '$$', ''].join('\n')
    );
    expect(repairEquationBlocks(tableCaptionBeforeEquation)).toBe(
      ['Table 1. Metrics.', '', '$$', 'E = mc^2', '\\tag{3}', '$$', ''].join('\n')
    );
  });

  test('stops split equation recovery at ordinary prose', () => {
    const markdown = ['This prose line is not equation context.', 'E = mc^2', '(3)'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      ['This prose line is not equation context.', '', '$$', 'E = mc^2', '\\tag{3}', '$$', ''].join(
        '\n'
      )
    );
  });

  test('extracts equation suffixes from prose-like lines without colons', () => {
    const markdown = 'This explanatory prefix is intentionally long enough that E = mc^2 (4)';

    expect(repairEquationBlocks(markdown)).toBe(
      [
        'This explanatory prefix is intentionally long enough that',
        '',
        '$$',
        'E = mc^2',
        '\\tag{4}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('extracts equation suffixes from multi-line prose context', () => {
    const markdown = [
      'This explanatory prefix is intentionally long enough that E = mc^2',
      '(14)',
    ].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      ['', '$$', 'E = mc^2', '\\tag{14}', '$$', ''].join('\n')
    );
  });

  test('extracts equation suffixes after colon prefixes in multi-line context', () => {
    const markdown = ['The equation is: E = mc^2', '(15)'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      ['', '$$', 'E = mc^2', '\\tag{15}', '$$', ''].join('\n')
    );
  });

  test('keeps full equation lines when suffix extraction is low confidence', () => {
    const shortPrefix = ['Short E = mc^2', '(16)'].join('\n');
    expect(repairEquationBlocks(shortPrefix)).toBe(
      ['', '$$', 'Short E = mc^2', '\\tag{16}', '$$', ''].join('\n')
    );

    const longSuffix = [
      `This prefix has enough words before ${'E = '.padEnd(130, 'x')}`,
      '(17)',
    ].join('\n');
    expect(repairEquationBlocks(longSuffix)).toBe(longSuffix);

    const proseSuffix = [
      'This prefix has enough words before E = this equation has far too many natural language words',
      '(18)',
    ].join('\n');
    expect(repairEquationBlocks(proseSuffix)).toBe(proseSuffix);
  });

  test('keeps overlong equation-like inline formulas when they start the line', () => {
    const markdown = `${'E = '.padEnd(130, 'x')} (19)`;

    expect(repairEquationBlocks(markdown)).toBe(
      [
        '',
        '$$',
        'E = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        '\\tag{19}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('splits inline labelled equations into prose and GitHub display math', () => {
    const markdown = [
      'We design a linear combination: D = DMah + alpha * Dfeat, (8) where DMah is the Mahalanobis distance.',
      'Direction prediction starts after this formula L = alpha * Lvar + beta * Ldist. (5) Direction prediction.',
      'L = alpha * Lvar + beta * Ldist. (6) Direction prediction follows.',
    ].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      [
        'We design a linear combination:',
        '',
        '$$',
        'D = DMah + alpha * Dfeat',
        '\\tag{8}',
        '$$',
        '',
        'where DMah is the Mahalanobis distance.',
        'Direction prediction starts after this formula',
        '',
        '$$',
        'L = alpha * Lvar + beta * Ldist',
        '\\tag{5}',
        '$$',
        '',
        'Direction prediction.',
        '',
        '$$',
        'L = alpha * Lvar + beta * Ldist',
        '\\tag{6}',
        '$$',
        '',
        'Direction prediction follows.',
      ].join('\n')
    );
  });

  test('splits inline labelled equations with comma-bearing identifiers', () => {
    const markdown =
      'The max-margin loss is Lcontri,j = max(0, Ccontr − (di − dj)), (13) where the margin is fixed.';

    expect(repairEquationBlocks(markdown)).toBe(
      [
        'The max-margin loss is',
        '',
        '$$',
        'Lcontri,j = max(0, Ccontr - (di - dj))',
        '\\tag{13}',
        '$$',
        '',
        'where the margin is fixed.',
      ].join('\n')
    );
  });

  test('leaves weak inline equation candidates unchanged', () => {
    const noAssignmentBeforeLabel =
      'This sentence is long enough and has x = y after the label (7) so it should remain prose.';
    const tooManyWordsInEquation =
      'This explanatory prefix is intentionally long enough that E = this equation has far too many natural language words to be math (8)';

    expect(repairEquationBlocks([noAssignmentBeforeLabel, tooManyWordsInEquation].join('\n'))).toBe(
      [noAssignmentBeforeLabel, tooManyWordsInEquation].join('\n')
    );
  });

  test('normalizes common PDF math glyphs into GitHub-compatible latex', () => {
    const markdown = '∆x = ∑ √ ∫ ≤ ≥ ≈ ± − × ÷ ∈ ∪ ∞ α β γ θ λ μ π \u000f (5)';

    expect(repairEquationBlocks(markdown)).toBe(
      [
        '',
        '$$',
        '\\Delta x = \\sum \\sqrt \\int \\le \\ge \\approx \\pm - \\times \\div \\in \\cup \\infty \\alpha \\beta \\gamma \\theta \\lambda \\mu \\pi \\epsilon',
        '\\tag{5}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('does not extract non-math colon suffixes as equations', () => {
    const markdown = ['The nearby context has a colon: not math', 'E = mc^2', '(6)'].join('\n');

    expect(repairEquationBlocks(markdown)).toBe(
      ['The nearby context has a colon: not math', '', '$$', 'E = mc^2', '\\tag{6}', '$$', ''].join(
        '\n'
      )
    );
  });

  test('keeps short equation prefixes and long suffixes when extracting equation lines', () => {
    const shortPrefix = 'Loss E = mc^2 (10)';
    expect(repairEquationBlocks(shortPrefix)).toBe(
      ['', '$$', 'Loss E = mc^2', '\\tag{10}', '$$', ''].join('\n')
    );

    const longSuffix = `This prefix has enough words before ${'E = '.padEnd(130, 'x')} (11)`;
    expect(repairEquationBlocks(longSuffix)).toBe(
      [
        'This prefix has enough words before',
        '',
        '$$',
        'E = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        '\\tag{11}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('stops equation context at previous labels and markdown structural lines', () => {
    const previousLabel = ['a = b (7)', 'c = d', '(8)'].join('\n');
    expect(repairEquationBlocks(previousLabel)).toBe(
      ['', '$$', 'a = b', '\\tag{7}', '$$', '', '$$', 'c = d', '\\tag{8}', '$$', ''].join('\n')
    );

    const tableBoundary = ['| A | B |', 'c = d', '(9)'].join('\n');
    expect(repairEquationBlocks(tableBoundary)).toBe(
      ['| A | B |', '', '$$', 'c = d', '\\tag{9}', '$$', ''].join('\n')
    );
  });

  test('ignores overlong and reference-heading equation context candidates', () => {
    const overlong = [`${'x = '.padEnd(130, 'a')}`, 'E = mc^2', '(12)'].join('\n');
    expect(repairEquationBlocks(overlong)).toBe(
      [`${'x = '.padEnd(130, 'a')}`, '', '$$', 'E = mc^2', '\\tag{12}', '$$', ''].join('\n')
    );

    const referenceContext = ['References and equations', 'E = mc^2', '(13)'].join('\n');
    expect(repairEquationBlocks(referenceContext)).toBe(referenceContext);
  });
});

describe('normalizeDisplayMathBlocks', () => {
  test('outdents display math delimiters and body lines after formatting', () => {
    const markdown = [
      '- Metric definition:',
      '     $$',
      '     \\begin{aligned}',
      '     E = mc^2',
      '     \\tag{1}',
      '     $$',
      '',
      'Body.',
    ].join('\n');

    expect(normalizeDisplayMathBlocks(markdown)).toBe(
      [
        '- Metric definition:',
        '$$',
        '\\begin{aligned}',
        'E = mc^2',
        '\\tag{1}',
        '$$',
        '',
        'Body.',
      ].join('\n')
    );
  });

  test('leaves non-math indentation untouched', () => {
    const markdown = ['Paragraph.', '    code = true', '', '$$', '  x = y', '$$'].join('\n');

    expect(normalizeDisplayMathBlocks(markdown)).toBe(
      ['Paragraph.', '    code = true', '', '$$', 'x = y', '$$'].join('\n')
    );
  });
});

describe('addFigureSourceLinks', () => {
  test('returns unchanged without layout or matching figure pages', () => {
    expect(addFigureSourceLinks('Fig. 1. Caption.')).toBe('Fig. 1. Caption.');
    expect(
      addFigureSourceLinks('Fig. 1. Caption.', 'No figure captions here.', '/tmp/Paper.pdf')
    ).toBe('Fig. 1. Caption.');
  });

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

    const sentencePrefix = 'The method is complete. Figure 3. We discuss it next.';
    expect(addFigureSourceLinks(sentencePrefix, sentencePrefix, '/tmp/Paper.pdf')).toBe(
      sentencePrefix
    );
  });

  test('does not duplicate existing figure source links or add links for unmatched captions', () => {
    const markdown = [
      'Fig. 2. Architecture overview.',
      '',
      '> Figure source: [PDF page 2](../pdf/Paper.pdf#page=2)',
      '',
      'Fig. 3. Missing in layout.',
    ].join('\n');
    const layout = ['page one', '\f', 'Fig. 2. Architecture overview.'].join('\n');

    expect(addFigureSourceLinks(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(markdown);
  });

  test('adds source links for prefixed subfigure captions', () => {
    const markdown = '(a) (b) Fig. 4. Qualitative comparison.';
    const layout = '(a) (b) Fig. 4. Qualitative comparison.';

    expect(addFigureSourceLinks(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        '(a) (b) Fig. 4. Qualitative comparison.',
        '',
        '> Figure source: [PDF page 1](../pdf/Paper.pdf#page=1)',
      ].join('\n')
    );
  });

  test('adds source links for short figure title prefixes', () => {
    const markdown = 'Overview Figure 7. Critical points and upper bound shape.';
    const layout = 'Overview Figure 7. Critical points and upper bound shape.';

    expect(addFigureSourceLinks(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'Overview Figure 7. Critical points and upper bound shape.',
        '',
        '> Figure source: [PDF page 1](../pdf/Paper.pdf#page=1)',
      ].join('\n')
    );
  });
});

describe('addMissingSourcePlaceholders', () => {
  test('returns unchanged without layout or pdf path and does not duplicate figure placeholders', () => {
    expect(addMissingSourcePlaceholders('Body.')).toBe('Body.');

    const markdown =
      'Figure 1. Source figure not extracted; see [PDF page 1](../pdf/Paper.pdf#page=1).';
    const layout = 'Figure 1. Overview.';
    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      markdown
    );
  });

  test('adds source figures and recovered equations absent from Markdown', () => {
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
        '$$',
        'x = y + z',
        '\\tag{1}',
        '$$',
        '<!-- PAGE_BREAK -->',
        'Second page text.',
        '',
        'Figure 2. Source figure not extracted; see [PDF page 2](../pdf/Paper.pdf#page=2).',
        '',
      ].join('\n')
    );
  });

  test('does not duplicate existing tagged or legacy equation placeholders', () => {
    const layout = ['x = y + z (1)', 'a = b + c (2)'].join('\n');
    const markdown = [
      '$$',
      'x = y + z',
      '\\tag{1}',
      '$$',
      '',
      'Equation source = PDF page 1 (2)',
    ].join('\n');

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      markdown
    );
  });

  test('adds recovered display math when a raw equation label was not converted to display math', () => {
    const markdown = 'The parser left x = y + z (3) inside prose.';
    const layout = 'x = y + z (3)';

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'The parser left x = y + z (3) inside prose.',
        '',
        '$$',
        'x = y + z',
        '\\tag{3}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('ignores isolated equation labels with no nearby equation evidence', () => {
    const markdown = 'Intro text.';
    const layout = ['(1)', '', 'Body text.'].join('\n');

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      markdown
    );
  });

  test('recovers split missing equations from local layout text', () => {
    const markdown = 'The parser missed the display equation.';
    const layout = ['L =', '∑', 'p∈pos', 'loss(p) (4)'].join('\n');

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'The parser missed the display equation.',
        '',
        '$$',
        '\\begin{aligned}',
        'L = \\\\',
        '\\sum \\\\',
        'p\\in pos \\\\',
        'loss(p)',
        '\\end{aligned}',
        '\\tag{4}',
        '$$',
        '',
      ].join('\n')
    );
  });

  test('separates generated placeholders from a trailing references section', () => {
    const markdown = ['## References', '', '1. A. Author. Title.'].join('\n');
    const layout = 'Figure 6. Appendix figure.';

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        '## References',
        '',
        '1. A. Author. Title.',
        '',
        '## Extracted Source Placeholders',
        '',
        'Figure 6. Source figure not extracted; see [PDF page 1](../pdf/Paper.pdf#page=1).',
        '',
      ].join('\n')
    );
  });

  test('appends later-page placeholders to the last available section', () => {
    const markdown = ['Intro text.', '<!-- PAGE_BREAK -->', 'Second page text.'].join('\n');
    const layout = ['page 1', '\f', 'page 2', '\f', 'Figure 9. Third page figure.'].join('\n');

    expect(addMissingSourcePlaceholders(markdown, layout, '/tmp/papers/pdf/Paper.pdf')).toBe(
      [
        'Intro text.',
        '<!-- PAGE_BREAK -->',
        'Second page text.',
        '',
        'Figure 9. Source figure not extracted; see [PDF page 3](../pdf/Paper.pdf#page=3).',
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

  test('keeps blanks around structural, caption, and equation-like lines', () => {
    const markdown = [
      'Paragraph before.',
      '',
      '| A | B |',
      '',
      'Fig. 1. Caption.',
      '',
      'E = mc^2',
      '',
      'plain continuation',
    ].join('\n');

    expect(repairLooseLineSpacing(markdown)).toBe(markdown);
  });

  test('keeps blanks when either paragraph side is empty', () => {
    const markdown = ['Paragraph before.', '', '', 'Paragraph after.'].join('\n');

    expect(repairLooseLineSpacing(markdown)).toBe(markdown);
  });

  test('keeps blanks before table captions and after completed sentences', () => {
    const markdown = ['Previous sentence.', '', 'Next Sentence.', '', 'Table 1. Caption.'].join(
      '\n'
    );

    expect(repairLooseLineSpacing(markdown)).toBe(markdown);
  });
});

describe('removeDuplicateMarkdownTables', () => {
  test('removes exact repeated Markdown table blocks', () => {
    const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const markdown = [table, '', 'Paragraph.', '', 'More text far away.', '', table].join('\n');

    expect(removeDuplicateMarkdownTables(markdown)).toBe(
      [table, '', 'Paragraph.', '', 'More text far away.'].join('\n')
    );
  });

  test('removes duplicate table blocks after captions', () => {
    const table = [
      '| Method | Type | MOTA |',
      '| --- | --- | --- |',
      '| SORT | Online | 33.4 |',
    ].join('\n');
    const markdown = ['Table 2. Performance.', '', table, '', table, '', 'Body.'].join('\n');

    expect(removeDuplicateMarkdownTables(markdown)).toBe(
      ['Table 2. Performance.', '', table, '', 'Body.'].join('\n')
    );
  });

  test('leaves non-table pipe rows and table-like rows without separators unchanged', () => {
    const markdown = ['| just | pipes |', 'not a separator', 'A | B', '1 | 2'].join('\n');

    expect(removeDuplicateMarkdownTables(markdown)).toBe(markdown);
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

  test('normalizes supplementary and numbered section heading variants', () => {
    const markdown = [
      '### S.2 More Results',
      '#### A. Appendix Details',
      '#### 2 Details Without Dot',
      '### 3. Main Section',
      '#### Ordinary heading',
    ].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      [
        '## S.2 More Results',
        '## A. Appendix Details',
        '2 Details Without Dot',
        '## 3. Main Section',
        'Ordinary heading',
      ].join('\n')
    );
  });

  test('normalizes abstract and reference heading levels', () => {
    const markdown = ['### Abstract', 'Body.', '### References'].join('\n');

    expect(repairMarkdownHeadings(markdown)).toBe(
      ['## Abstract', 'Body.', '## References'].join('\n')
    );
  });

  test('demotes h4 prose headings with punctuation and long text', () => {
    expect(repairMarkdownHeadings('#### this is prose.')).toBe('this is prose.');
    expect(repairMarkdownHeadings('#### This heading has enough words to be prose')).toBe(
      'This heading has enough words to be prose'
    );
    expect(repairMarkdownHeadings('## 123456 long numeric prose heading text')).toBe(
      '123456 long numeric prose heading text'
    );
  });

  test('keeps normal headings at their current level and ignores too-deep all-caps labels', () => {
    expect(repairMarkdownHeadings('### Method')).toBe('### Method');

    expect(repairMarkdownHeadings('##### ACKNOWLEDGEMENTS')).toBe('##### ACKNOWLEDGEMENTS');
  });

  test('keeps numbered-section prose from being demoted as a prose heading', () => {
    const markdown = '#### 4.1 This heading has many words but is numbered';

    expect(repairMarkdownHeadings(markdown)).toBe(
      '### 4.1 This heading has many words but is numbered'
    );
  });
});

describe('repairMarkdownTables', () => {
  test('leaves single-row, separator-only, long-cell, and prose-like candidates unchanged', () => {
    const singleRow = 'Metric | Value';
    expect(repairMarkdownTables(singleRow)).toBe(singleRow);

    const separatorOnly = ['--- | ---', ':--- | ---:'].join('\n');
    expect(repairMarkdownTables(separatorOnly)).toBe(separatorOnly);

    const longCell = [`Metric | ${'x'.repeat(81)}`, `Value | ${'y'.repeat(81)}`].join('\n');
    expect(repairMarkdownTables(longCell)).toBe(longCell);

    const prose = [
      'This sentence has  two spaces and enough words to be prose.',
      'Another sentence has  two spaces and enough words too.',
    ].join('\n');
    expect(repairMarkdownTables(prose)).toBe(prose);
  });

  test('leaves whitespace candidates with empty cells unchanged and repairs short aligned rows', () => {
    const emptyCell = ['Metric    ', 'Value     '].join('\n');
    expect(repairMarkdownTables(emptyCell)).toBe(emptyCell);

    const shortRows = ['A short  phrase', 'still not  table'].join('\n');
    expect(repairMarkdownTables(shortRows)).toBe(
      ['| A short | phrase |', '| --- | --- |', '| still not | table |'].join('\n')
    );
  });

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

  test('keeps already escaped literal pipes in table cells', () => {
    const markdown = ['Model  Notes', 'A\\|B    already escaped'].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      '| Model | Notes |\n| --- | --- |\n| A\\|B | already escaped |'
    );
  });

  test('flushes pending table blocks when candidate methods change', () => {
    const markdown = ['A | B', '1 | 2', 'Metric\tValue', 'Accuracy\t0.91'].join('\n');

    expect(repairMarkdownTables(markdown)).toBe(
      [
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '| Metric | Value |',
        '| --- | --- |',
        '| Accuracy | 0.91 |',
      ].join('\n')
    );
  });
});
