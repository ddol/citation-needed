import {
  applyLayoutHeadings,
  extractLayoutHeadings,
  extractLayoutTitle,
  normalizeSmallCaps,
} from '../../../src/verification/layout-headings';

describe('normalizeSmallCaps', () => {
  test('rejoins small-caps headings and typographic ligatures', () => {
    expect(normalizeSmallCaps('I. I NTRODUCTION')).toBe('I. INTRODUCTION');
    expect(normalizeSmallCaps('II. R ELATED W ORKS')).toBe('II. RELATED WORKS');
    expect(normalizeSmallCaps('PATCHWORK ++: FAST')).toBe('PATCHWORK++: FAST');
    expect(normalizeSmallCaps('6 Decomposing Diﬀerent Error')).toBe(
      '6 Decomposing Different Error'
    );
  });
});

describe('extractLayoutHeadings', () => {
  test('recovers headings from both columns of a two-column page', () => {
    const layout = [
      '            II. R ELATED W ORKS                     of interest in object clustering methods,',
      'A. Learning-based Ground Segmentation                B. Conventional Ground Segmentation',
      'Xu et al. proposed a novel approach that is          Prior work relies on plane fitting to',
    ].join('\n');

    const headings = extractLayoutHeadings(layout).map((heading) => heading.text);
    expect(headings).toContain('II. RELATED WORKS');
    expect(headings).toContain('A. Learning-based Ground Segmentation');
    expect(headings).toContain('B. Conventional Ground Segmentation');
  });

  test('joins a heading that wraps mid-word across lines', () => {
    const layout = [
      '                                E. Different Distributions of Self-Updated Parameters De-',
      '                                pending on the Surroundings',
    ].join('\n');

    expect(extractLayoutHeadings(layout)[0]?.text).toBe(
      'E. Different Distributions of Self-Updated Parameters Depending on the Surroundings'
    );
  });

  test('assigns h2 to numbered sections and h3 to lettered and decimal subsections', () => {
    const layout = [
      'III. PATCHWORK: FAST AND ROBUST',
      'A. Problem Definition',
      '4.2. Evaluation on KITTI Test Set',
      '5. Experimental Results',
    ].join('\n');

    expect(extractLayoutHeadings(layout).map((h) => [h.text, h.level])).toEqual([
      ['III. PATCHWORK: FAST AND ROBUST', 2],
      ['A. Problem Definition', 3],
      ['4.2. Evaluation on KITTI Test Set', 3],
      ['5. Experimental Results', 2],
    ]);
  });

  test('rejects enumerated prose, affiliations, references, and axis labels', () => {
    const layout = [
      '1. Physics-based motion models are the simplest',
      '2 Volkswagen AG, Wolfsburg, Germany',
      '1 Inria Grenoble Rhone-Alpes, 655 Avenue de l Europe',
      '1. Rajamani R (2006) Vehicle dynamics and control. Birkhauser',
      'N. Kawaguchi, “A slope-robust cascaded ground segmentation”',
      '0.6 MonoDIS0.8',
    ].join('\n');

    expect(extractLayoutHeadings(layout)).toEqual([]);
  });

  test('stops collecting once the bibliography begins', () => {
    const layout = [
      '5. Conclusion',
      'References',
      '1. Rajamani R, Vehicle dynamics and control',
      '2. Another Author, Some Other Title',
    ].join('\n');

    expect(extractLayoutHeadings(layout).map((heading) => heading.text)).toEqual([
      '5. Conclusion',
      'References',
    ]);
  });

  test('deduplicates repeated headings across pages and recognizes appendix-style headings', () => {
    const layout = [
      ['I. INTRODUCTION', 'APPENDIX', 'I. INTRODUCTION'].join('\n'),
      ['I. INTRODUCTION', 'A. Supplemental Details'].join('\n'),
    ].join('\f');

    expect(extractLayoutHeadings(layout).map((heading) => [heading.text, heading.page])).toEqual([
      ['I. INTRODUCTION', 1],
      ['APPENDIX', 1],
      ['A. Supplemental Details', 2],
    ]);
  });

  test('leaves a hyphenated heading alone when the continuation is not aligned', () => {
    const layout = [
      '                       A. Long-Heading De-',
      'Different column text starts far away',
    ].join('\n');

    expect(extractLayoutHeadings(layout)).toEqual([
      { text: 'A. Long-Heading De-', level: 3, page: 1 },
    ]);
  });
});

describe('extractLayoutTitle', () => {
  test('joins a title split across lines and skips an arXiv sidebar', () => {
    const layout = [
      '            Learning Lane Graph Representations',
      'arXiv:2007.13732v1 [cs.CV] 27 Jul 2020',
      '                  for Motion Forecasting',
      '     Ming Liang1 , Bin Yang1,2 , Rui Hu1',
    ].join('\n');

    expect(extractLayoutTitle(layout)).toBe(
      'Learning Lane Graph Representations for Motion Forecasting'
    );
  });

  test('skips journal furniture and stops at the author list', () => {
    const layout = [
      'Lefevre et al. ROBOMECH Journal 2014, 1:1',
      'http://www.robomechjournal.com/content/1/1/1',
      ' R EVIEW Open Access',
      'A survey on motion prediction and risk',
      'assessment for intelligent vehicles',
      'Stephanie Lefevre1,2* , Dizan Vasquez1 and Christian Laugier1',
    ].join('\n');

    expect(extractLayoutTitle(layout)).toBe(
      'A survey on motion prediction and risk assessment for intelligent vehicles'
    );
  });

  test('stops at a comma-separated author list', () => {
    const layout = [
      'nuScenes: A multimodal dataset for autonomous driving',
      'Holger Caesar, Varun Bankiti, Alex H. Lang, Sourabh Vora',
    ].join('\n');

    expect(extractLayoutTitle(layout)).toBe(
      'nuScenes: A multimodal dataset for autonomous driving'
    );
  });

  test('returns undefined when the opening line is already a section heading', () => {
    const layout = ['I. INTRODUCTION', 'Body text begins immediately after the heading.'].join(
      '\n'
    );

    expect(extractLayoutTitle(layout)).toBeUndefined();
  });
});

