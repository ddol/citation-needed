import React from 'react';
import { useStdout } from 'ink';
import { render } from 'ink-testing-library';
import { CitationsTable } from '../../../src/tui/components/CitationsTable';

// ink exports `useStdout` as a non-configurable getter, so `jest.spyOn(ink, …)`
// throws "Cannot redefine property". Replace the module with a configurable
// mock that keeps the real Box/Text/render and only stubs useStdout, letting us
// drive the terminal width the component reads.
jest.mock('ink', () => {
  const actual = jest.requireActual('ink');
  return { ...actual, useStdout: jest.fn() };
});

const mockedUseStdout = useStdout as jest.MockedFunction<typeof useStdout>;

function mockTerminalWidth(columns: number | undefined): void {
  mockedUseStdout.mockReturnValue({
    stdout: columns === undefined ? undefined : { columns },
  } as unknown as ReturnType<typeof useStdout>);
}

describe('CitationsTable', () => {
  beforeEach(() => {
    // Default: no stdout on the context, so the component uses its fallback width.
    mockTerminalWidth(undefined);
  });

  test('renders the empty-state hint when there are no rows', () => {
    const { lastFrame } = render(<CitationsTable rows={[]} />);
    expect(lastFrame()).toContain('No citations found');
  });

  test('renders header columns and each row', () => {
    const { lastFrame } = render(
      <CitationsTable
        rows={[
          {
            doi: '10.1234/alpha',
            title: 'Alpha Paper',
            year: 2024,
            verificationStatus: 'verified',
          },
          {
            doi: '10.1234/beta',
            title: 'Beta Paper',
            year: 2023,
            verificationStatus: 'failed',
          },
          {
            doi: '10.1234/gamma',
            title: 'Gamma Paper',
            year: 2022,
            verificationStatus: 'unverified',
          },
        ]}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('DOI');
    expect(frame).toContain('Title');
    expect(frame).toContain('Year');
    expect(frame).toContain('Status');
    expect(frame).toContain('10.1234/alpha');
    expect(frame).toContain('Alpha Paper');
    expect(frame).toContain('verified');
    expect(frame).toContain('failed');
    expect(frame).toContain('unverified');
  });

  test('truncates over-long titles to fit the column', () => {
    const longTitle = 'A '.repeat(300).trim();
    const { lastFrame } = render(
      <CitationsTable
        rows={[{ doi: '10/long', title: longTitle, year: 2024, verificationStatus: 'verified' }]}
      />
    );
    // Truncation should keep the frame from blowing past process.stdout.columns
    const longestLine = (lastFrame() ?? '')
      .split('\n')
      .reduce((max, line) => Math.max(max, line.length), 0);
    expect(longestLine).toBeLessThan(longTitle.length);
  });

  test('keeps rendered lines within narrow terminal widths', () => {
    mockTerminalWidth(50);

    const { lastFrame } = render(
      <CitationsTable
        rows={[
          {
            doi: 'https://doi.org/10.1234/very.long.identifier',
            title: 'A Very Long Paper Title That Would Otherwise Overflow A Narrow Terminal',
            year: 2024,
            verificationStatus: 'downloaded',
          },
        ]}
      />
    );

    const longestLine = (lastFrame() ?? '')
      .split('\n')
      .reduce((max, line) => Math.max(max, line.length), 0);

    expect(longestLine).toBeLessThanOrEqual(50);
  });
});
