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
        totalSourceCharts: 1,
        totalMissingMarkdownCharts: 0,
        totalSourceEquations: 1,
        totalMissingMarkdownEquations: 0,
        totalMalformedMarkdownEquations: 0,
        totalPlaceholderMarkdownEquations: 0,
        totalLowSimilarityMarkdownEquations: 0,
        totalEquationRenderIssues: 0,
        totalSourceReferences: 3,
        totalMarkdownReferences: 3,
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
          sourceChartsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
          sourceChartNumbers: ['1'],
          markdownChartNumbers: ['1'],
          missingMarkdownCharts: [],
          sourceEquationsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
          sourceEquationNumbers: ['1'],
          markdownEquationNumbers: ['1'],
          missingMarkdownEquations: [],
          equationComparisons: [
            {
              number: '1',
              presentInMarkdown: true,
              githubDisplayMath: true,
              placeholderOnly: false,
              contentSimilarity: 1,
              status: 'matched',
            },
          ],
          malformedMarkdownEquations: [],
          placeholderMarkdownEquations: [],
          lowSimilarityMarkdownEquations: [],
          equationRenderIssues: [],
          sourceReferenceCount: 3,
          markdownReferenceCount: 3,
          headingIssues: [],
          agentReadabilityIssues: [],
          parserImprovementSuggestions: [],
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
            sourceChartCount: 1,
            markdownChartCount: 1,
            chartCoverageScore: 1,
            sourceEquationCount: 1,
            markdownEquationCount: 1,
            equationCoverageScore: 1,
            equationFormatScore: 1,
            equationContentScore: 1,
            equationRenderScore: 1,
            sourceReferenceCount: 3,
            markdownReferenceCount: 3,
            referenceCoverageScore: 1,
            headingFlowScore: 1,
            arxivPlacementScore: 0.75,
            completenessScore: 0.9,
            artifactScore: 1,
            agentReadabilityScore: 1,
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
    expect(output()).toContain(
      'paper-a: tables 2/2 (100%); charts 1/1 (100%); eqs 1/1 (cov 100%, fmt 100%, body 100%, render 100%); refs 3/3 (100%); headings 100%; agent 100%; pages 2/2'
    );
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
        totalSourceCharts: 1,
        totalMissingMarkdownCharts: 1,
        totalSourceEquations: 1,
        totalMissingMarkdownEquations: 1,
        totalMalformedMarkdownEquations: 0,
        totalPlaceholderMarkdownEquations: 0,
        totalLowSimilarityMarkdownEquations: 0,
        totalEquationRenderIssues: 0,
        totalSourceReferences: 2,
        totalMarkdownReferences: 1,
      },
      papers: [
        {
          id: 'paper-b',
          pdfPath: '/tmp/paper-b.pdf',
          sourceTablesByPage: [{ page: 1, count: 1, tableNumbers: ['1'] }],
          sourceTableNumbers: ['1'],
          markdownTableNumbers: [],
          missingMarkdownTables: ['1'],
          sourceChartsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
          sourceChartNumbers: ['1'],
          markdownChartNumbers: [],
          missingMarkdownCharts: ['1'],
          sourceEquationsByPage: [{ page: 1, count: 1, numbers: ['1'] }],
          sourceEquationNumbers: ['1'],
          markdownEquationNumbers: [],
          missingMarkdownEquations: ['1'],
          equationComparisons: [
            {
              number: '1',
              presentInMarkdown: false,
              githubDisplayMath: false,
              placeholderOnly: false,
              contentSimilarity: 0,
              status: 'missing',
            },
          ],
          malformedMarkdownEquations: [],
          placeholderMarkdownEquations: [],
          lowSimilarityMarkdownEquations: [],
          equationRenderIssues: [],
          sourceReferenceCount: 2,
          markdownReferenceCount: 1,
          headingIssues: [{ line: 4, message: 'four consecutive h3 headings' }],
          agentReadabilityIssues: [
            {
              line: 6,
              severity: 'high',
              message: 'very long line is hard for an agent to scan and quote precisely',
              suggestion: 'split extracted multi-column/table text into blocks',
            },
          ],
          parserImprovementSuggestions: [
            'Improve table recovery from layout text and same-line captions.',
          ],
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
            sourceChartCount: 1,
            markdownChartCount: 0,
            chartCoverageScore: 0,
            sourceEquationCount: 1,
            markdownEquationCount: 0,
            equationCoverageScore: 0,
            equationFormatScore: 0,
            equationContentScore: 0,
            equationRenderScore: 0,
            sourceReferenceCount: 2,
            markdownReferenceCount: 1,
            referenceCoverageScore: 0.5,
            headingFlowScore: 0.7,
            arxivPlacementScore: 1,
            completenessScore: 0.8,
            artifactScore: 1,
            agentReadabilityScore: 0.85,
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
