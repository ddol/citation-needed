import fs from 'fs';
import os from 'os';
import path from 'path';

// One fake retriever for both surfaces: the point of this suite is that the
// two paths agree, which only means something if they run the same pipeline
// over the same inputs. Nothing here may touch the network.
const mockRetrievePdf = jest.fn();
jest.mock('../../src/retrieval/index', () => ({
  RetrievalOrchestrator: jest.fn().mockImplementation(() => ({
    retrievePdf: (...args: unknown[]) => mockRetrievePdf(...args),
    resetTransientState: () => undefined,
  })),
}));

jest.mock('../../src/verification/markdown', () => ({
  ...jest.requireActual('../../src/verification/markdown'),
  extractPdfMarkdown: async () => '# Parity Paper\n\nExtracted body text.',
}));

/* eslint-disable import/first */
import { Database } from '../../src/db/index';
import type { Citation } from '../../src/models/citation';
import { ImportService } from '../../src/services/import';
import { handleCitationTool } from '../../src/mcp/tools/citations';
/* eslint-enable import/first */

const BIBTEX = `
@article{parity2024,
  title = {Parity Paper},
  doi = {10.1234/parity.one},
  year = {2024},
  author = {A. Author}
}
@article{missing2024,
  title = {Missing Paper},
  doi = {10.1234/parity.two},
  year = {2024}
}
@article{nodoi2024,
  title = {No DOI At All},
  year = {2024}
}
`;

interface Surface {
  root: string;
  db: Database;
}

function makeSurface(name: string): Surface {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `cn-parity-${name}-`));
  return { root, db: new Database(path.join(root, 'citations.db')) };
}

/**
 * The comparable shape of a surface's database after an import. Paths are made
 * relative to that surface's own root, because the two runs deliberately write
 * to different directories and absolute paths would differ for that reason
 * alone. Timestamps and row ids are dropped for the same reason.
 */
function snapshot(surface: Surface) {
  const citations = surface.db.getAllCitations() as Citation[];
  const relative = (value: unknown): unknown =>
    typeof value === 'string' && value.startsWith(surface.root)
      ? path.relative(surface.root, value)
      : value;

  return citations
    .map((citation) => ({
      doi: citation.doi,
      title: citation.title,
      year: citation.year,
      authors: citation.authors,
      bibtexKey: citation.bibtexKey,
      verificationStatus: citation.verificationStatus,
      pdfPath: relative(citation.pdfPath),
      manifestations: (['pdf', 'markdown-extracted'] as const)
        .map((kind) => surface.db.getManifestation(citation.id as number, kind))
        .filter((manifestation) => manifestation !== undefined)
        .map((manifestation) => ({
          kind: manifestation!.kind,
          path: relative(manifestation!.path),
          contentHash: manifestation!.contentHash,
          extractorName: manifestation!.extractorName,
        })),
      retrievalLog: surface.db.getRetrievalLog(citation.doi as string).map((attempt) => ({
        source: attempt.source,
        success: attempt.success,
        errorMessage: attempt.errorMessage,
      })),
    }))
    .sort((a, b) => String(a.doi).localeCompare(String(b.doi)));
}

