import { Command } from 'commander';
import {
  scoreMarkdownQuality,
  type MarkdownQualityPaper,
  type MarkdownQualityReport,
} from '../../services/markdown-quality';
import { dim, green, print, printError, red, yellow } from '../output';

interface ScoreMarkdownQualityCommandOptions {
  doi?: string;
  limit?: string;
  paperPath?: string;
  markdownPath?: string;
  recursive?: boolean;
  failBelow?: string;
  json?: boolean;
}

function parsePositiveInteger(value?: string, name = '--limit'): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseScoreThreshold(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('--fail-below must be a number from 0 to 100');
  }
  return parsed;
}

function formatSummary(report: MarkdownQualityReport, failBelow?: number): string[] {
  const lines = [
    `Scored ${report.summary.scored}/${report.summary.papers} paper(s); ` +
      `average ${report.summary.averageScore}; ` +
      `${report.summary.totalSourceTables} source table(s); ` +
      `${report.summary.totalMissingMarkdownTables} numbered table(s) missing from Markdown.`,
    dim(
      `Missing Markdown: ${report.summary.missingMarkdown}; missing PDF: ${report.summary.missingPdf}.`
    ),
  ];

  if (failBelow !== undefined) {
    lines.push(dim(`Failure threshold: score below ${failBelow}.`));
  }

  for (const paper of report.papers) {
    lines.push(formatPaperLine(paper));
    for (const issue of formatPaperIssues(paper).slice(0, 4)) {
      lines.push(dim(`  - ${issue}`));
    }
  }

  return lines;
}

function formatPaperLine(paper: MarkdownQualityPaper): string {
  const sourceTables = paper.metrics.sourceTableCount;
  const tableCoverage = Math.round(paper.metrics.tableCoverageScore * 100);
  const headingCoverage = Math.round(paper.metrics.headingFlowScore * 100);
  const arxivCoverage = Math.round(paper.metrics.arxivPlacementScore * 100);
  return (
    `${paper.metrics.score.toFixed(1)} ${paper.id}: ` +
    `tables ${paper.metrics.markdownTableCount}/${sourceTables} (${tableCoverage}%); ` +
    `headings ${headingCoverage}%; arXiv ${arxivCoverage}%; ` +
    `pages ${paper.metrics.markdownPages}/${paper.metrics.sourcePages}`
  );
}

function formatPaperIssues(paper: MarkdownQualityPaper): string[] {
  const issues = [...paper.issues];

  for (const page of paper.sourceTablesByPage) {
    if (page.count > 0) {
      const suffix = page.tableNumbers.length > 0 ? ` (${page.tableNumbers.join(', ')})` : '';
      issues.push(`source page ${page.page}: ${page.count} table(s)${suffix}`);
    }
  }
  for (const issue of paper.headingIssues.slice(0, 3)) {
    issues.push(`line ${issue.line}: ${issue.message}`);
  }

  return issues;
}

function hasFailures(report: MarkdownQualityReport, failBelow?: number): boolean {
  if (report.summary.missingMarkdown > 0 || report.summary.missingPdf > 0) return true;
  if (failBelow === undefined) return false;
  return report.papers.some((paper) => paper.metrics.score < failBelow);
}

export function registerScoreMarkdownQualityCommand(program: Command): void {
  program
    .command('score-markdown-quality')
    .description('Score extracted Markdown against local PDF layout signals')
    .option('--doi <doi>', 'Only score one DOI from the DB corpus')
    .option('--limit <n>', 'Maximum number of DB corpus citations to score')
    .option('--paper-path <path>', 'Directory of local PDF papers to score')
    .option('--markdown-path <path>', 'Directory of extracted Markdown files to compare')
    .option('--recursive', 'Recursively scan --paper-path for PDFs')
    .option('--fail-below <score>', 'Exit non-zero when any paper scores below this 0-100 value')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ScoreMarkdownQualityCommandOptions) => {
      try {
        const failBelow = parseScoreThreshold(options.failBelow);
        const report = await scoreMarkdownQuality({
          doi: options.doi,
          limit: parsePositiveInteger(options.limit),
          paperPath: options.paperPath,
          markdownPath: options.markdownPath,
          recursive: options.recursive,
        });
        const failed = hasFailures(report, failBelow);

        if (options.json) {
          print(JSON.stringify(report, null, 2));
        } else {
          const color = failed ? yellow : green;
          print(
            ...formatSummary(report, failBelow).map((line, index) =>
              index === 0 ? color(line) : line
            )
          );
        }

        if (failed) process.exitCode = 1;
      } catch (error) {
        printError(red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