describe('applyLayoutHeadings', () => {
  const layout = [
    'Deep Ground Segmentation',
    'Jane Doe, John Roe, Ada Lovelace',
    'I. I NTRODUCTION',
    'A. Problem Definition',
  ].join('\n');

  test('cuts headings welded into prose out onto their own lines', () => {
    const markdown = [
      '## Deep Ground Segmentation',
      '',
      'available at github I. INTRODUCTION Recently, mobile robots have become common.',
      '',
      'A. Problem Definition Given a 3D point cloud, we define the task.',
    ].join('\n');

    expect(applyLayoutHeadings(markdown, layout)).toBe(
      [
        '# Deep Ground Segmentation',
        '',
        'available at github',
        '',
        '## I. INTRODUCTION',
        '',
        'Recently, mobile robots have become common.',
        '',
        '### A. Problem Definition',
        '',
        'Given a 3D point cloud, we define the task.',
      ].join('\n')
    );
  });

  test('promotes only the first occurrence, leaving later cross-references alone', () => {
    const markdown = [
      '## Deep Ground Segmentation',
      '',
      'I. INTRODUCTION Body text.',
      '',
      'As stated in I. INTRODUCTION we already covered this.',
    ].join('\n');

    const result = applyLayoutHeadings(markdown, layout);
    expect(result).toContain('## I. INTRODUCTION');
    expect(result).toContain('As stated in I. INTRODUCTION we already covered this.');
    expect(result.match(/^## I\. INTRODUCTION$/gm)).toHaveLength(1);
  });

  test('returns markdown unchanged without layout text', () => {
    expect(applyLayoutHeadings('## Title\n\nBody.', undefined)).toBe('## Title\n\nBody.');
  });

  test('prepends a top-level title when the markdown has no headings', () => {
    const markdown = ['Body paragraph only.'].join('\n');
    const titleOnlyLayout = ['Deep Ground Segmentation', 'Jane Doe, John Roe, Ada Lovelace'].join(
      '\n'
    );

    expect(applyLayoutHeadings(markdown, titleOnlyLayout)).toBe(
      ['# Deep Ground Segmentation', '', 'Body paragraph only.'].join('\n')
    );
  });

  test('retitles an incomplete first heading and removes the orphaned title remainder paragraph', () => {
    const markdown = [
      '## A survey on motion prediction',
      '',
      'and risk assessment for intelligent vehicles',
      '',
      'Body text starts here.',
    ].join('\n');
    const titleLayout = [
      'A survey on motion prediction and risk',
      'assessment for intelligent vehicles',
      'Stephanie Lefevre1,2* , Dizan Vasquez1 and Christian Laugier1',
    ].join('\n');

    const result = applyLayoutHeadings(markdown, titleLayout);

    expect(result).toContain(
      '# A survey on motion prediction and risk assessment for intelligent vehicles'
    );
    // The orphaned tail is gone as its own paragraph (it survives only as part
    // of the joined title, which the assertion above already covers).
    expect(result).not.toMatch(/^and risk assessment for intelligent vehicles$/m);
    expect(result).toContain('Body text starts here.');
  });

  test('retitles journal-furniture headings from the layout title', () => {
    const markdown = ['## REVIEW Open Access', '', 'Body text starts here.'].join('\n');
    const journalLayout = [
      'R EVIEW Open Access',
      'A survey on motion prediction and risk',
      'assessment for intelligent vehicles',
      'Stephanie Lefevre1,2* , Dizan Vasquez1 and Christian Laugier1',
    ].join('\n');

    expect(applyLayoutHeadings(markdown, journalLayout)).toBe(
      [
        '# A survey on motion prediction and risk assessment for intelligent vehicles',
        '',
        'Body text starts here.',
      ].join('\n')
    );
  });

  test('keeps the existing first heading text when the layout title does not extend it', () => {
    const markdown = ['## Short Title', '', 'Body text.'].join('\n');
    const unrelatedLayout = ['Different Long Title', 'Author Name'].join('\n');

    expect(applyLayoutHeadings(markdown, unrelatedLayout)).toBe('# Short Title\n\nBody text.');
  });

  test('does not rewrite headings embedded in quote or table blocks', () => {
    const markdown = [
      '## Deep Ground Segmentation',
      '',
      '> I. INTRODUCTION inside a quote',
      '| A. Problem Definition | Value |',
      '```',
      'code sample only',
      '```',
    ].join('\n');

    expect(applyLayoutHeadings(markdown, layout)).toBe(
      [
        '# Deep Ground Segmentation',
        '',
        '> I. INTRODUCTION inside a quote',
        '| A. Problem Definition | Value |',
        '```',
        'code sample only',
        '```',
      ].join('\n')
    );
  });
});
