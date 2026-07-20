import {
  DOI_LOOKUP_THRESHOLD,
  TITLE_SEARCH_THRESHOLD,
  isTitleMatch,
  selectBestMatch,
  titleSimilarity,
} from '../../../src/retrieval/title-match';

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

  test('scores an empty title as no match', () => {
    expect(titleSimilarity('Anything', '')).toBe(0);
  });
});

describe('threshold split between title search and DOI lookup', () => {
  // arXiv is searched by title, so a near-miss must be rejected.
  test('title-search threshold rejects a superset title', () => {
    expect(
      isTitleMatch(
        'Attention Is All You Need',
        'Not All Attention Is All You Need',
        TITLE_SEARCH_THRESHOLD
      )
    ).toBe(false);
  });

  // Real miss: the BibTeX subtitle is abbreviated, but the DOI already proves
  // identity, so the looser DOI-lookup bar accepts it.
  test('DOI-lookup threshold accepts an abbreviated subtitle', () => {
    const bibtex =
      'Patchwork: Concentric Zone-Based Region-Wise Ground Segmentation with Tilted LiDAR';
    const upstream =
      'Patchwork: Concentric Zone-based Region-wise Ground Segmentation with Ground Likelihood Estimation Using a 3D LiDAR Sensor';

    expect(isTitleMatch(bibtex, upstream, TITLE_SEARCH_THRESHOLD)).toBe(false);
    expect(isTitleMatch(bibtex, upstream, DOI_LOOKUP_THRESHOLD)).toBe(true);
  });

  // Semantic Scholar really returned this PDF for Held 2016; a DOI match does
  // not make upstream metadata correct.
  test('DOI-lookup threshold still rejects a grossly wrong upstream title', () => {
    expect(
      isTitleMatch(
        'Robust Real-Time Tracking Combining 3D Shape, Colour, and Motion',
        'Pre- and post-contact policy decomposition for planar contact manipulation',
        DOI_LOOKUP_THRESHOLD
      )
    ).toBe(false);
  });
});

describe('selectBestMatch', () => {
  const candidates = [
    { t: 'Not All Attention Is All You Need' },
    { t: 'Attention Is All You Need' },
  ];

  test('picks the best candidate rather than the first', () => {
    const best = selectBestMatch('Attention Is All You Need', candidates, (c) => c.t, 0.9);
    expect(best?.t).toBe('Attention Is All You Need');
  });

  test('returns undefined when nothing clears the threshold', () => {
    expect(selectBestMatch('Something Else Entirely', candidates, (c) => c.t, 0.9)).toBeUndefined();
  });

  test('returns undefined for an empty candidate list', () => {
    expect(selectBestMatch('Anything', [], (c: { t: string }) => c.t, 0.5)).toBeUndefined();
  });
});
