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

  test('counts Markdown table captions embedded in or immediately after table rows', async () => {
    writePaper(
      'embedded-caption-table',
      [
        '| Method | Score |',
        '| --- | --- |',
        '| A | 1 | Table 1. Inline caption |',
        '',
        '| RoIs | Recall |',
        '| --- | --- |',
        '| 10 | 86.0 |',
        'Table 2. Caption after repaired table.',
      ].join('\n')
    );
    const layout = [
      'Method       Score',
      'A                1',
      'Table 1. Inline caption',
      '',
      'RoIs        Recall',
      '10            86.0',
      'Table 2. Caption after repaired table.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].markdownTableNumbers).toEqual(['1', '2']);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
    expect(report.papers[0].metrics.tableCoverageScore).toBe(1);
  });

  test('counts Markdown table captions that appear immediately before rendered tables', async () => {
    writePaper(
      'caption-before-table',
      ['Table 1. Results by method.', '', '| Method | Score |', '| --- | --- |', '| A | 1 |'].join(
        '\n'
      )
    );
    const layout = ['Table 1. Results by method.', 'Method       Score', 'A                1'].join(
      '\n'
    );

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].markdownTableNumbers).toEqual(['1']);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
    expect(report.papers[0].metrics.tableCoverageScore).toBe(1);
  });

  test('counts table captions after dense table evidence fragments', async () => {
    writePaper(
      'fragment-table-caption',
      [
        '| Method | Easy | Moderate | Hard |',
        '| --- | --- | --- | --- |',
        '| A | 71.29 | 62.68 | 56.56 | | B | 81.98 |',
        '65.46 | 62.85 | 20 | - | - | 91.83 | 32.55 |',
        'Table 2. Performance comparison.',
      ].join('\n')
    );
    const layout = [
      'Method        Easy   Moderate   Hard',
      'A             71.29  62.68      56.56',
      'B             81.98  65.46      62.85',
      'Table 2. Performance comparison.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].markdownTableNumbers).toEqual(['2']);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
  });

  test('counts table captions before dense table evidence fragments', async () => {
    writePaper(
      'caption-before-fragment-table',
      [
        'Table 5. Ablation metrics.',
        '',
        'Ablation KDE NLL FDE ML @1s @2s @3s @4s 0.81 0.05 0.37 0.87 0.18 0.57 1.25 2.24',
      ].join('\n')
    );
    const layout = [
      'Table 5. Ablation metrics.',
      'Ablation      KDE NLL       FDE ML',
      'base          0.81 0.05     0.18 0.57',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].markdownTableNumbers).toEqual(['5']);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
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

  test('does not count figure flowchart labels as source tables', async () => {
    writePaper('flowchart-page', ['## Method', '', 'Fig. 1. Algorithm flowchart.'].join('\n'));
    const layout = [
      'Frame t                              Feature Fusion Module',
      'LiDAR Point Cloud                   Camera Image',
      '3D Object Detector                  G1: MLP + Reshape      Nx512x3x3',
      'Detections                          Projection',
      'Fused Features                      Distance Combination Module',
      'Mahalanobis Distance                G2: Conv + MLP         NxM',
      'Track Predictions                   Track Initialization Module',
      'Kalman Filter Predict               Kalman Filter Update',
      'NxMx1024x3x3                        Nx512x3x3              Nx1',
      'Fig. 1: Algorithm Flowchart. The modules are shown.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('does not count equation-heavy matrix pages as unnumbered source tables', async () => {
    writePaper('equation-matrix-page', ['## Appendix', '', 'Equation block.'].join('\n'));
    const layout = [
      'The following dynamics are',
      ' x(t+1)     x(t)     v cos(phi) ',
      ' y(t+1)  =  y(t)  +  v sin(phi) ',
      ' phi(t+1)   phi(t)   omega      ',
      '(11)',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('counts right-column table captions merged with left-column prose', async () => {
    writePaper(
      'right-column-caption',
      ['## Results', '', '| Transform | Accuracy |', '| --- | --- |', '| none | 87.1 |'].join('\n')
    );
    const layout = [
      'left column prose before the caption             Transform              accuracy',
      'more unrelated left-column prose                 none                      87.1',
      'continued left-column prose                      input (3x3)               87.9',
      'The baselines discussed above                    Table 5. Effects of input transforms.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceTablesByPage).toEqual([
      { page: 1, count: 1, tableNumbers: ['5'] },
    ]);
  });

  test('does not count ordinary prose mentions of numbered tables as captions', async () => {
    writePaper('prose-table-mention', ['## Results', '', 'Body text.'].join('\n'));
    const layout = [
      'The architecture choices are summarized in Table 5. This sentence is not a caption.',
      'We compare against the values shown in Table 6. and discuss the trend.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('does not count chart axis label clusters as unnumbered source tables', async () => {
    writePaper('chart-axis-page', ['## Results', '', 'Figure 6. Robustness.'].join('\n'));
    const layout = [
      '100                                                      100                                      90',
      '90                                                       90',
      'Accuracy (%)                                             Accuracy (%)                             Accuracy (%)',
      '80                                                       80                                      80',
      '70                                                       70                                      70',
      '60       Furthest                                        60        XYZ                           60',
      '50       Random                                          50        XYZ+density                   50',
      '0  0.2   0.4    0.6     0.8   1                        0.1  0.2  0.3  0.4  0.5                0  0.05  0.1',
      'Missing data ratio                                       Outlier ratio                            Perturbation noise std',
      'Figure 6. PointNet robustness test.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalSourceTables).toBe(0);
    expect(report.papers[0].sourceTablesByPage).toEqual([{ page: 1, count: 0, tableNumbers: [] }]);
  });

  test('scores chart captions, numbered equations, references, and agent readability', async () => {
    writePaper(
      'paper-health',
      [
        '## Abstract',
        '',
        'Readable abstract.',
        '',
        'Figure 1. Pipeline overview.',
        '',
        'mAP = AP_easy + AP_hard',
        '(1)',
        '',
        '## References',
        '',
        '[1] First Author. Title.',
        '[2] Second Author. Title.',
      ].join('\n')
    );
    const layout = [
      'Figure 1. Pipeline overview.',
      '',
      'mAP = AP_easy + AP_hard',
      '(1)',
      '',
      'References',
      '[1] First Author. Title.',
      '[2] Second Author. Title.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary).toMatchObject({
      totalSourceCharts: 1,
      totalMissingMarkdownCharts: 0,
      totalSourceEquations: 1,
      totalMissingMarkdownEquations: 0,
      totalSourceReferences: 2,
      totalMarkdownReferences: 2,
    });
    expect(report.papers[0]).toMatchObject({
      sourceChartsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
      sourceChartNumbers: ['1'],
      markdownChartNumbers: ['1'],
      missingMarkdownCharts: [],
      sourceEquationsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
      sourceEquationNumbers: ['1'],
      markdownEquationNumbers: ['1'],
      missingMarkdownEquations: [],
      sourceReferenceCount: 2,
      markdownReferenceCount: 2,
    });
    expect(report.papers[0].metrics).toMatchObject({
      chartCoverageScore: 1,
      equationCoverageScore: 1,
      referenceCoverageScore: 1,
      agentReadabilityScore: 1,
    });
  });

  test('does not count post-reference figure placeholders as references', async () => {
    writePaper(
      'references-with-trailing-placeholders',
      [
        '## References',
        '',
        '1. First Author. Title.',
        '2. Second Author. Title.',
        '',
        'Figure 6. Source figure not extracted; see [PDF page 11](../pdf/Paper.pdf#page=11).',
        '',
        '> Figure source: [PDF page 11](../pdf/Paper.pdf#page=11)',
        '',
        '1. Appendix step that should not count as a reference.',
      ].join('\n')
    );
    const layout = ['References', '1. First Author. Title.', '2. Second Author. Title.'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.summary.totalMarkdownReferences).toBe(2);
    expect(report.papers[0].markdownReferenceCount).toBe(2);
    expect(report.papers[0].metrics.referenceCoverageScore).toBe(1);
  });

  test('counts figure captions with subfigure or short title prefixes', async () => {
    writePaper(
      'prefixed-figures',
      [
        '## Results',
        '',
        '(a) (b) Fig. 4. Qualitative comparison.',
        'Upper-bound Shapes Figure 7. Critical points and upper bound shape.',
      ].join('\n')
    );
    const layout = [
      '(a) (b) Fig. 4. Qualitative comparison.',
      'Upper-bound Shapes Figure 7. Critical points and upper bound shape.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceChartNumbers).toEqual(['4', '7']);
    expect(report.papers[0].markdownChartNumbers).toEqual(['4', '7']);
    expect(report.papers[0].missingMarkdownCharts).toEqual([]);
  });

  test('counts numbered equations that use set/cardinality bars', async () => {
    writePaper(
      'cardinality-equation',
      ['## Metric', '', 'Jaccard =', '', '|TP|', '', '|TP| + |FN| + |FP|', '', '(1)'].join('\n')
    );
    const layout = ['Jaccard =', '|TP|', '|TP| + |FN| + |FP|', '(1)'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['1']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['1']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts equation labels with leading punctuation and trailing where clauses', async () => {
    writePaper(
      'punctuated-equation',
      ['## Metric', '', 'V = A + B, (2)', '', 'F = m a (3) where m is mass'].join('\n')
    );
    const layout = ['V = A + B, (2)', 'F = m a (3) where m is mass'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['2', '3']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['2', '3']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts GitHub display math tags as Markdown equation labels', async () => {
    writePaper('tagged-equation', ['## Metric', '', '$$', 'E = mc^2', '\\tag{1}', '$$'].join('\n'));
    const layout = 'E = mc^2 (1)';

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['1']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['1']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts tagged display math placeholders as Markdown equation labels', async () => {
    writePaper(
      'tagged-placeholder',
      [
        '## Metric',
        '',
        '$$',
        '\\text{Equation not extracted; see PDF page 1}',
        '\\tag{2}',
        '$$',
      ].join('\n')
    );
    const layout = 'A = B + C (2)';

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].markdownEquationNumbers).toEqual(['2']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts multiple inline equation labels in one math line', async () => {
    writePaper(
      'inline-equations',
      [
        '## Coordinates',
        '',
        'range = sqrt(x^2 + y^2 + z^2) (1) azimuth = atan2(y, x) (2) inclination = atan2(z, sqrt(x^2 + y^2)) (3)',
      ].join('\n')
    );
    const layout =
      'range = sqrt(x^2 + y^2 + z^2) (1) azimuth = atan2(y, x) (2) inclination = atan2(z, sqrt(x^2 + y^2)) (3)';

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['1', '2', '3']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['1', '2', '3']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts equation labels after tall split equation blocks', async () => {
    writePaper(
      'split-equation',
      [
        '## Method',
        '',
        'L( binp) =',
        '',
        '∑',
        '',
        'u∈{x,z,θ}',
        '',
        '(Fcls(bin̂ u, bin u) + Freg(reŝ u, res u)), (3)',
      ].join('\n')
    );
    const layout = [
      'L( binp) =',
      '∑',
      'u∈{x,z,θ}',
      '(Fcls(bin̂ u, bin u) + Freg(reŝ u, res u)), (3)',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['3']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['3']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('counts split equation labels on their own line', async () => {
    writePaper(
      'own-line-equation-label',
      ['## Method', '', 'Lreg =', '', '1', '', 'Npos', '', '∑', '', 'p∈pos', '', '(4)'].join('\n')
    );
    const layout = ['Lreg =', '1', 'Npos', '∑', 'p∈pos', '(4)'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceEquationNumbers).toEqual(['4']);
    expect(report.papers[0].markdownEquationNumbers).toEqual(['4']);
    expect(report.papers[0].metrics.equationCoverageScore).toBe(1);
  });

  test('reports agent readability issues and parser suggestions for hard-to-read markdown', async () => {
    writePaper(
      'hard-to-read',
      [
        '## Abstract',
        '',
        `Table 1. ${'Results Alpha 1 Beta 2 Gamma 3 Delta 4 Epsilon 5 '.repeat(5)}`,
        '',
        '##### wrapped body text was incorrectly emitted as a heading in the parser output',
        '',
        '## References',
        '',
        `[1] ${'Reference '.repeat(45)}`,
        `[2] ${'Reference '.repeat(45)}`,
        `[3] ${'Reference '.repeat(45)}`,
        `[4] ${'Reference '.repeat(45)}`,
      ].join('\n')
    );
    const layout = ['References', '[1] A.', '[2] B.', '[3] C.', '[4] D.'].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    const paper = report.papers[0];
    expect(paper.issues).toContain('agent-readability-issues');
    expect(paper.agentReadabilityIssues.length).toBeGreaterThan(0);
    expect(paper.parserImprovementSuggestions).toEqual(
      expect.arrayContaining([
        'Demote metadata, formulas, and wrapped prose that are incorrectly emitted as headings.',
        'split captions onto their own line and attach preceding table/figure evidence',
      ])
    );
    expect(paper.metrics.agentReadabilityScore).toBeLessThan(1);
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
    expect(paper.metrics.score).toBeLessThan(70);
  });

  test('does not flag coherent numbered h3 section sequences as metadata blocks', async () => {
    writePaper(
      'numbered-h3-sections',
      [
        '## Results',
        '',
        '### 5.1 Baselines',
        'Body.',
        '### 5.2 Tracking',
        'Body.',
        '### 5.3 Domain Gap',
        'Body.',
        '### 5.4 Dataset Size',
        'Body.',
      ].join('\n')
    );

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue('Results body.'),
    });

    expect(report.papers[0].headingIssues).toEqual([]);
    expect(report.papers[0].metrics.headingFlowScore).toBe(1);
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

  test('deduplicates continued numbered table captions for coverage', async () => {
    writePaper(
      'continued-table',
      ['## Results', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'Table 2. Results.'].join(
        '\n'
      )
    );
    const layout = [
      'A   B',
      '1   2',
      'Table 2. Results.',
      '\f',
      'A   B',
      '3   4',
      'Table 2. continued.',
    ].join('\n');

    const report = await scoreMarkdownQuality({
      paperPath: pdfDir,
      markdownPath: markdownDir,
      readPdfLayout: jest.fn().mockResolvedValue(layout),
    });

    expect(report.papers[0].sourceTablesByPage).toEqual([
      { page: 1, count: 1, tableNumbers: ['2'] },
      { page: 2, count: 1, tableNumbers: ['2'] },
    ]);
    expect(report.papers[0].sourceTableNumbers).toEqual(['2']);
    expect(report.papers[0].missingMarkdownTables).toEqual([]);
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
