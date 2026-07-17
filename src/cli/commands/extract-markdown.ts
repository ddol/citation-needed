import { Command } from 'commander';
import {
  reextractMarkdownFromLocalPdfs,
  type MarkdownReextractProgress,
  type MarkdownReextractSummary,
} from '../../services/markdown-extraction';
import { dim, green, print, printError, red } from '../output';

interface ExtractMarkdownCommandOptions {
  doi?: string;
  limit?: string;
  markdownPath?: string;
  json?: boolean;
}

function parseLimit(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--limit must be a positive integer');
  }
  return parsed;
}

function formatSummary(summary: MarkdownReextractSummary): string[] {
  const line =
    `Re-extracted Markdown for ${summary.extracted} citation(s); ` +
    `${summary.missingPdf} missing local PDF(s); ${summary.failed} failed; ` +
    `${summary.scanned} scanned.`;
  const lines = [line, dim('Network: disabled; only already-recorded local PDFs were read.')];

  for (const error of summary.errors) {
    lines.push(`${error.doi}: ${error.message}`);
  }

  return lines;
}

function hasFailures(summary: MarkdownReextractSummary): boolean {
  return summary.missingPdf > 0 || summary.failed > 0;
}

function createProgressRenderer(): {
  render: (progress: MarkdownReextractProgress) => void;
  finish: () => void;
} {
  let lastLength = 0;
  let rendered = false;

  const render = (progress: MarkdownReextractProgress): void => {
    const suffix = progress.doi ? ` ${progress.doi} (${progress.status})` : ` ${progress.status}`;
    const line = `Markdown extraction ${progress.current}/${progress.total}${suffix}`;
    process.stderr.write(`\r${line}${' '.repeat(Math.max(0, lastLength - line.length))}`);
    lastLength = line.length;
    rendered = true;
  };

  const finish = (): void => {
    if (rendered) process.stderr.write('\n');
  };

  return { render, finish };
}

export function registerExtractMarkdownCommand(program: Command): void {
  program
    .command('extract-markdown')
    .description('Re-run PDF-to-Markdown extraction from already downloaded local PDFs')
    .option('--doi <doi>', 'Only re-extract Markdown for one DOI')
    .option('--limit <n>', 'Maximum number of citations to scan')
    .option('--markdown-path <path>', 'Directory for Markdown files without an existing path')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ExtractMarkdownCommandOptions) => {
      const progress = options.json ? undefined : createProgressRenderer();
      try {
        const summary = await reextractMarkdownFromLocalPdfs({
          doi: options.doi,
          limit: parseLimit(options.limit),
          markdownPath: options.markdownPath,
          onProgress: progress?.render,
        });
        progress?.finish();

        if (options.json) {
          print(JSON.stringify(summary, null, 2));
        } else {
          const color = hasFailures(summary) ? red : green;
          print(...formatSummary(summary).map((line, index) => (index === 0 ? color(line) : line)));
        }

        if (hasFailures(summary)) process.exitCode = 1;
      } catch (error) {
        progress?.finish();
        printError(red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
