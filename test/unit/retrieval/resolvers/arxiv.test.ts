import axios from 'axios';
import {
  ArxivResolver,
  selectArxivMatch,
  titleSimilarity,
} from '../../../../src/retrieval/resolvers/arxiv';

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

describe('titleSimilarity', () => {
  test('ignores case, punctuation and LaTeX braces', () => {
    expect(
      titleSimilarity('{RangeNet++}: Fast and Accurate', 'RangeNet++: Fast and Accurate')
    ).toBe(1);
  });

  test('scores unrelated titles low', () => {
    expect(
      titleSimilarity(
        'A New Approach to Linear Filtering and Prediction Problems',
        'Fluid Antenna System: New Insights on Outage Probability and Diversity Gain'
      )
    ).toBeLessThan(0.5);
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
