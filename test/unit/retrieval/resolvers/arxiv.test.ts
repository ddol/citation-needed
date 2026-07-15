import axios from 'axios';

// Collapse the real 3s rate limit and 5/10/20s backoff to zero: these tests
// assert retry *behaviour*, and the real delays would add ~45s of sleeping.
jest.mock('../../../../src/retrieval/config', () => ({
  ...jest.requireActual('../../../../src/retrieval/config'),
  ARXIV_RATE_LIMIT_MS: 0,
  ARXIV_RETRY_BASE_MS: 0,
}));

// eslint-disable-next-line import/first, import/order
import { ArxivResolver, selectArxivMatch } from '../../../../src/retrieval/resolvers/arxiv';
// eslint-disable-next-line import/first, import/order
import { ARXIV_MAX_ATTEMPTS } from '../../../../src/retrieval/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function atomFeed(entries: Array<{ id: string; title: string }>): string {
  const body = entries
    .map((e) => `<entry><id>http://arxiv.org/abs/${e.id}v1</id><title>${e.title}</title></entry>`)
    .join('');
  return `<feed>${body}</feed>`;
}

describe('ArxivResolver.searchByTitle', () => {
  beforeEach(() => jest.clearAllMocks());

  // Regression: an unquoted phrase is split by arXiv into
  // `ti:Note OR all:on OR all:a OR ...`, which matches most of the corpus and
  // returns an unrelated top hit.
  test('quotes the title so arXiv treats it as a phrase, not OR-ed terms', async () => {
    mockedAxios.get.mockResolvedValue({ data: atomFeed([]) });

    await new ArxivResolver().searchByTitle('Attention Is All You Need');

    const requestedUrl = mockedAxios.get.mock.calls[0][0] as string;
    const searchQuery = decodeURIComponent(/search_query=([^&]+)/.exec(requestedUrl)?.[1] ?? '');
    expect(searchQuery).toBe('ti:"Attention Is All You Need"');
    expect(searchQuery).not.toMatch(/ti:Attention\s/);
  });

  test('falls back to a quoted all: phrase query when the title search is empty', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: atomFeed([]) })
      .mockResolvedValueOnce({ data: atomFeed([{ id: '1706.03762', title: 'Attention' }]) });

    await new ArxivResolver().searchByTitle('RangeNet++: Fast and Accurate');

    const broadUrl = mockedAxios.get.mock.calls[1][0] as string;
    const searchQuery = decodeURIComponent(/search_query=([^&]+)/.exec(broadUrl)?.[1] ?? '');
    expect(searchQuery).toBe('all:"RangeNet Fast and Accurate"');
  });

  test('parses id and title out of the atom feed', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: atomFeed([{ id: '1706.03762', title: 'Attention Is All You Need' }]),
    });

    const result = await new ArxivResolver().searchByTitle('Attention Is All You Need');

    expect(result).toEqual({
      ok: true,
      value: [
        {
          arxivId: '1706.03762',
          pdfUrl: 'https://arxiv.org/pdf/1706.03762',
          title: 'Attention Is All You Need',
        },
      ],
    });
  });
});

describe('ArxivResolver throttling', () => {
  beforeEach(() => jest.clearAllMocks());

  function throttled(retryAfter?: string): unknown {
    return {
      response: { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} },
    };
  }

  // Regression: a 429 surfaced as `arxiv(no matching paper)`, so a throttled
  // lookup was indistinguishable from a paper arXiv does not host. 36 of 54
  // failures in a real 56-entry import were this.
  test('retries a 429 and succeeds, rather than reporting the paper as missing', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(throttled())
      .mockResolvedValueOnce({ data: atomFeed([{ id: '1703.07402', title: 'DeepSORT' }]) });

    const result = await new ArxivResolver().searchByTitle('DeepSORT');

    expect(result).toEqual({
      ok: true,
      value: [
        { arxivId: '1703.07402', pdfUrl: 'https://arxiv.org/pdf/1703.07402', title: 'DeepSORT' },
      ],
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test('gives up after the attempt budget and reports the error, not an empty result', async () => {
    mockedAxios.get.mockRejectedValue(throttled());

    const result = await new ArxivResolver().searchByTitle('Anything');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(ARXIV_MAX_ATTEMPTS);
  });

  test('retries 5xx as well as 429', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({ response: { status: 503, headers: {} } })
      .mockResolvedValueOnce({ data: atomFeed([{ id: '1/x', title: 'X' }]) });

    const result = await new ArxivResolver().searchByTitle('X');

    expect(result.ok).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  test('does not retry a non-transient error', async () => {
    mockedAxios.get.mockRejectedValue({ response: { status: 400, headers: {} } });

    const result = await new ArxivResolver().searchByTitle('X');

    expect(result.ok).toBe(false);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe('selectArxivMatch', () => {
  const candidate = (title: string) => ({
    arxivId: 'x',
    pdfUrl: 'https://arxiv.org/pdf/x',
    title,
  });

  test('accepts a near-exact title match', () => {
    const match = selectArxivMatch('Attention Is All You Need', [
      candidate('Attention Is All You Need'),
    ]);
    expect(match?.title).toBe('Attention Is All You Need');
  });

  // Regression: this run downloaded arXiv 1411.4413 (a CERN B_s->mumu paper)
  // for 10 unrelated citations because the first result was taken unchecked.
  test('rejects an unrelated first result instead of downloading it', () => {
    const match = selectArxivMatch(
      'Note on a Method for Calculating Corrected Sums of Squares and Products',
      [
        candidate(
          'Observation of the rare $B^0_s\\to\\mu^+\\mu^-$ decay from the combined analysis of CMS and LHCb data'
        ),
      ]
    );
    expect(match).toBeUndefined();
  });

  test('rejects a near-miss superset title', () => {
    const match = selectArxivMatch('Attention Is All You Need', [
      candidate('Not All Attention Is All You Need'),
    ]);
    expect(match).toBeUndefined();
  });

  test('picks the best candidate rather than the first', () => {
    const match = selectArxivMatch('Attention Is All You Need', [
      candidate('Not All Attention Is All You Need'),
      candidate('Attention Is All You Need'),
    ]);
    expect(match?.title).toBe('Attention Is All You Need');
  });

  test('returns undefined when there are no candidates', () => {
    expect(selectArxivMatch('Anything', [])).toBeUndefined();
  });
});
