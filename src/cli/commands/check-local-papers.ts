import { Command } from 'commander';
import {
  checkLocalPapers,
  type CheckLocalPapersOptions,
  type LocalPaperCheckEntry,
  type LocalPaperCheckResult,
} from '../../services/local-paper-check';
import { bold, dim, green, print, printError, red, yellow } from '../output';

interface CheckLocalPapersCommandOptions {
  paperPath?: string;
  recursive?: boolean;
  json?: boolean;
}

function statusLabel(entry: LocalPaperCheckEntry): string {
  switch (entry.status) {
    case 'matched':
      return green('MATCHED');
    case 'missing':
      return red('MISSING');
    case 'mismatch':
      return red('MISMATCH');
    case 'ambiguous':
      return yellow('AMBIGUOUS');
    case 'skipped':
      return yellow('SKIPPED');
    default:
      return entry.status;
  }
}

export function formatLocalPaperCheck(result: LocalPaperCheckResult): string[] {
  const { summary } = result;
  const lines = [
    bold('Local paper check'),
    `BibTeX: ${result.bibtexPath}`,
    `PDF directory: ${result.paperPath}`,
    dim('Network: disabled; only local files were inspected.'),
    '',
    `Checked ${summary.total} BibTeX entr${summary.total === 1 ? 'y' : 'ies'}: ` +
      `${summary.matched} matched, ${summary.missing} missing, ${summary.mismatch} mismatch, ` +
      `${summary.ambiguous} ambiguous, ${summary.skipped} skipped.`,
    '',
  ];

  for (const entry of result.entries) {
    const target = entry.doi ?? entry.label;
    const location = entry.pdfPath ? ` -> ${entry.pdfPath}` : '';
    lines.push(`${statusLabel(entry)} ${target}${location}`);
    lines.push(`  ${entry.message}`);
    if (entry.expectedFilenames.length > 0 && entry.status !== 'matched') {
      lines.push(`  Expected names: ${entry.expectedFilenames.join(', ')}`);
    }
  }

  return lines;
}

function hasFailures(result: LocalPaperCheckResult): boolean {
  const { summary } = result;
  return (
    summary.missing > 0 || summary.mismatch > 0 || summary.ambiguous > 0 || summary.skipped > 0
  );
}

export function registerCheckLocalPapersCommand(program: Command): void {
  program
    .command('check-local-papers <bibtex-file>')
    .description('Validate local PDFs against a BibTeX file without network requests')
    .option('--paper-path <path>', 'Directory containing local PDF files')
    .option('--recursive', 'Scan PDF files recursively under --paper-path')
    .option('--json', 'Print machine-readable JSON')
    .action(async (bibtexFile: string, options: CheckLocalPapersCommandOptions) => {
      try {
        const request: CheckLocalPapersOptions = {
          paperPath: options.paperPath,
          recursive: options.recursive,
        };
        const result = await checkLocalPapers(bibtexFile, request);

        if (options.json) {
          print(JSON.stringify(result, null, 2));
        } else {
          print(...formatLocalPaperCheck(result));
        }

        if (hasFailures(result)) process.exitCode = 1;
      } catch (error) {
        printError(red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });
}
