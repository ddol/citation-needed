import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock the resolvers + open-access downloader so the orchestrator runs in isolation.
const mockGetOpenAccessPdf = jest.fn();
const mockArxivSearch = jest.fn();
const mockDownload = jest.fn();
const mockGetLocalPath = jest.fn();

jest.mock('../../../src/retrieval/resolvers/unpaywall', () => ({
  UnpaywallResolver: jest.fn().mockImplementation(() => ({
    getOpenAccessPdf: mockGetOpenAccessPdf,
  })),
}));
jest.mock('../../../src/retrieval/resolvers/arxiv', () => ({
  // Keep the real selectArxivMatch: the orchestrator's job is to reject
  // unrelated arXiv hits, so that guard must run for real here.
  ...jest.requireActual('../../../src/retrieval/resolvers/arxiv'),
  ArxivResolver: jest.fn().mockImplementation(() => ({
    searchByTitle: mockArxivSearch,
    getPdfUrl: (id: string) => `https://arxiv.org/pdf/${id}`,
  })),
}));
jest.mock('../../../src/retrieval/downloaders/open-access', () => ({
  OpenAccessDownloader: jest.fn().mockImplementation(() => ({
    download: mockDownload,
    getLocalPath: mockGetLocalPath,
  })),
}));

// eslint-disable-next-line import/first, import/order
import { RetrievalOrchestrator } from '../../../src/retrieval/index';

function makeFakeDb(citation: { doi: string; title?: string; pdfPath?: string } | null) {
  return {
    getCitation: jest.fn().mockReturnValue(citation),
    updatePdfPath: jest.fn(),
    updateVerificationStatus: jest.fn(),
    updateAccessType: jest.fn(),
    transaction: <T>(fn: () => T) => fn(),
  } as any;
}

describe('RetrievalOrchestrator', () => {
  let tempStorage: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-orch-'));
    mockGetLocalPath.mockReturnValue(null);
  });

  afterEach(() => {
    fs.rmSync(tempStorage, { recursive: true, force: true });
  });

  test('returns cached PDF when DB row already has a pdf_path that exists on disk', async () => {
    const cached = path.join(tempStorage, 'cached.pdf');
    fs.writeFileSync(cached, '%PDF');
    const db = makeFakeDb({ doi: '10/test', pdfPath: cached });
    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);

    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(true);
    expect(result.source).toBe('cache');
    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
  });

  test('downloads via Unpaywall when an OA URL is found', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: 'https://oa.example/paper.pdf' });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'paper.pdf'));
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(true);
    expect(result.source).toBe('unpaywall');
    expect(db.updatePdfPath).toHaveBeenCalledWith('10/test', path.join(tempStorage, 'paper.pdf'));
    expect(db.updateVerificationStatus).toHaveBeenCalledWith('10/test', 'downloaded');
    expect(db.updateAccessType).toHaveBeenCalledWith('10/test', 'open-access');
  });

  test('falls back to arXiv when Unpaywall has nothing, recording attempts', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({
      ok: true,
      value: [{ arxivId: '1706.03762', pdfUrl: 'https://arxiv.org/pdf/1706.03762', title: 'Att' }],
    });
    mockDownload.mockResolvedValueOnce(path.join(tempStorage, 'paper.pdf'));
    const db = makeFakeDb({ doi: '10/test', title: 'Att' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.source).toBe('arxiv');
    expect(result.success).toBe(true);
  });

  // Regression: the real run downloaded arXiv 1411.4413 (a CERN B_s->mumu
  // paper) for 10 unrelated citations, including papers published decades
  // before arXiv existed, because the first search hit was taken unchecked.
  test('does not download an arXiv hit whose title does not match the citation', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({
      ok: true,
      value: [
        {
          arxivId: '1411.4413',
          pdfUrl: 'https://arxiv.org/pdf/1411.4413',
          title: 'Observation of the rare $B^0_s\\to\\mu^+\\mu^-$ decay from CMS and LHCb data',
        },
      ],
    });
    const db = makeFakeDb({
      doi: '10/kalman',
      title: 'A New Approach to Linear Filtering and Prediction Problems',
    });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/kalman');

    expect(mockDownload).not.toHaveBeenCalled();
    expect(db.updatePdfPath).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain('arxiv(no confident title match');
  });

  test('accumulates per-step attempts into RetrievalResult.message on terminal failure', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({
      ok: false,
      error: 'Unpaywall lookup failed: timeout',
    });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'A Paper' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(result.success).toBe(false);
    expect(result.message).toContain('unpaywall(');
    expect(result.message).toContain('timeout');
    expect(result.message).toContain('arxiv(no matching paper)');
  });

  test('routes Springer DOIs through the publisher adapter step (currently no-op)', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10.1007/s00146-021-01196-y' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10.1007/s00146-021-01196-y');

    expect(result.success).toBe(false);
    expect(result.message).toContain('publisher(Springer');
  });

  test('marks publisher step as no-adapter for unknown DOI prefixes', async () => {
    mockGetOpenAccessPdf.mockResolvedValueOnce({ ok: true, value: null });
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10.9999/unknown' });

    const orch = new RetrievalOrchestrator(db, { email: 'me@me.com' }, tempStorage);
    const result = await orch.retrievePdf('10.9999/unknown');

    expect(result.message).toContain('publisher(no adapter for DOI prefix)');
  });

  test('skips Unpaywall entirely when no email is configured', async () => {
    mockArxivSearch.mockResolvedValueOnce({ ok: true, value: [] });
    const db = makeFakeDb({ doi: '10/test', title: 'X' });

    const orch = new RetrievalOrchestrator(db, {}, tempStorage);
    const result = await orch.retrievePdf('10/test');

    expect(mockGetOpenAccessPdf).not.toHaveBeenCalled();
    expect(result.message).toContain('unpaywall(skipped: no email configured)');
  });
});
