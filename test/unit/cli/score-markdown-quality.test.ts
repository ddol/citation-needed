import { Command } from 'commander';
import { stripAnsi } from '../../helpers/ansi';
import { registerScoreMarkdownQualityCommand } from '../../../src/cli/commands/score-markdown-quality';

const mockScoreMarkdownQuality = jest.fn();

jest.mock('../../../src/services/markdown-quality', () => ({
  scoreMarkdownQuality: (...args: unknown[]) => mockScoreMarkdownQuality(...args),
}));

describe('score-markdown-quality command', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  const output = (): string =>
    stripAnsi(
      [...stdout.mock.calls, ...stderr.mock.calls].map((args) => args.join(' ')).join('\n')
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.exitCode = 0;
    stdout = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    stderr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = 0;
  });

  function register(): Command {
    const program = new Command();
    registerScoreMarkdownQualityCommand(program);
    return program;
  }

  test('passes corpus and folder filters to the scoring service and prints a concise summary', async () => {
    mockScoreMarkdownQuality.mockResolvedValue({
      summary: {
        papers: 1,
        scored: 1,
        missingMarkdown: 0,
        missingPdf: 0,
        averageScore: 92.5,
        totalSourceTables: 2,
        totalMissingMarkdownTables: 0,
      },
      papers: [
        {
          id: 'paper-a',
          pdfPath: '/tmp/paper-a.pdf',
          markdownPath: '/tmp/paper-a.md',
          sourceTablesByPage: [
            { page: 1, count: 1, tableNumbers: ['1'] },
            { page: 2, count: 1, tableNumbers: [] },
          ],
          sourceTableNumbers: ['1'],
          markdownTableNumbers: ['1'],
          missingMarkdownTables: [],
          headingIssues: [],
          issues: [],
          metrics: {
            score: 92.5,
            sourcePages: 2,
            markdownPages: 2,
            pageBreakScore: 1,
            sourceTableCount: 2,
            markdownTableCount: 2,
            tableCoverageScore: 1,
            tableFormattingScore: 1,
            headingFlowScore: 1,
            arxivPlacementScore: 0.75,
            completenessScore: 0.9,
            artifactScore: 1,
            sourceWordCount: 100,
            markdownWordCount: 95,
          },
        },
      ],
    });

    await register().parseAsync([
      'node',
      'citation-needed',
      'score-markdown-quality',
      '--doi',
      '10.1/example',
      '--limit',
      '5',
      '--paper-path',
      '/tmp/pdf',
      '--markdown-path',
      '/tmp/md',
      '--recursive',
      '--fail-below',
      '80',
    ]);

    expect(mockScoreMarkdownQuality).toHaveBeenCalledWith({
      doi: '10.1/example',
      limit: 5,
      paperPath: '/tmp/pdf',
      markdownPath: '/tmp/md',
      recursive: true,
    });
    expect(output()).toContain('Scored 1/1 paper(s); average 92.5');
    expect(output()).toContain('paper-a: tables 2/2 (100%); headings 100%; arXiv 75%; pages 2/2');
    expect(output()).toContain('source page 1: 1 table(s) (1)');
    expect(output()).toContain('source page 2: 1 table(s)');
    expect(process.exitCode).toBe(0);
  });

  test('prints JSON and exits non-zero when a score is below the requested threshold', async () => {
    mockScoreMarkdownQuality.mockResolvedValue({
      summary: {
        papers: 1,
        scored: 1,
        missingMarkdown: 0,
        missingPdf: 0,
        averageScore: 61,
        totalSourceTables: 1,
        totalMissingMarkdownTables: 1,
      },
      papers: [
        {
          id: 'paper-b',
          pdfPath: '/tmp/paper-b.pdf',
          sourceTablesByPage: [{ page: 1, count: 1, tableNumbers: ['1'] }],
          sourceTableNumbers: ['1'],
          markdownTableNumbers: [],
          missingMarkdownTables: ['1'],
          headingIssues: [{ line: 4, message: 'four consecutive h3 headings' }],
          issues: ['missing-markdown-tables:1', 'heading-flow-issues'],
          metrics: {
            score: 61,
            sourcePages: 1,
            markdownPages: 1,
            pageBreakScore: 1,
            sourceTableCount: 1,
            markdownTableCount: 0,
            tableCoverageScore: 0,
            tableFormattingScore: 1,
            headingFlowScore: 0.7,
            arxivPlacementScore: 1,
            completenessScore: 0.8,
            artifactScore: 1,
            sourceWordCount: 100,
            markdownWordCount: 80,
          },
        },
      ],
    });

    await register().parseAsync([
      'node',
      'citation-needed',
      'score-markdown-quality',
      '--json',
      '--fail-below',
      '90',
    ]);

    expect(JSON.parse(stdout.mock.calls[0][0])).toMatchObject({
      summary: { averageScore: 61 },
      papers: [{ id: 'paper-b', missingMarkdownTables: ['1'] }],
    });
    expect(process.exitCode).toBe(1);
  });

  test('rejects invalid numeric options before calling the service', async () => {
    await register().parseAsync([
      'node',
      'citation-needed',
      'score-markdown-quality',
      '--limit',
      '0',
    ]);

    expect(mockScoreMarkdownQuality).not.toHaveBeenCalled();
    expect(output()).toContain('--limit must be a positive integer');
    expect(process.exitCode).toBe(1);
  });
});
