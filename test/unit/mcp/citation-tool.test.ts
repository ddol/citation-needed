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
  beforeEach(() => {
    jest.clearAllMocks();
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

  // Regression: `progress` used to be incremented for any terminal-looking
  // stage, so one throttled entry produced three notifications against a total
  // of one. The retry banner also reads as 'skipped', and the retry pass emits
  // a second terminal stage for an entry already counted.
  test('never reports more progress than there are entries, even across a retry', async () => {
    const { RetrievalOrchestrator } = jest.requireMock('../../../src/retrieval/index');
    let attempt = 0;
    RetrievalOrchestrator.mockImplementation(() => ({
      resetTransientState: () => undefined,
      retrievePdf: async () => {
        attempt += 1;
        return attempt === 1
          ? { success: false, throttled: true, source: 'test', message: 'rate limited' }
          : { success: false, source: 'test', message: 'still nothing' };
      },
    }));
    const sendProgress = jest.fn();

    await handleCitationTool(
      'import-bibtex',
      { bibtex: '@article{one2024, title={One}, doi={10.1234/one}}' },
      makeDb(),
      { sendProgress }
    );

    expect(attempt).toBe(2); // the retry really did run
    expect(sendProgress).toHaveBeenCalledTimes(1);
    expect(sendProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 1, total: 1 }));
  });

  // The consolidation this guards: an agent importing a .bib gets the same
  // pipeline the CLI runs, so the corpus it just imported is groundable.
  test('runs the full pipeline by default, reporting downloads and failures', async () => {
    const db = makeDb();

    const result = await handleCitationTool('import-bibtex', { bibtex }, db);

    const report = JSON.parse(result?.content[0].text ?? '{}');
    expect(report.downloaded).toBe(0);
    expect(report.extracted).toBe(0);
    expect(report.failures).toEqual([
      { doi: '10.1234/VALID', stage: 'download', message: 'no PDF in tests' },
    ]);
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
