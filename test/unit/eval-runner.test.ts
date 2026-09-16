import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadClaims, runClaimSuite, type EvalClaim } from '../../eval/runner';

describe('eval runner', () => {
  test('loads JSONL claims while ignoring comments and blanks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-eval-'));
    const file = path.join(dir, 'claims.jsonl');
    fs.writeFileSync(
      file,
      [
        '// comment',
        '',
        JSON.stringify({
          id: 'c1',
          paper: 'alpha',
          category: 'verbatim',
          claim: 'claim 1',
          verdict: 'supported',
        }),
        JSON.stringify({
          id: 'c2',
          paper: 'beta',
          category: 'not-addressed',
          claim: 'claim 2',
          verdict: 'not-found',
        }),
      ].join('\n')
    );

    const rows = loadClaims(file);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('c1');
    expect(rows[1].verdict).toBe('not-found');
  });

  test('runs a dry suite without requiring the Anthropic SDK', async () => {
    const claims: EvalClaim[] = [
      {
        id: 'c1',
        paper: 'alpha',
        category: 'verbatim',
        claim: 'A paper says X',
        verdict: 'supported',
        evidence: 'X',
      },
    ];

    const result = await runClaimSuite({
      claims,
      model: 'test-model',
      mode: 'pdf-direct',
      dryRun: true,
      maxUsd: 2,
      cacheDir: path.join(os.tmpdir(), 'citation-needed-eval-dry'),
      pdfDir: '/tmp',
      mdDir: '/tmp',
      executeCall: async ({ claim }) => ({
        answer: { verdict: claim.verdict, evidence: claim.evidence, confidence: 1 },
        inputTokens: 10,
        outputTokens: 5,
        cacheCreate: 0,
        cacheRead: 0,
      }),
    });

    expect(result.summary.total).toBe(1);
    expect(result.summary.correct).toBe(1);
    expect(result.rows[0].answer.verdict).toBe('supported');
  });

  test('aborts when the estimated spend exceeds the maxUsd guard', async () => {
    const claims: EvalClaim[] = [
      {
        id: 'c1',
        paper: 'alpha',
        category: 'verbatim',
        claim: 'A paper says X',
        verdict: 'supported',
        evidence: 'X',
      },
    ];

    await expect(
      runClaimSuite({
        claims,
        model: 'test-model',
        mode: 'markdown-context',
        dryRun: false,
        maxUsd: 0.000001,
        cacheDir: path.join(os.tmpdir(), 'citation-needed-eval-cost-guard'),
        pdfDir: '/tmp',
        mdDir: '/tmp',
        executeCall: async () => ({
          answer: { verdict: 'supported', evidence: 'X', confidence: 1 },
          inputTokens: 2_000_000,
          outputTokens: 100_000,
          cacheCreate: 0,
          cacheRead: 0,
        }),
      })
    ).rejects.toThrow(/maxUsd|budget/i);
  });
});
