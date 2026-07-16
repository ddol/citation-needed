import axios from 'axios';

// Collapse the real 1s rate limit and 3/6/12s backoff so retry behaviour can be
// asserted without the sleeping.
jest.mock('../../../../src/retrieval/config', () => ({
  ...jest.requireActual('../../../../src/retrieval/config'),
  SEMANTIC_SCHOLAR_RATE_LIMIT_MS: 0,
  SEMANTIC_SCHOLAR_RETRY_BASE_MS: 0,
}));

// eslint-disable-next-line import/first, import/order
import {
  SemanticScholarResolver,
  isSemanticScholarBreakerOpen,
  resetSemanticScholarBreaker,
} from '../../../../src/retrieval/resolvers/semantic-scholar';
// eslint-disable-next-line import/first, import/order
import {
  SEMANTIC_SCHOLAR_MAX_ATTEMPTS,
  SEMANTIC_SCHOLAR_THROTTLE_TRIP,
  SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS,
} from '../../../../src/retrieval/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const throttle = () => ({ response: { status: 429, headers: {} } });

describe('SemanticScholarResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSemanticScholarBreaker();
  });

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

  // Without a key, extra attempts are load added to a pool already refusing us.
  test('retries a throttled lookup only once when no API key is configured', async () => {
    mockedAxios.get.mockRejectedValue(throttle());

    const result = await new SemanticScholarResolver(undefined).getOpenAccessPdf('10.1/x');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    if (!result.ok) expect(result.error).toContain('SEMANTIC_SCHOLAR_API_KEY');
  });

  test('spends the full attempt budget when an API key buys a real quota', async () => {
    mockedAxios.get.mockRejectedValue(throttle());

    const result = await new SemanticScholarResolver('key-123').getOpenAccessPdf('10.1/x');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(SEMANTIC_SCHOLAR_MAX_ATTEMPTS);
  });

  test('sends the API key as x-api-key when configured', async () => {
    mockedAxios.get.mockResolvedValueOnce({ data: { openAccessPdf: null } });

    await new SemanticScholarResolver('key-123').getOpenAccessPdf('10.1/x');

    expect(mockedAxios.get.mock.calls[0][1]).toEqual(
      expect.objectContaining({ headers: { 'x-api-key': 'key-123' } })
    );
  });

  // Regression: a real import burned ~13 minutes retrying 38 DOIs against a
  // pool that was refusing every one of them.
  test('trips a breaker after consecutive throttles and stops calling the API', async () => {
    mockedAxios.get.mockRejectedValue(throttle());
    const resolver = new SemanticScholarResolver(undefined);

    for (let i = 0; i < SEMANTIC_SCHOLAR_THROTTLE_TRIP; i += 1) {
      await resolver.getOpenAccessPdf(`10.1/x${i}`);
    }
    expect(isSemanticScholarBreakerOpen()).toBe(true);

    const callsBefore = mockedAxios.get.mock.calls.length;
    const result = await resolver.getOpenAccessPdf('10.1/after-trip');

    expect(mockedAxios.get).toHaveBeenCalledTimes(callsBefore);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('rate limited');
  });

  // Regression: an earlier breaker stayed open for the whole run. Throttling is
  // a passing streak, so that cost a 56-entry import every paper only Semantic
  // Scholar carries — Semantic Scholar contributed zero.
  test('reopens for a probe after the cooldown and closes when the pool answers', async () => {
    // Move the clock, not the timers: the shared RateLimiter chains its waits
    // through setTimeout, and freezing those leaves every later wait chained off
    // a promise that never resolves.
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      mockedAxios.get.mockRejectedValue(throttle());
      const resolver = new SemanticScholarResolver(undefined);
      for (let i = 0; i < SEMANTIC_SCHOLAR_THROTTLE_TRIP; i += 1) {
        await resolver.getOpenAccessPdf(`10.1/x${i}`);
      }
      expect(isSemanticScholarBreakerOpen()).toBe(true);

      const callsWhileOpen = mockedAxios.get.mock.calls.length;
      await resolver.getOpenAccessPdf('10.1/during-cooldown');
      expect(mockedAxios.get).toHaveBeenCalledTimes(callsWhileOpen);

      // Cooldown elapses: one probe is allowed through, and it lands.
      clock.mockReturnValue(SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS);
      expect(isSemanticScholarBreakerOpen()).toBe(false);
      mockedAxios.get.mockReset();
      mockedAxios.get.mockResolvedValue({
        data: { title: 'X', openAccessPdf: { url: 'https://x/y.pdf' } },
      });

      const result = await resolver.getOpenAccessPdf('10.1/after-cooldown');

      expect(result).toEqual({ ok: true, value: { pdfUrl: 'https://x/y.pdf', title: 'X' } });
      expect(isSemanticScholarBreakerOpen()).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  test('a failed probe restarts the cooldown instead of letting every DOI probe', async () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      mockedAxios.get.mockRejectedValue(throttle());
      const resolver = new SemanticScholarResolver(undefined);
      for (let i = 0; i < SEMANTIC_SCHOLAR_THROTTLE_TRIP; i += 1) {
        await resolver.getOpenAccessPdf(`10.1/x${i}`);
      }

      clock.mockReturnValue(SEMANTIC_SCHOLAR_BREAKER_COOLDOWN_MS);
      await resolver.getOpenAccessPdf('10.1/probe'); // probe fails
      expect(isSemanticScholarBreakerOpen()).toBe(true);

      const callsAfterProbe = mockedAxios.get.mock.calls.length;
      await resolver.getOpenAccessPdf('10.1/next');
      expect(mockedAxios.get).toHaveBeenCalledTimes(callsAfterProbe);
    } finally {
      clock.mockRestore();
    }
  });

  test('a successful lookup clears the throttle streak', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(throttle())
      .mockRejectedValueOnce(throttle())
      .mockResolvedValueOnce({ data: { title: 'X', openAccessPdf: { url: 'https://x/y.pdf' } } });
    const resolver = new SemanticScholarResolver(undefined);

    await resolver.getOpenAccessPdf('10.1/throttled');
    await resolver.getOpenAccessPdf('10.1/ok');

    expect(isSemanticScholarBreakerOpen()).toBe(false);
  });

  // A 404 means "unknown DOI", not "the API is refusing us".
  test('a 404 does not count toward the breaker', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404, headers: {} } });
    const resolver = new SemanticScholarResolver(undefined);

    for (let i = 0; i < SEMANTIC_SCHOLAR_THROTTLE_TRIP + 1; i += 1) {
      await resolver.getOpenAccessPdf(`10.1/unknown${i}`);
    }

    expect(isSemanticScholarBreakerOpen()).toBe(false);
  });

  test('does not retry a 404 (DOI simply unknown to Semantic Scholar)', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 404, headers: {} } });

    const result = await new SemanticScholarResolver().getOpenAccessPdf('10.1/unknown');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
