import { repairMarkdownTablesWithLayout } from '../../../src/verification/layout-tables';

describe('repairMarkdownTablesWithLayout', () => {
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
});
