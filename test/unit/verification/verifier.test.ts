import { ClaimVerifier } from '../../../src/verification/verifier';

describe('ClaimVerifier', () => {
  test('verifies claims against provided PDF markdown', async () => {
    const verifier = new ClaimVerifier();

    const result = await verifier.verify('10.1234/test', 'transformers improve sequence modeling', {
      pdfMarkdown: '# Paper\n\nTransformers improve sequence modeling in practice.',
    });

    expect(result.verified).toBe(true);
    expect(result.matchedKeywords).toEqual(
      expect.arrayContaining(['transformers', 'improve', 'sequence', 'modeling'])
    );
    expect(result.totalKeywords).toBe(4);
    expect(result.pdfAvailable).toBe(true);
  });

  test('returns no-pdf result when no markdown or path is available', async () => {
    const verifier = new ClaimVerifier();

    const result = await verifier.verify('10.1234/test', 'transformers improve sequence modeling');

    expect(result.verified).toBe(false);
    expect(result.matchedKeywords).toEqual([]);
    expect(result.totalKeywords).toBe(0);
    expect(result.pdfAvailable).toBe(false);
  });
});
