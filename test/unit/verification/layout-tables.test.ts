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
});
