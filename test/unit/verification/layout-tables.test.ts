import { execFile } from 'child_process';

import {
  extractPdfLayoutText,
  repairMarkdownTablesWithLayout,
} from '../../../src/verification/layout-tables';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

describe('repairMarkdownTablesWithLayout', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('extracts layout text with pdftotext and returns undefined on errors', async () => {
    jest.mocked(execFile).mockImplementationOnce(((
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(null, 'layout text');
      return undefined;
    }) as never);

    await expect(extractPdfLayoutText('/tmp/paper.pdf')).resolves.toBe('layout text');
    expect(execFile).toHaveBeenCalledWith(
      'pdftotext',
      ['-layout', '/tmp/paper.pdf', '-'],
      { maxBuffer: 50 * 1024 * 1024 },
      expect.any(Function)
    );

    jest.mocked(execFile).mockImplementationOnce(((
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string) => void
    ) => {
      callback(new Error('missing binary'), '');
      return undefined;
    }) as never);

    await expect(extractPdfLayoutText('/tmp/missing.pdf')).resolves.toBeUndefined();
  });

  test('leaves markdown unchanged without layout text or matching layout tables', () => {
    expect(repairMarkdownTablesWithLayout('Table 1. Caption.')).toBe('Table 1. Caption.');
    expect(repairMarkdownTablesWithLayout('No captions here.', 'Plain layout text.')).toBe(
      'No captions here.'
    );
  });

  test('leaves markdown unchanged when the caption has no matching layout table', () => {
    const markdown = 'Table 2. Missing from layout.';
    const layout = [
      'Table 1. Different table.',
      'Metric       Value',
      'A                1',
      'B                2',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(markdown);
  });

  test('splits non-table text before a below-caption table', () => {
    const markdown = 'Intro sentence before caption. Table 1. Scores.';
    const layout = [
      'Table 1. Scores.',
      'Metric       Value',
      'A                1',
      'B                2',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Intro sentence before caption.',
        '',
        'Table 1. Scores.',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
      ].join('\n')
    );
  });

  test('keeps emphasis-only prefixes attached to below-caption tables', () => {
    const markdown = '**Table 1. Scores.';
    const layout = [
      'Table 1. Scores.',
      'Metric       Value',
      'A                1',
      'B                2',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '**Table 1. Scores.',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
      ].join('\n')
    );
  });

  test('does not replace an existing markdown table before a caption', () => {
    const markdown = ['| Already | Table |', 'Table 1. Scores.'].join('\n');
    const layout = [
      'Metric       Value',
      'A                1',
      'B                2',
      'Table 1. Scores.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(markdown);
  });

  test('uses a fallback crop when a side-column table has no numeric start evidence', () => {
    const rowPrefix = ' '.repeat(38);
    const captionPrefix = ' '.repeat(46);
    const markdown = [
      'Method Type Status Alpha Online Ready Beta Batch Done Gamma Offline Draft',
      'Table 1. Side column states.',
    ].join('\n');
    const layout = [
      `${rowPrefix}Method       Type       Status`,
      `${rowPrefix}Alpha        Online     Ready`,
      `${rowPrefix}Beta         Batch      Done`,
      `${rowPrefix}Gamma        Offline    Draft`,
      '',
      `${captionPrefix}Table 1. Side column states.`,
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Type | Status |',
        '| --- | --- | --- |',
        '| Alpha | Online | Ready |',
        '| Beta | Batch | Done |',
        '| Gamma | Offline | Draft |',
        'Table 1. Side column states.',
      ].join('\n')
    );
  });

  test('stops collecting above-caption rows at prior captions and long blank gaps', () => {
    const longGapLayout = [
      'Metric       Value',
      'A                1',
      'B                2',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Table 1. Long blank gap.',
    ].join('\n');

    expect(
      repairMarkdownTablesWithLayout(
        'Metric Value A 1 B 2\nTable 1. Long blank gap.',
        longGapLayout
      )
    ).toBe(
      [
        '| Metric | Value |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
        'Table 1. Long blank gap.',
      ].join('\n')
    );

    const priorCaptionLayout = [
      'Table 1. Previous table.',
      'Metric       Value',
      'A                1',
      'B                2',
      'Table 2. Current table.',
    ].join('\n');

    expect(
      repairMarkdownTablesWithLayout(
        'Metric Value A 1 B 2\nTable 2. Current table.',
        priorCaptionLayout
      )
    ).toBe(
      [
        '| Metric | Value |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
        'Table 2. Current table.',
      ].join('\n')
    );
  });

  test('stops above-caption collection at an internal blank when no crop is needed', () => {
    const markdown = ['Metric Value A 1 B 2', 'Table 1. Internal blank.'].join('\n');
    const layout = [
      'Metric       Value',
      'A                1',
      '',
      'B                2',
      'Table 1. Internal blank.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(markdown);
  });

  test('stops above-caption side-column collection after a wide internal blank gap', () => {
    const prefix = ' '.repeat(40);
    const captionPrefix = ' '.repeat(46);
    const markdown = ['Method Score Alpha 1 Beta 2', 'Table 1. Side gap.'].join('\n');
    const layout = [
      `${prefix}Old          0`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `${prefix}Method       Score`,
      `${prefix}Alpha            1`,
      `${prefix}Beta             2`,
      `${captionPrefix}Table 1. Side gap.`,
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Score |',
        '| --- | --- |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        'Table 1. Side gap.',
      ].join('\n')
    );
  });

  test('caps above-caption layout tables at forty rows', () => {
    const markdown = ['Metric Value A 1 B 2', 'Table 1. Many above rows.'].join('\n');
    const rows = Array.from({ length: 45 }, (_, index) => `R${index}              ${index}`);
    const layout = ['Metric       Value', ...rows, 'Table 1. Many above rows.'].join('\n');

    const result = repairMarkdownTablesWithLayout(markdown, layout);
    expect(result).toContain('| R44 | 44 |');
    expect(result).not.toContain('| R4 | 4 |');
  });

  test('stops indented crop inference at a prior caption', () => {
    const prefix = ' '.repeat(40);
    const captionPrefix = ' '.repeat(46);
    const markdown = ['Method Score Alpha 1 Beta 2', 'Table 2. Current side table.'].join('\n');
    const layout = [
      `${prefix}Other        9`,
      `${captionPrefix}Table 1. Previous side table.`,
      `${prefix}Method       Score`,
      `${prefix}Alpha            1`,
      `${prefix}Beta             2`,
      `${captionPrefix}Table 2. Current side table.`,
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Score |',
        '| --- | --- |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        'Table 2. Current side table.',
      ].join('\n')
    );
  });

  test('rejects weak below-caption blocks at section and paragraph boundaries', () => {
    const headingLayout = ['Table 1. Weak.', 'Metric       Value', 'A. Next section'].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 1. Weak.', headingLayout)).toBe('Table 1. Weak.');

    const paragraphLayout = [
      'Table 2. Weak.',
      'Metric       Value',
      'This paragraph has enough words to be normal prose and should stop.',
    ].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 2. Weak.', paragraphLayout)).toBe(
      'Table 2. Weak.'
    );

    const figureLayout = ['Table 3. Weak.', 'Metric       Value', 'Figure 1. Stop.'].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 3. Weak.', figureLayout)).toBe('Table 3. Weak.');
  });

  test('stops below-caption collection at section headings after enough rows and max row count', () => {
    const headingLayout = [
      'Table 1. Scores.',
      'Metric       Value',
      'A                1',
      'B                2',
      'References',
      '1. Reference entry.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout('Table 1. Scores.', headingLayout)).toBe(
      [
        'Table 1. Scores.',
        '',
        '| Metric | Value |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
      ].join('\n')
    );

    const manyRows = Array.from({ length: 45 }, (_, index) => `R${index}              ${index}`);
    const cappedLayout = ['Table 2. Many rows.', 'Metric       Value', ...manyRows].join('\n');
    const result = repairMarkdownTablesWithLayout('Table 2. Many rows.', cappedLayout);
    expect(result).toContain('| R38 | 38 |');
    expect(result).not.toContain('| R39 | 39 |');
  });

  test('rejects malformed layout blocks with no stable width or tabular body', () => {
    const unstableWidthLayout = [
      'A       B',
      'C       D       E',
      'F       G       H       I',
      'Table 1. Unstable.',
    ].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 1. Unstable.', unstableWidthLayout)).toBe(
      'Table 1. Unstable.'
    );

    const longCellLayout = [
      'Name       Description',
      'Alpha      this cell has far too many words for a categorical body row',
      'Beta       this cell also has far too many words for a categorical body row',
      'Gamma      this cell still has far too many words for a categorical body row',
      'Table 2. Long cells.',
    ].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 2. Long cells.', longCellLayout)).toBe(
      'Table 2. Long cells.'
    );

    const noBodyLayout = ['Metric       Value', 'Table 3. Header only.'].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 3. Header only.', noBodyLayout)).toBe(
      'Table 3. Header only.'
    );

    const tooFewCategoricalRows = [
      'Name       Value',
      'Alpha      Ready',
      'Beta       Done',
      'Table 4. Too few categorical rows.',
    ].join('\n');
    expect(
      repairMarkdownTablesWithLayout('Table 4. Too few categorical rows.', tooFewCategoricalRows)
    ).toBe('Table 4. Too few categorical rows.');

    const proseOnlyLayout = [
      'This prose line has enough words to be removed before scoring',
      'Another prose line also has enough words to be removed',
      'Table 5. Prose only.',
    ].join('\n');
    expect(repairMarkdownTablesWithLayout('Table 5. Prose only.', proseOnlyLayout)).toBe(
      'Table 5. Prose only.'
    );
  });

  test('escapes pipe characters recovered from layout cells', () => {
    const markdown = ['Method Notes A 1|2 B 3|4', 'Table 1. Pipe cells.'].join('\n');
    const layout = [
      'Method       Notes',
      'A            1|2',
      'B            3|4',
      'Table 1. Pipe cells.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Notes |',
        '| --- | --- |',
        '| A | 1\\|2 |',
        '| B | 3\\|4 |',
        'Table 1. Pipe cells.',
      ].join('\n')
    );
  });

  test('keeps escaped pipe characters recovered from layout cells', () => {
    const markdown = ['Method Notes A 1\\|2 B 3\\|4', 'Table 1. Escaped pipe cells.'].join('\n');
    const layout = [
      'Method       Notes',
      'A            1\\|2',
      'B            3\\|4',
      'Table 1. Escaped pipe cells.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Notes |',
        '| --- | --- |',
        '| A | 1\\|2 |',
        '| B | 3\\|4 |',
        'Table 1. Escaped pipe cells.',
      ].join('\n')
    );
  });

  test('replaces a collapsed table line before a matching caption', () => {
    const markdown = [
      'Intro',
      '#scans #points Dataset A 10 20 Dataset B 30 40',
      'Table 1: Dataset summary.',
      'Body',
    ].join('\n');
    const layout = [
      '                 #scans      #points',
      'Dataset A            10          20',
      'Dataset B            30          40',
      '',
      'Table 1: Dataset summary.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Intro',
        '| Column 1 | #scans | #points |',
        '| --- | --- | --- |',
        '| Dataset A | 10 | 20 |',
        '| Dataset B | 30 | 40 |',
        'Table 1: Dataset summary.',
        'Body',
      ].join('\n')
    );
  });

  test('maps multi-line layout headers onto stable body columns', () => {
    const markdown = [
      'Approach mIoU road sidewalk PointNet 14.6 61.6 35.7',
      'Table 2: Single scan results.',
    ].join('\n');
    const layout = [
      '                                        sidewalk',
      '                   mIoU      road',
      'Approach',
      'PointNet [40]       14.6      61.6      35.7',
      'SPGraph [31]        17.4      45.0      28.5',
      '',
      'Table 2: Single scan results.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Approach | mIoU | road | sidewalk |',
        '| --- | --- | --- | --- |',
        '| PointNet [40] | 14.6 | 61.6 | 35.7 |',
        '| SPGraph [31] | 17.4 | 45.0 | 28.5 |',
        'Table 2: Single scan results.',
      ].join('\n')
    );
  });

  test('crops side-by-side page content using the table caption indentation', () => {
    const markdown = ['Approach params time PointNet 3 0.5', 'Table 3: Approach statistics.'].join(
      '\n'
    );
    const layout = [
      'PointNet SPLATNet                              Approach          parameters        time',
      '',
      'SPGraph  SqueezeSeg                            PointNet                  3           0.5',
      '40                                             PointNet++                6           5.9',
      '',
      '                                               Table 3: Approach statistics.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Approach | parameters | time |',
        '| --- | --- | --- |',
        '| PointNet | 3 | 0.5 |',
        '| PointNet++ | 6 | 5.9 |',
        'Table 3: Approach statistics.',
      ].join('\n')
    );
  });

  test('leaves markdown unchanged when layout has no recoverable table', () => {
    const markdown = ['A B C', 'Table 9: Broken.'].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, 'Table 9: Broken.')).toBe(markdown);
  });

  test('repairs a collapsed table that appears on the same line as a period caption', () => {
    const markdown = [
      'Dataset Year Size nuScenes 2019 1000 KITTI 2012 22 Table 1. AV dataset comparison.',
    ].join('\n');
    const layout = [
      'Dataset       Year      Size',
      'nuScenes      2019      1000',
      'KITTI         2012      22',
      '',
      'Table 1. AV dataset comparison.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Dataset | Year | Size |',
        '| --- | --- | --- |',
        '| nuScenes | 2019 | 1000 |',
        '| KITTI | 2012 | 22 |',
        'Table 1. AV dataset comparison.',
      ].join('\n')
    );
  });

  test('matches abbreviated table captions from source layout', () => {
    const markdown = ['Method Score Alpha 1 Beta 2', 'Tab. 2. Scores.'].join('\n');
    const layout = [
      'Method       Score',
      'Alpha            1',
      'Beta             2',
      '',
      'Tab. 2. Scores.',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Score |',
        '| --- | --- |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        'Tab. 2. Scores.',
      ].join('\n')
    );
  });

  test('repairs Springer-style captions without punctuation after the table number', () => {
    const markdown = [
      '**Table 1** An overview of metric choices',
      'MOTA IDF1 HOTA Final Tracks Final Tracks Balanced',
    ].join('\n');
    const layout = [
      'Table 1 An overview of metric choices',
      '                       MOTA              IDF1              HOTA',
      'Representation         Final Tracks      Final Tracks      Final Tracks',
      'Matching Domain        Detection         Trajectory        Detection',
      'Bias Toward            Detection         Association       Balanced',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '**Table 1** An overview of metric choices',
        '',
        '| Column 1 | MOTA | IDF1 | HOTA |',
        '| --- | --- | --- | --- |',
        '| Representation | Final Tracks | Final Tracks | Final Tracks |',
        '| Matching Domain | Detection | Trajectory | Detection |',
        '| Bias Toward | Detection | Association | Balanced |',
      ].join('\n')
    );
  });

  test('repairs roman numeral table captions with rows below the caption', () => {
    const markdown = [
      'TABLE II. Speed comparison of ground segmentation methods.',
      'Method Speed Method Speed LineFit [15] 58.96 GPF [16] 29.72 RANSAC [9] 15.43 R-GPF [2] 35.30',
    ].join('\n');
    const layout = [
      'TABLE II. Speed comparison of ground segmentation methods.',
      ' Method                   Speed     Method                      Speed',
      ' LineFit [15]              58.96    GPF [16]                    29.72',
      ' RANSAC [9]                15.43    R-GPF [2]                   35.30',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'TABLE II. Speed comparison of ground segmentation methods.',
        '',
        '| Method | Speed | Method | Speed |',
        '| --- | --- | --- | --- |',
        '| LineFit [15] | 58.96 | GPF [16] | 29.72 |',
        '| RANSAC [9] | 15.43 | R-GPF [2] | 35.30 |',
      ].join('\n')
    );
  });

  test('skips prose caption continuations before rows below a caption', () => {
    const markdown = [
      'Table 1: Dataset comparison. This caption continues before the rows.',
      'dataset statistics WOD 100 KITTI 50',
    ].join('\n');
    const layout = [
      'Table 1: Dataset comparison. This caption continues',
      'over another line before the table starts.',
      '',
      'dataset statistics   WOD   KITTI',
      '# sequences          100    50',
      '# images             2000   300',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 1: Dataset comparison. This caption continues before the rows.',
        '',
        '| dataset statistics | WOD | KITTI |',
        '| --- | --- | --- |',
        '| # sequences | 100 | 50 |',
        '| # images | 2000 | 300 |',
      ].join('\n')
    );
  });

  test('skips hyphenated caption continuations before dense rows below a caption', () => {
    const markdown = [
      'Table 2. Long caption starts.',
      '',
      'Dataset (a)^ ADE/FDE (m) Linear LSTM S-LSTM ETH 1.33/2.94 1.09/2.41 1.09/2.35 Hotel 0.39/0.72 0.86/1.91 0.79/1.76',
    ].join('\n');
    const layout = [
      'Table 2. Long caption starts with a hyphenated continua-',
      'tion line that should not become part of the table',
      'Bold indicates best.',
      '',
      'Dataset                 (a) ADE/FDE (m)',
      '           Linear       LSTM       S-LSTM [13]',
      'ETH        1.33/2.94    1.09/2.41  1.09/2.35',
      'Hotel      0.39/0.72    0.86/1.91  0.79/1.76',
      'Univ       0.82/1.59    0.61/1.31  0.67/1.40',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 2. Long caption starts.',
        '',
        '| Dataset | Linear | LSTM | (a) ADE/FDE (m) S-LSTM [13] |',
        '| --- | --- | --- | --- |',
        '| ETH | 1.33/2.94 | 1.09/2.41 | 1.09/2.35 |',
        '| Hotel | 0.39/0.72 | 0.86/1.91 | 0.79/1.76 |',
        '| Univ | 0.82/1.59 | 0.61/1.31 | 0.67/1.40 |',
      ].join('\n')
    );
  });

  test('removes packed pipe fragments after inserting a layout table', () => {
    const markdown = [
      'Table 1: Dataset comparison. Caption starts.',
      'caption continues. | dataset statistics | WOD | KITTI |',
      '| --- | --- | --- | | # sequences | 100 | 50 |',
    ].join('\n');
    const layout = [
      'Table 1: Dataset comparison. Caption starts.',
      'caption continues.',
      '',
      'dataset statistics   WOD   KITTI',
      '# sequences          100    50',
      '# images             2000   300',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 1: Dataset comparison. Caption starts.',
        '',
        '| dataset statistics | WOD | KITTI |',
        '| --- | --- | --- |',
        '| # sequences | 100 | 50 |',
        '| # images | 2000 | 300 |',
      ].join('\n')
    );
  });

  test('keeps prose and structural lines after clearing collapsed table fragments', () => {
    const markdown = [
      'Table 1: Dataset comparison.',
      'dataset statistics WOD KITTI 100 50',
      'Ordinary prose follows the table.',
      'Figure 1. Next illustration.',
    ].join('\n');
    const layout = [
      'Table 1: Dataset comparison.',
      '',
      'dataset statistics   WOD   KITTI',
      '# sequences          100    50',
      '# images             2000   300',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 1: Dataset comparison.',
        '',
        '| dataset statistics | WOD | KITTI |',
        '| --- | --- | --- |',
        '| # sequences | 100 | 50 |',
        '| # images | 2000 | 300 |',
        'Ordinary prose follows the table.',
        'Figure 1. Next illustration.',
      ].join('\n')
    );
  });

  test('stops clearing collapsed table fragments at blank and structural boundaries', () => {
    const markdown = [
      'Table 2: Dataset comparison.',
      'dataset statistics WOD KITTI 100 50',
      '',
      'Figure 2. Overview.',
    ].join('\n');
    const layout = [
      'Table 2: Dataset comparison.',
      '',
      'dataset statistics   WOD   KITTI',
      '# sequences          100    50',
      '# images             2000   300',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 2: Dataset comparison.',
        '',
        '| dataset statistics | WOD | KITTI |',
        '| --- | --- | --- |',
        '| # sequences | 100 | 50 |',
        '| # images | 2000 | 300 |',
        '',
        'Figure 2. Overview.',
      ].join('\n')
    );
  });

  test('stops clearing collapsed table fragments at immediate structural boundaries', () => {
    const markdown = [
      'Table 3: Dataset comparison.',
      'dataset statistics WOD KITTI 100 50',
      'Figure 3. Overview.',
    ].join('\n');
    const layout = [
      'Table 3: Dataset comparison.',
      '',
      'dataset statistics   WOD   KITTI',
      '# sequences          100    50',
      '# images             2000   300',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 3: Dataset comparison.',
        '',
        '| dataset statistics | WOD | KITTI |',
        '| --- | --- | --- |',
        '| # sequences | 100 | 50 |',
        '| # images | 2000 | 300 |',
        'Figure 3. Overview.',
      ].join('\n')
    );
  });

  test('stops collecting rows below captions after repeated blank lines', () => {
    const markdown = ['Table 4. Ablation results.', 'Method Score A 1 B 2 C 3'].join('\n');
    const layout = [
      'Table 4. Ablation results.',
      'Method       Score',
      'A                1',
      'B                2',
      '',
      '',
      '',
      'C                3',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 4. Ablation results.',
        '',
        '| Method | Score |',
        '| --- | --- |',
        '| A | 1 |',
        '| B | 2 |',
      ].join('\n')
    );
  });

  test('stops collecting side-column rows above captions after wide blank gaps', () => {
    const prefix = ' '.repeat(40);
    const captionPrefix = ' '.repeat(46);
    const markdown = ['Method Score Alpha 1 Beta 2', 'Table 5. Side table.'].join('\n');
    const layout = [
      `${prefix}Method       Score`,
      `${prefix}Alpha            1`,
      `${prefix}Beta             2`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `${captionPrefix}Table 5. Side table.`,
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        '| Method | Score |',
        '| --- | --- |',
        '| Alpha | 1 |',
        '| Beta | 2 |',
        'Table 5. Side table.',
      ].join('\n')
    );
  });

  test('leaves low-confidence one-row layout tables unchanged', () => {
    const markdown = ['Table 5. Tiny table.', 'Metric Value Accuracy 0.91'].join('\n');
    const layout = ['Table 5. Tiny table.', 'Metric       Value', 'Accuracy     0.91'].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(markdown);
  });

  test('does not insert above-caption tables when there is no previous markdown line to replace', () => {
    const markdown = 'Table 6. Caption starts the document.';
    const layout = [
      'Metric       Value',
      'Accuracy     0.91',
      'Recall       0.82',
      '',
      markdown,
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(markdown);
  });

  test('keeps nonnumeric metric header rows below captions', () => {
    const markdown = [
      'Table 2. Performance of the proposed approach on MOT benchmark sequences [6]. Method Type MOTA↑',
      'TBD Batch 15.9 SORT Online 33.4',
    ].join('\n');
    const layout = [
      'Table 2. Performance of the proposed approach on MOT benchmark sequences [6].',
      'Method                 Type     MOTA↑        MOTP↑       FAF↓     MT↑       ML↓       FP↓       FN↓      ID sw↓     Frag↓',
      'TBD [20]              Batch        15.9        70.9      2.6%     6.4%     47.9%     14943     34777      1939      1963',
      'SORT (Proposed)       Online       33.4        72.1      1.3%    11.7%     30.9%      7318     32615      1001      1764',
    ].join('\n');

    expect(repairMarkdownTablesWithLayout(markdown, layout)).toBe(
      [
        'Table 2. Performance of the proposed approach on MOT benchmark sequences [6]. Method Type MOTA↑',
        '',
        '| Method | Type | MOTA↑ | MOTP↑ | FAF↓ | MT↑ | ML↓ | FP↓ | FN↓ | ID sw↓ | Frag↓ |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        '| TBD [20] | Batch | 15.9 | 70.9 | 2.6% | 6.4% | 47.9% | 14943 | 34777 | 1939 | 1963 |',
        '| SORT (Proposed) | Online | 33.4 | 72.1 | 1.3% | 11.7% | 30.9% | 7318 | 32615 | 1001 | 1764 |',
      ].join('\n')
    );
  });
});
