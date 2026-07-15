import { formatCitationsTable } from '../../../src/cli/citations-table';

// Colour is disabled when stdout is not a TTY (as under Jest), so these
// assertions see plain text and line lengths are real widths.
function longestLine(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, line.length), 0);
}

describe('formatCitationsTable', () => {
  test('returns the empty-state hint when there are no rows', () => {
    expect(formatCitationsTable([], 120).join('\n')).toContain('No citations found');
  });

  test('renders header columns and each row', () => {
    const output = formatCitationsTable(
      [
        { doi: '10.1234/alpha', title: 'Alpha Paper', year: 2024, verificationStatus: 'verified' },
        { doi: '10.1234/beta', title: 'Beta Paper', year: 2023, verificationStatus: 'failed' },
        {
          doi: '10.1234/gamma',
          title: 'Gamma Paper',
          year: 2022,
          verificationStatus: 'unverified',
        },
      ],
      120
    ).join('\n');

    expect(output).toContain('DOI');
    expect(output).toContain('Title');
    expect(output).toContain('Year');
    expect(output).toContain('Status');
    expect(output).toContain('10.1234/alpha');
    expect(output).toContain('Alpha Paper');
    expect(output).toContain('verified');
    expect(output).toContain('failed');
    expect(output).toContain('unverified');
  });

  test('emits one line per row plus a header', () => {
    const lines = formatCitationsTable(
      [
        { doi: '10/a', title: 'A', year: 2024, verificationStatus: 'verified' },
        { doi: '10/b', title: 'B', year: 2024, verificationStatus: 'verified' },
      ],
      120
    );
    expect(lines).toHaveLength(3);
  });

  test('truncates over-long titles to fit the column', () => {
    const longTitle = 'A '.repeat(300).trim();
    const lines = formatCitationsTable(
      [{ doi: '10/long', title: longTitle, year: 2024, verificationStatus: 'verified' }],
      120
    );
    expect(longestLine(lines)).toBeLessThan(longTitle.length);
  });

  test('keeps rendered lines within narrow terminal widths', () => {
    const lines = formatCitationsTable(
      [
        {
          doi: 'https://doi.org/10.1234/very.long.identifier',
          title: 'A Very Long Paper Title That Would Otherwise Overflow A Narrow Terminal',
          year: 2024,
          verificationStatus: 'downloaded',
        },
      ],
      50
    );
    expect(longestLine(lines)).toBeLessThanOrEqual(50);
  });

  // Jest's stdout has no `columns`, so omitting the width exercises the
  // DEFAULT_TERMINAL_WIDTH (120) fallback rather than a real terminal size.
  test('falls back to a default width when the terminal size is unknown', () => {
    const lines = formatCitationsTable([
      { doi: '10/a', title: 'A'.repeat(400), year: 2024, verificationStatus: 'verified' },
    ]);
    expect(longestLine(lines)).toBeLessThanOrEqual(120);
  });

  test('truncates aggressively for narrow terminals and covers every status group', () => {
    const lines = formatCitationsTable(
      [
        {
          doi: '10.1234/very-long-doi-that-will-be-cut',
          title: 'A title that is far too long for a narrow terminal',
          year: 2024,
          verificationStatus: 'failed',
        },
        {
          doi: '10.1234/missing-title',
          verificationStatus: 'not-found',
        },
        {
          doi: '10.1234/unverified',
          title: 'Unverified title',
          verificationStatus: 'unverified',
        },
        {
          doi: '10.1234/unknown',
          title: 'Unknown status title',
          verificationStatus: 'custom',
        },
      ],
      80
    );

    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain('10.1234/very');
    expect(lines[2]).toContain('(no title)');
    expect(lines[3]).toContain('unverif');
    expect(lines[4]).toContain('custom');
  });
});
