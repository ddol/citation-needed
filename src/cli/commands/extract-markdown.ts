import { Command } from 'commander';
import {
  reextractMarkdownFromPdfFolder,
  reextractMarkdownFromLocalPdfs,
  type MarkdownReextractProgress,
  type MarkdownReextractSummary,
} from '../../services/markdown-extraction';
import { dim, green, print, printError, red } from '../output';

interface ExtractMarkdownCommandOptions {
  doi?: string;
  limit?: string;
  paperPath?: string;
  markdownPath?: string;
  recursive?: boolean;
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

function formatSummary(summary: MarkdownReextractSummary, notes: string[] = []): string[] {
  const line =
    `Re-extracted Markdown for ${summary.extracted} citation(s); ` +
    `${summary.missingPdf} missing local PDF(s); ${summary.failed} failed; ` +
    `${summary.scanned} scanned.`;
  const lines = [line, dim('Network: disabled; only already-recorded local PDFs were read.')];

  for (const error of summary.errors) {
    lines.push(`${error.doi}: ${error.message}`);
  }

  lines.push(...notes);

  return lines;
}

function hasFailures(summary: MarkdownReextractSummary): boolean {
  return summary.missingPdf > 0 || summary.failed > 0;
}

function getUsageNotes(
  options: ExtractMarkdownCommandOptions,
  summary: MarkdownReextractSummary
): string[] {
  if (summary.scanned > 0 || options.paperPath || options.doi || !options.markdownPath) {
    return [];
  }

  return [
    'Hint: `--markdown-path` alone does not scan a PDF directory; DB-backed extraction is the default mode.',
    'Hint: To scan local PDFs directly, pass both `--paper-path <pdf-dir>` and `--markdown-path <markdown-dir>`.',
  ];
}

async function runExtraction(
  options: ExtractMarkdownCommandOptions,
  onProgress?: (progress: MarkdownReextractProgress) => void
): Promise<MarkdownReextractSummary> {
  const limit = parseLimit(options.limit);

  if (options.paperPath) {
    if (!options.markdownPath) {
      throw new Error('--markdown-path is required when --paper-path is used');
    }
    return reextractMarkdownFromPdfFolder({
      paperPath: options.paperPath,
      markdownPath: options.markdownPath,
      limit,
      recursive: options.recursive,
      onProgress,
    });
  }

  return reextractMarkdownFromLocalPdfs({
    doi: options.doi,
    limit,
    markdownPath: options.markdownPath,
    onProgress,
  });
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
    .option('--paper-path <path>', 'Directory of local PDFs to extract without using the DB')
    .option('--markdown-path <path>', 'Directory for Markdown files without an existing path')
    .option('--recursive', 'Recursively scan --paper-path for PDFs')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ExtractMarkdownCommandOptions) => {
      const progress = options.json ? undefined : createProgressRenderer();
      try {
        const summary = await runExtraction(options, progress?.render);
        const usageNotes = getUsageNotes(options, summary);
        const shouldFail = hasFailures(summary) || usageNotes.length > 0;
        progress?.finish();

        if (options.json) {
          print(JSON.stringify(summary, null, 2));
        } else {
          const color = shouldFail ? red : green;
          print(
            ...formatSummary(summary, usageNotes).map((line, index) =>
              index === 0 ? color(line) : line
            )
          );
        }

        if (shouldFail) process.exitCode = 1;
      } catch (error) {
        progress?.finish();
        printError(red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
