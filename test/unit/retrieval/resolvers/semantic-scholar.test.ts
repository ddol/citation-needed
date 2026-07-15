import axios from 'axios';

// Collapse the real 1s rate limit and 3/6/12s backoff so retry behaviour can be
// asserted without the sleeping.
jest.mock('../../../../src/retrieval/config', () => ({
  ...jest.requireActual('../../../../src/retrieval/config'),
  SEMANTIC_SCHOLAR_RATE_LIMIT_MS: 0,
  SEMANTIC_SCHOLAR_RETRY_BASE_MS: 0,
}));

// eslint-disable-next-line import/first, import/order
import { SemanticScholarResolver } from '../../../../src/retrieval/resolvers/semantic-scholar';
// eslint-disable-next-line import/first, import/order
import { SEMANTIC_SCHOLAR_MAX_ATTEMPTS } from '../../../../src/retrieval/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SemanticScholarResolver', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the open-access PDF url and upstream title', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { title: 'PCL', openAccessPdf: { url: 'https://pointclouds.org/pcl.pdf' } },
    });

    const result = await new SemanticScholarResolver().getOpenAccessPdf(
      '10.1109/ICRA.2011.5980567'
    );

    expect(result).toEqual({
      ok: true,
      value: { pdfUrl: 'https://pointclouds.org/pcl.pdf', title: 'PCL' },
    });
  });

  test('queries by DOI, requesting only the fields we use', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { openAccessPdf: null } });

    await new SemanticScholarResolver().getOpenAccessPdf('10.1/a b');

    const url = mockedAxios.get.mock.calls[0][0] as string;
    expect(url).toContain('/paper/DOI:10.1%2Fa%20b');
    expect(url).toContain('fields=title,openAccessPdf');
  });

  test('reports no PDF as a null value rather than an error', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { title: 'Closed', openAccessPdf: null } });

    const result = await new SemanticScholarResolver().getOpenAccessPdf('10.1/closed');

    expect(result).toEqual({ ok: true, value: null });
  });

  // A throttled lookup must not be reported as "this paper has no PDF".
  test('retries a 429 and then succeeds', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({ response: { status: 429, headers: {} } })
      .mockResolvedValueOnce({ data: { title: 'X', openAccessPdf: { url: 'https://x/y.pdf' } } });

    const result = await new SemanticScholarResolver().getOpenAccessPdf('10.1/x');

    expect(result.ok).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test('surfaces an error after exhausting the attempt budget', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 429, headers: {} } });

    const result = await new SemanticScholarResolver().getOpenAccessPdf('10.1/x');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(SEMANTIC_SCHOLAR_MAX_ATTEMPTS);
  });

  test('does not retry a 404 (DOI simply unknown to Semantic Scholar)', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404, headers: {} } });

    const result = await new SemanticScholarResolver().getOpenAccessPdf('10.1/unknown');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
