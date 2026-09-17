import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  loadClaims,
  makeMcpAgentAdapter,
  renderDecisionMemo,
  runClaimSuite,
  type EvalClaim,
} from '../../eval/runner';
import { createModeAdapter } from '../../eval/phase1-runner';

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

  test('phase1 factory picks the MCP agent adapter for the MCP mode', () => {
    const adapter = createModeAdapter('mcp-agent', false);
    expect(adapter.mode).toBe('mcp-agent');
  });

  test('passes the retrieval-oracle flag through the suite execution path', async () => {
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

    const executeCall = jest.fn(async ({ oracle }: { oracle?: boolean }) => ({
      answer: { verdict: 'supported' as const, evidence: 'X', confidence: 1 },
      inputTokens: 0,
      outputTokens: 0,
      cacheCreate: 0,
      cacheRead: 0,
      ...(oracle ? { error: undefined } : {}),
    }));
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-eval-oracle-'));

    await runClaimSuite({
      claims,
      model: 'test-model',
      mode: 'markdown-context',
      dryRun: false,
      maxUsd: 1,
      cacheDir,
      pdfDir: '/tmp',
      mdDir: '/tmp',
      oracle: true,
      executeCall,
    });

    expect(executeCall).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'markdown-context', oracle: true })
    );
  });

  test('renders a decision memo that reflects observed false-supported and over-refuted rates', () => {
    const report = {
      mode: 'mcp-agent',
      model: 'test-model',
      summary: {
        total: 4,
        correct: 3,
        falseSupported: 1,
        overRefuted: 1,
        totalUsd: 0.1,
        totalInputTokens: 10,
        totalOutputTokens: 20,
      },
      rows: [
        {
          claim: { id: 'a', paper: 'p', category: 'verbatim', claim: 'x', verdict: 'supported' },
          answer: { verdict: 'supported' },
          grade: {
            verdictCorrect: true,
            evidenceMatched: null,
            falseSupported: false,
            overRefuted: false,
          },
        },
        {
          claim: { id: 'b', paper: 'p', category: 'verbatim', claim: 'y', verdict: 'supported' },
          answer: { verdict: 'supported' },
          grade: {
            verdictCorrect: true,
            evidenceMatched: null,
            falseSupported: false,
            overRefuted: false,
          },
        },
        {
          claim: {
            id: 'c',
            paper: 'p',
            category: 'not-addressed',
            claim: 'z',
            verdict: 'not-found',
          },
          answer: { verdict: 'supported' },
          grade: {
            verdictCorrect: false,
            evidenceMatched: null,
            falseSupported: true,
            overRefuted: false,
          },
        },
        {
          claim: {
            id: 'd',
            paper: 'p',
            category: 'not-addressed',
            claim: 'q',
            verdict: 'not-found',
          },
          answer: { verdict: 'refuted' },
          grade: {
            verdictCorrect: false,
            evidenceMatched: null,
            falseSupported: false,
            overRefuted: true,
          },
        },
      ],
    } as any;

    const memo = renderDecisionMemo(report);
    expect(memo).toContain('Claim-grounding decision memo');
    expect(memo).toContain('false-supported rate');
    expect(memo).toContain('25.0%');
    expect(memo).toContain('25.0%');
  });

  test('mcp-agent adapter calls the MCP tool loop and returns a supported verdict when quote matches', async () => {
    const claim: EvalClaim = {
      id: 'mcp-1',
      paper: 'alpha',
      category: 'verbatim',
      claim: 'alpha states X',
      verdict: 'supported',
      evidence: 'X',
    };

    const callTool = jest.fn(async ({ name }: { name: string }) => {
      if (name === 'search-citations') {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results: [{ citation: { doi: '10.42/alpha' } }] }),
            },
          ],
        };
      }
      if (name === 'read-content') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ doi: '10.42/alpha', text: 'X' }) }],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ verdict: 'exact', matches: [{ doi: '10.42/alpha' }] }),
          },
        ],
      };
    });

    jest
      .spyOn(require('@modelcontextprotocol/sdk/client/index.js'), 'Client')
      .mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        callTool,
        close: jest.fn().mockResolvedValue(undefined),
      }));
    jest
      .spyOn(require('@modelcontextprotocol/sdk/inMemory.js').InMemoryTransport, 'createLinkedPair')
      .mockReturnValue([{}, {}] as any);
    jest.spyOn(require('../../src/mcp/server'), 'createMcpServer').mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    } as any);

    const result = await makeMcpAgentAdapter('mcp-agent').execute({
      mode: 'mcp-agent',
      model: 'test-model',
      claim,
      pdfDir: '/tmp',
      mdDir: '/tmp',
    });

    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'search-citations' }));
    expect(result.answer.verdict).toBe('supported');
  });
});
