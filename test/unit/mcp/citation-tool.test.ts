import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Database } from '../../../src/db/index';
import { handleCitationTool } from '../../../src/mcp/tools/citations';

const mockSearchByTitle = jest.fn();

jest.mock('../../../src/retrieval/resolvers/arxiv', () => ({
  ArxivResolver: jest.fn().mockImplementation(() => ({
    searchByTitle: mockSearchByTitle,
  })),
}));

// import-bibtex now runs the real retrieval pipeline by default. Stub the
// retriever and the extractor rather than the workflow, so this suite still
// exercises the tool through ImportService into the workflow, but can never
// reach the network.
jest.mock('../../../src/retrieval/index', () => ({
  RetrievalOrchestrator: jest.fn().mockImplementation(() => ({
    retrievePdf: async () => ({ success: false, source: 'test', message: 'no PDF in tests' }),
    resetTransientState: () => undefined,
  })),
}));

function makeDb(): Database {
  return {
    getCitation: jest.fn(),
    getAllCitations: jest.fn(() => []),
    addCitation: jest.fn((citation) => citation),
  } as unknown as Database;
}

describe('MCP citation tool handler', () => {
  // A full-pipeline import writes real directories. Without an explicit output
  // root it defaults to the working directory, which for a unit run is the repo
  // itself: untracked papers/pdf and papers/markdown left behind, and shared
  // state between tests.
  let outputRoot: string;

  beforeEach(() => {
    jest.clearAllMocks();
    outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-mcp-import-'));
  });

  afterEach(() => {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });

  const outputPaths = (): { paperPath: string; markdownPath: string } => ({
    paperPath: path.join(outputRoot, 'pdf'),
    markdownPath: path.join(outputRoot, 'markdown'),
  });

  const bibtex = `
@article{valid2024, title={Valid}, doi={https://doi.org/10.1234/VALID}, year={2024}}
@article{bad2024, title={Bad}, doi={not-a-doi}, year={2024}}
@article{nodoi2024, title={No DOI}, year={2024}}
`;

  test('imports valid BibTeX entries, skips invalid entries, and sends progress', async () => {
    const db = makeDb();
    const sendProgress = jest.fn();

    const result = await handleCitationTool('import-bibtex', { bibtex, metadataOnly: true }, db, {
      sendProgress,
    });

    expect(db.addCitation).toHaveBeenCalledWith(expect.objectContaining({ doi: '10.1234/VALID' }));
    // One notification per entry, never per stage change.
    expect(sendProgress).toHaveBeenCalledTimes(3);
    // Structured, not prose: a caller acts on these fields without parsing English.
    const report = JSON.parse(result?.content[0].text ?? '{}');
    expect(report.imported).toBe(1);
    expect(report.skipped.map((entry: { reason: string }) => entry.reason)).toEqual([
      'invalid DOI format: not-a-doi',
      'no DOI',
    ]);
    // Metadata-only says nothing about downloads it never attempted.
    expect(report.downloaded).toBeUndefined();
    expect(report.markdownPath).toBeUndefined();
  });

  // The consolidation this guards: an agent importing a .bib gets the same
  // pipeline the CLI runs, so the corpus it just imported is groundable.
  test('runs the full pipeline by default, reporting downloads and failures', async () => {
    const db = makeDb();

    const result = await handleCitationTool('import-bibtex', { bibtex, ...outputPaths() }, db);

    const report = JSON.parse(result?.content[0].text ?? '{}');
    expect(report.downloaded).toBe(0);
    expect(report.extracted).toBe(0);
    expect(report.failures).toEqual([
      { doi: '10.1234/VALID', stage: 'download', message: 'no PDF in tests' },
    ]);
    // Output stayed inside the temp root rather than defaulting to the working
    // directory, which for a unit run is the repo itself.
    expect(report.paperPath).toBe(path.join(outputRoot, 'pdf'));
    expect(report.markdownPath.startsWith(outputRoot)).toBe(true);
  });

  // Regression: `Promise.resolve(send(...))` evaluates `send` before
  // `Promise.resolve` runs, so a transport that throws synchronously escaped
  // into the workflow and aborted the import. Progress is a side channel; it
  // must never be able to fail the work it is reporting on.
  test('survives a progress channel that throws synchronously', async () => {
    const sendProgress = jest.fn(() => {
      throw new Error('transport closed');
    });

    const result = await handleCitationTool(
      'import-bibtex',
      { bibtex, metadataOnly: true },
      makeDb(),
      { sendProgress }
    );

    expect(sendProgress).toHaveBeenCalledTimes(3);
    expect(result?.isError).toBeUndefined();
    expect(JSON.parse(result?.content[0].text ?? '{}').imported).toBe(1);
  });

  test('supports arXiv search success and failure responses', async () => {
    mockSearchByTitle.mockResolvedValueOnce({
      ok: true,
      value: [{ title: 'Found Paper', pdfUrl: 'https://arxiv.org/pdf/1' }],
    });
    const success = await handleCitationTool('search-arxiv', { title: 'Found Paper' }, makeDb());

    expect(JSON.parse(success?.content[0].text ?? '[]')[0].title).toBe('Found Paper');

    mockSearchByTitle.mockResolvedValueOnce({ ok: false, error: 'offline' });
    const failure = await handleCitationTool('search-arxiv', { title: 'Found Paper' }, makeDb());

    expect(failure?.isError).toBe(true);
    expect(failure?.content[0].text).toBe('arXiv search failed: offline');
  });

  test('returns null for unknown tools and validation errors for bad arguments', async () => {
    await expect(handleCitationTool('unknown', {}, makeDb())).resolves.toBeNull();

    const result = await handleCitationTool('list-citations', { limit: 500 }, makeDb());

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('Invalid arguments for list-citations');
  });
});