describe('CLI and MCP import parity', () => {
  let cli: Surface;
  let mcp: Surface;
  let bibtexPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    cli = makeSurface('cli');
    mcp = makeSurface('mcp');
    bibtexPath = path.join(cli.root, 'refs.bib');
    fs.writeFileSync(bibtexPath, BIBTEX);

    // One DOI resolves, one is genuinely absent, one entry has no DOI at all,
    // so parity has to hold across success, failure, and skip.
    mockRetrievePdf.mockImplementation(async (doi: string) => {
      if (doi !== '10.1234/parity.one') {
        return { success: false, source: 'test', message: 'No PDF found' };
      }
      // The workflow passes paperPath to the orchestrator constructor, which
      // the mock ignores, so derive the destination from the calling surface.
      const dir = fs.existsSync(path.join(mcp.root, 'pdf-out'))
        ? path.join(mcp.root, 'pdf-out')
        : path.join(cli.root, 'pdf-out');
      const localPath = path.join(dir, 'parity2024.pdf');
      fs.writeFileSync(localPath, '%PDF-1.4 parity');
      return { success: true, localPath, source: 'test', message: 'Downloaded' };
    });
  });

  afterEach(() => {
    cli.db.close();
    mcp.db.close();
    fs.rmSync(cli.root, { recursive: true, force: true });
    fs.rmSync(mcp.root, { recursive: true, force: true });
  });

  test('the same .bib leaves both databases in the same state', async () => {
    const cliSummary = await new ImportService(cli.db).import({
      source: { bibtexPath },
      paperPath: path.join(cli.root, 'pdf-out'),
      markdownPath: path.join(cli.root, 'md-out'),
      metadataOnly: false,
    });

    // The MCP surface is handed the same bytes as a string, which is the only
    // difference between the two calls.
    const toolResult = await handleCitationTool(
      'import-bibtex',
      {
        bibtex: fs.readFileSync(bibtexPath, 'utf-8'),
        paperPath: path.join(mcp.root, 'pdf-out'),
        markdownPath: path.join(mcp.root, 'md-out'),
      },
      mcp.db
    );

    expect(snapshot(mcp)).toEqual(snapshot(cli));

    // Guard against a vacuous pass: two empty snapshots are also equal. The
    // downloaded paper must really carry both manifestations, under each
    // surface's own output directory.
    const downloaded = snapshot(cli).find((row) => row.doi === '10.1234/parity.one');
    expect(downloaded?.manifestations).toEqual([
      expect.objectContaining({ kind: 'pdf', path: path.join('pdf-out', 'parity2024.pdf') }),
      expect.objectContaining({
        kind: 'markdown-extracted',
        path: path.join('md-out', 'parity2024.md'),
        extractorName: expect.any(String),
      }),
    ]);
    expect(fs.existsSync(path.join(mcp.root, 'md-out', 'parity2024.md'))).toBe(true);

    // Counts the two surfaces report must agree too, not just the rows.
    expect(cliSummary.importedCount).toBe(2);
    expect(cliSummary.downloadedCount).toBe(1);
    expect(cliSummary.markdownCount).toBe(1);
    expect(cliSummary.skippedCount).toBe(1);
    expect(cliSummary.failures).toHaveLength(1);

    const report = JSON.parse(toolResult?.content[0].text ?? '{}');
    expect(report.imported).toBe(cliSummary.importedCount);
    expect(report.downloaded).toBe(cliSummary.downloadedCount);
    expect(report.extracted).toBe(cliSummary.markdownCount);
    expect(report.skipped).toEqual(cliSummary.skippedEntries);
    expect(report.failures).toEqual(cliSummary.failures);
  });

  test('metadata-only imports agree, and neither writes a file', async () => {
    await new ImportService(cli.db).import({
      source: { bibtexPath },
      paperPath: path.join(cli.root, 'pdf-out'),
      markdownPath: path.join(cli.root, 'md-out'),
      metadataOnly: true,
    });

    await handleCitationTool(
      'import-bibtex',
      {
        bibtex: fs.readFileSync(bibtexPath, 'utf-8'),
        paperPath: path.join(mcp.root, 'pdf-out'),
        markdownPath: path.join(mcp.root, 'md-out'),
        metadataOnly: true,
      },
      mcp.db
    );

    expect(snapshot(mcp)).toEqual(snapshot(cli));
    expect(mockRetrievePdf).not.toHaveBeenCalled();
    // Metadata-only promises to write nothing, directories included.
    expect(fs.existsSync(path.join(cli.root, 'pdf-out'))).toBe(false);
    expect(fs.existsSync(path.join(mcp.root, 'md-out'))).toBe(false);
  });
});
