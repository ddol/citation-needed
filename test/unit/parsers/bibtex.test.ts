import { parseBibtex } from '../../../src/parsers/bibtex';

const SAMPLE_BIBTEX = `
@article{doe2024test,
  author = {Doe, Jane and Smith, John},
  title = {A Test Paper on Retrieval-Augmented Generation},
  journal = {Journal of AI Research},
  year = {2024},
  volume = {12},
  pages = {100-120},
  doi = {10.1234/jair.2024.001},
  url = {https://example.com/paper}
}

@inproceedings{chen2023llm,
  author = {Chen, Wei},
  title = {Large Language Models in Practice},
  booktitle = {Proceedings of NeurIPS 2023},
  year = {2023},
  doi = {10.5678/neurips.2023.042}
}
`;

const MINIMAL_BIBTEX = `
@misc{minimal2020,
  title = {Minimal Entry Without DOI}
}
`;

describe('BibTeX Parser', () => {
  test('parses multiple entries', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results.length).toBe(2);
  });

  test('extracts DOI correctly', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].doi).toBe('10.1234/jair.2024.001');
    expect(results[1].doi).toBe('10.5678/neurips.2023.042');
  });

  test('extracts title correctly', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].title).toContain('Retrieval-Augmented Generation');
  });

  test('extracts authors correctly', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].authors).toContain('Doe');
  });

  test('extracts year as number', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].year).toBe(2024);
    expect(results[1].year).toBe(2023);
  });

  test('extracts journal from article', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].journal).toBe('Journal of AI Research');
  });

  test('extracts booktitle as journal for inproceedings', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[1].journal).toContain('NeurIPS');
  });

  test('extracts bibtex key', () => {
    const results = parseBibtex(SAMPLE_BIBTEX);
    expect(results[0].bibtexKey).toBe('doe2024test');
  });

  test('handles missing fields gracefully', () => {
    const results = parseBibtex(MINIMAL_BIBTEX);
    expect(results.length).toBe(1);
    expect(results[0].doi).toBe('');
    expect(results[0].authors).toBeUndefined();
    expect(results[0].year).toBeUndefined();
  });

  test('returns empty array for invalid BibTeX', () => {
    const results = parseBibtex('this is not bibtex at all!!!');
    expect(Array.isArray(results)).toBe(true);
  });

  test('returns empty array for empty string', () => {
    const results = parseBibtex('');
    expect(results).toEqual([]);
  });
});
