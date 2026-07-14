import { chunkMarkdown, CHUNKER_VERSION } from '../../../src/services/chunker';

describe('chunkMarkdown', () => {
  test('exposes a version for index invalidation', () => {
    expect(CHUNKER_VERSION).toBeGreaterThanOrEqual(1);
  });

  test('tracks the heading trail as sectionPath', () => {
    const markdown = [
      'Preamble before any heading.',
      '# Methods',
      'Method text.',
      '## Classification',
      'Classification text.',
      '# Results',
      'Result text.',
    ].join('\n');

    const chunks = chunkMarkdown(markdown);

    expect(chunks.map((c) => c.sectionPath)).toEqual([
      [],
      ['Methods'],
      ['Methods', 'Classification'],
      ['Results'],
    ]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2, 3]);
    // Heading lines stay in the text so their terms are searchable.
    expect(chunks[1].text).toContain('# Methods');
  });

  test('resets deeper trail entries when a shallower heading appears', () => {
    const markdown = ['# A', '## B', 'b-text', '# C', '## D', 'd-text'].join('\n');
    const chunks = chunkMarkdown(markdown);
    const paths = chunks.map((c) => c.sectionPath);
    expect(paths).toContainEqual(['A', 'B']);
    expect(paths).toContainEqual(['C', 'D']);
    expect(paths).not.toContainEqual(['A', 'D']);
  });

  test('splits oversized sections on paragraph boundaries', () => {
    const paragraph = 'word '.repeat(60).trim(); // ~300 chars
    const markdown = `# Big\n\n${Array.from({ length: 5 }, () => paragraph).join('\n\n')}`;

    const chunks = chunkMarkdown(markdown, 700);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(700);
      expect(chunk.sectionPath).toEqual(['Big']);
    }
  });

  test('hard-splits a single paragraph larger than the budget', () => {
    const huge = 'x'.repeat(2500);
    const chunks = chunkMarkdown(huge, 1000);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.text).join('')).toBe(huge);
  });

  test('handles empty input; heading-only sections keep their searchable heading', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('\n\n   \n')).toEqual([]);

    const headingOnly = chunkMarkdown('# Lone Heading\n');
    expect(headingOnly).toHaveLength(1);
    expect(headingOnly[0].text).toBe('# Lone Heading');
  });
});
