import {
  extractLayoutEquations,
  normalizeMathGlyphs,
  repairSubscripts,
  replaceLabeledEquationsFromLayout,
} from '../../../src/verification/layout-equations';

describe('extractLayoutEquations', () => {
  test('rebuilds a fraction with two sums from a Caesar2020-shaped layout', () => {
    // Real shape from Caesar2020 eq (1), including the left-column prose bleed.
    const layout = [
      'on average. Moreover, 40k keyframes were taken from',
      'four different scene locations (Boston: 55%, SG-OneNorth:                                   1 XX',
      '                                                                                 mAP =                   APc,d             (1)',
      '21.5%, SG-Queenstown: 13.5%, SG-HollandVillage: 10%)                                      |C||D|',
      '                                                                                                c∈C d∈D',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('1');
    expect(equation?.latex).toContain('mAP =');
    expect(equation?.latex).toContain('\\frac{1}{|C||D|}');
    expect(equation?.latex).toContain('\\sum_{c\\in C}');
    expect(equation?.latex).toContain('\\sum_{d\\in D}');
    expect(equation?.latex).toContain('AP_{c,d}');
  });

  test('rebuilds a single-sum average from a Caesar2020 eq (2) shape', () => {
    const layout = [
      '                                               1 X',
      '                                     mTP =           TPc                  (2)',
      '                                              |C|',
      '                                                 c∈C',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('2');
    expect(equation?.latex).toContain('\\frac{1}{|C|}');
    expect(equation?.latex).toContain('\\sum_{c\\in C}');
    expect(equation?.latex).toContain('TP_c');
  });

  test('handles a label followed by other-column prose on the same line', () => {
    // Caesar2020 eq (3): right column prose continues after the label.
    const layout = [
      '              1             X                                    duration of the track until first detected.',
      '    NDS =       [5 mAP +          (1 − min(1, mTP))] (3)         computes the longest duration of any gap',
      '             10',
      '                            mTP∈TP',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('3');
    expect(equation?.latex).toContain('NDS =');
    expect(equation?.latex).toContain('\\frac{1}{10}');
    expect(equation?.latex).toContain('\\sum_{mTP\\in TP}');
    expect(equation?.latex).not.toContain('longest');
  });

  test('rebuilds a wide fraction from a Luiten2021-shaped layout', () => {
    const layout = [
      'tity. Formally, an IDSW is a TP which has a prID that is                                  |IDTP|',
      '                                                                    IDF1 =                                                       (6)',
      'different from the prID of the previous TP (that has the same                |IDTP| + 0.5 |IDFN| + 0.5 |IDFP|',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('6');
    expect(equation?.latex).toBe('IDF1 = \\frac{|IDTP|}{|IDTP| + 0.5 |IDFN| + 0.5 |IDFP|}');
  });

  test('turns an if/otherwise stack into a cases block', () => {
    // Liang2020 eq (10) shape; the lone `(` above is a big-brace artifact.
    const layout = [
      '                                     (',
      '                                       0.5x2i      if kxi k < 1',
      '                           d(xi ) =                                                  (10)',
      '                                       kxi k − 0.5 otherwise,',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('10');
    expect(equation?.latex).toContain('\\begin{cases}');
    expect(equation?.latex).toContain('\\text{if }');
    expect(equation?.latex).toContain('\\text{otherwise}');
    expect(equation?.latex).toContain('\\|x_i\\|');
  });

  test('keeps a plain single-line equation as-is', () => {
    const layout = [
      '                          L = Lcls + αLreg ,                             (7)',
    ].join('\n');

    const equation = extractLayoutEquations(layout).get('7');
    expect(equation?.latex).toContain('L = L_{cls} + \\alpha');
  });

  test('does not build a fraction out of neighbouring prose words', () => {
    // Li2022HDMap eq (5): the line below carries the next sentence, which must
    // not become a denominator.
    const layout = [
      '                                  6= cB',
      '                    L = αLvar + βLdist .                        (5)',
      '                                  Our method uses two losses.',
    ].join('\n');

    const latex = extractLayoutEquations(layout).get('5')?.latex ?? '';
    expect(latex).not.toContain('Our');
    expect(latex).not.toContain('\\frac');
    expect(latex).toContain('L = \\alpha');
  });

  test('ignores citation-style numbers inside prose', () => {
    const layout = [
      'as shown in previous work (1) and later confirmed by the follow-up study,',
      'the results hold. Numbers like (2) in running text are citations.',
    ].join('\n');

    expect(extractLayoutEquations(layout).size).toBe(0);
  });
});

describe('normalizeMathGlyphs', () => {
  test('maps CM norm bars, not-equals, and operators', () => {
    expect(normalizeMathGlyphs('kxi k < 1')).toContain('\\|x_i\\|');
    expect(normalizeMathGlyphs('k 6= j')).toContain('\\ne');
    expect(normalizeMathGlyphs('a · b')).toContain('\\cdot');
  });
});

describe('repairSubscripts', () => {
  test('recovers flattened subscripts conservatively', () => {
    expect(repairSubscripts('APc,d')).toBe('AP_{c,d}');
    expect(repairSubscripts('TPc')).toBe('TP_c');
    expect(repairSubscripts('0.5x2i')).toBe('0.5x_i^2');
    // Words must survive.
    expect(repairSubscripts('The MAP of the area')).toBe('The MAP of the area');
  });
});

describe('replaceLabeledEquationsFromLayout', () => {
  test('replaces a fractured aligned block with the layout-derived line', () => {
    const markdown = [
      'Body text before.',
      '',
      '$$',
      '\\begin{aligned}',
      'mTP = \\\\',
      '1 \\\\',
      '|C| \\\\',
      '\\sum_{c\\in C} \\\\',
      'TPc',
      '\\end{aligned}',
      '\\tag{2}',
      '$$',
      '',
      'Body text after.',
    ].join('\n');
    const layout = [
      '                                               1 X',
      '                                     mTP =           TPc                  (2)',
      '                                              |C|',
      '                                                 c∈C',
    ].join('\n');

    const result = replaceLabeledEquationsFromLayout(markdown, layout);
    expect(result).not.toContain('\\begin{aligned}');
    expect(result).toContain('\\frac{1}{|C|}');
    expect(result).toContain('\\tag{2}');
    expect(result).toContain('Body text before.');
    expect(result).toContain('Body text after.');
  });

  test('leaves blocks alone when the layout has no matching label', () => {
    const markdown = ['$$', 'a = b', '\\tag{9}', '$$'].join('\n');
    expect(replaceLabeledEquationsFromLayout(markdown, 'no equations here')).toBe(markdown);
  });
});
