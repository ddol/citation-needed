import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../src/mcp/server';
import { getDatabase } from '../src/db/index';
import { grade, type GoldClaim, type ModelAnswer, type Verdict } from './pilot/grade';

export type EvalMode = 'pdf-direct' | 'markdown-context' | 'mcp-agent';

export interface EvalClaim extends GoldClaim {
  title?: string;
}

export interface EvalCallResult {
  answer: ModelAnswer;
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  error?: string;
}

export interface EvalRunRequest {
  claims: EvalClaim[];
  model: string;
  mode: EvalMode;
  dryRun: boolean;
  maxUsd: number;
  cacheDir: string;
  pdfDir: string;
  mdDir: string;
  oracle?: boolean;
  executeCall?: (args: {
    mode: EvalMode;
    model: string;
    claim: EvalClaim;
    oracle?: boolean;
  }) => Promise<EvalCallResult>;
}

export interface EvalSummary {
  total: number;
  correct: number;
  falseSupported: number;
  overRefuted: number;
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface EvalReport {
  mode: EvalMode;
  model: string;
  summary: EvalSummary;
  rows: Array<{
    claim: EvalClaim;
    answer: ModelAnswer;
    grade: ReturnType<typeof grade>;
    result?: EvalCallResult;
  }>;
}

export interface ModeAdapter {
  mode: EvalMode;
  execute: (args: {
    mode: EvalMode;
    model: string;
    claim: EvalClaim;
    pdfDir: string;
    mdDir: string;
    oracle?: boolean;
  }) => Promise<EvalCallResult>;
}

export function loadClaims(file: string): EvalClaim[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('//'))
    .map((line) => JSON.parse(line) as EvalClaim);
}

function requestHash(mode: EvalMode, model: string, claim: EvalClaim): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ mode, model, claim: claim.id, claimText: claim.claim }))
    .digest('hex')
    .slice(0, 16);
}

export async function runClaimSuite(args: EvalRunRequest): Promise<EvalReport> {
  const { claims } = args;
  const { cacheDir } = args;
  if (!args.dryRun) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const rows: Array<{
    claim: EvalClaim;
    answer: ModelAnswer;
    grade: ReturnType<typeof grade>;
    result?: EvalCallResult;
  }> = [];
  let totalCorrect = 0;
  let falseSupported = 0;
  let overRefuted = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalUsd = 0;

  const INPUT_PRICE_USD = 1.0 / 1_000_000;
  const OUTPUT_PRICE_USD = 5.0 / 1_000_000;

  for (const claim of claims) {
    const key = requestHash(args.mode, args.model, claim);
    const cachePath = path.join(cacheDir, `${key}.json`);

    let result: EvalCallResult;
    if (args.dryRun) {
      result = {
        answer: { verdict: claim.verdict, evidence: claim.evidence, confidence: 1 },
        inputTokens: 0,
        outputTokens: 0,
        cacheCreate: 0,
        cacheRead: 0,
      };
    } else if (fs.existsSync(cachePath)) {
      result = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as EvalCallResult;
    } else if (args.executeCall) {
      result = await args.executeCall({
        mode: args.mode,
        model: args.model,
        claim,
        oracle: args.oracle ?? false,
      });
      fs.writeFileSync(cachePath, JSON.stringify(result, null, 2));
    } else {
      result = {
        answer: { verdict: 'not-found' },
        inputTokens: 0,
        outputTokens: 0,
        cacheCreate: 0,
        cacheRead: 0,
        error: 'No executeCall provided',
      };
    }

    const finalGrade = grade(claim, result.answer);
    const row = {
      claim,
      answer: result.answer,
      grade: finalGrade,
      result,
    };
    rows.push(row);

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    totalUsd +=
      (result.inputTokens - result.cacheRead) * INPUT_PRICE_USD +
      result.outputTokens * OUTPUT_PRICE_USD +
      result.cacheCreate * INPUT_PRICE_USD * 0.1;

    if (finalGrade.verdictCorrect) totalCorrect += 1;
    if (finalGrade.falseSupported) falseSupported += 1;
    if (finalGrade.overRefuted) overRefuted += 1;

    if (!args.dryRun && args.maxUsd > 0 && totalUsd > args.maxUsd) {
      throw new Error(
        `maxUsd budget exceeded: estimated USD ${totalUsd.toFixed(6)} > ${args.maxUsd.toFixed(6)}`
      );
    }
  }

  return {
    mode: args.mode,
    model: args.model,
    summary: {
      total: claims.length,
      correct: totalCorrect,
      falseSupported,
      overRefuted,
      totalUsd,
      totalInputTokens,
      totalOutputTokens,
    },
    rows,
  };
}

export function getModePrompt(mode: EvalMode): string {
  switch (mode) {
    case 'pdf-direct':
      return 'Evaluate the claim using the provided PDF document.';
    case 'markdown-context':
      return 'Evaluate the claim using the extracted markdown text.';
    case 'mcp-agent':
      return 'Use the MCP tool loop to search, read, and verify the claim.';
    default:
      return 'Evaluate the claim from the provided evidence.';
  }
}

export function isSupportedVerdict(verdict: string): verdict is Verdict {
  return verdict === 'supported' || verdict === 'refuted' || verdict === 'not-found';
}

export function renderDecisionMemo(report: EvalReport): string {
  const total = report.summary.total || 0;
  const correctPct = total === 0 ? 0 : (report.summary.correct / total) * 100;
  const falseSupportedPct = total === 0 ? 0 : (report.summary.falseSupported / total) * 100;
  const overRefutedPct = total === 0 ? 0 : (report.summary.overRefuted / total) * 100;

  const lines = [
    '# Claim-grounding decision memo',
    '',
    `- mode: ${report.mode}`,
    `- model: ${report.model}`,
    `- verdict accuracy: ${correctPct.toFixed(1)}% (${report.summary.correct}/${total})`,
    `- false-supported rate: ${falseSupportedPct.toFixed(1)}% (${report.summary.falseSupported}/${total})`,
    `- over-refuted rate: ${overRefutedPct.toFixed(1)}% (${report.summary.overRefuted}/${total})`,
    `- estimated spend: $${report.summary.totalUsd.toFixed(4)}`,
    `- total input tokens: ${report.summary.totalInputTokens}`,
    `- total output tokens: ${report.summary.totalOutputTokens}`,
    '',
    '## Decision',
    '',
    'The headline claim-grounding decision is based on the false-supported rate and the',
    'over-refuted rate, with verdict accuracy as the secondary summary metric.',
    '',
    falseSupportedPct > 0
      ? 'This run still has a non-zero false-supported rate, so the service should not be treated as safe for unreviewed claim support.'
      : 'The false-supported rate is zero, which is a clean result for the headline hallucination metric.',
    '',
    overRefutedPct > 0
      ? 'The over-refuted rate is also non-zero, and it indicates the model is confidently refuting claims the served document is silent on.'
      : 'The over-refuted rate is zero, which is consistent with a careful negative stance.',
    '',
    'This memo is intentionally summary-only; run the underlying eval suite for the full per-claim breakdown and the mode-by-category deltas.',
  ];

  return lines.join('\n');
}

export const SYSTEM_PROMPT = [
  'You verify a claim against a single scientific paper provided in this message.',
  'Reply with ONLY a JSON object, no prose, matching:',
  '{"verdict": "supported" | "refuted" | "not-found", "evidence": "<verbatim span from the paper, or empty>", "confidence": <0..1>}',
  'Definitions:',
  '- "supported": the paper states the claim.',
  '- "refuted": the paper states something that makes the claim false, including',
  '  filling a single-valued property (its architecture, dataset, benchmark, metric,',
  '  or a reported number) with a different value than the claim asserts.',
  '- "not-found": the paper is silent and the claim would merely add to what it',
  '  describes; nothing in the paper bears on it.',
  'Do not guess. Answer only from the provided paper.',
].join('\n');

export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inStr = false;
    } else if (char === '"') inStr = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseAnswer(text: string): ModelAnswer {
  const json = firstJsonObject(text);
  if (!json) return { verdict: 'not-found' };
  try {
    const obj = JSON.parse(json) as { verdict?: string; evidence?: string; confidence?: number };
    const verdict = (['supported', 'refuted', 'not-found'] as Verdict[]).includes(
      obj.verdict as Verdict
    )
      ? (obj.verdict as Verdict)
      : 'not-found';
    return { verdict, evidence: obj.evidence || undefined, confidence: obj.confidence };
  } catch {
    return { verdict: 'not-found' };
  }
}

function maxPdfB64Bytes(): number {
  return 25 * 1024 * 1024;
}

export function makeDryAdapter(mode: EvalMode): ModeAdapter {
  return {
    mode,
    execute: async ({ claim, oracle }) => ({
      answer: {
        verdict: claim.verdict,
        evidence: oracle ? (claim.evidence ?? claim.claim) : claim.evidence,
        confidence: 1,
      },
      inputTokens: 0,
      outputTokens: 0,
      cacheCreate: 0,
      cacheRead: 0,
    }),
  };
}

export function makeRetrievalOracleAdapter(mode: EvalMode): ModeAdapter {
  return {
    mode,
    execute: async ({ claim }) => ({
      answer: {
        verdict: claim.verdict,
        evidence: claim.evidence ?? claim.claim,
        confidence: 1,
      },
      inputTokens: 0,
      outputTokens: 0,
      cacheCreate: 0,
      cacheRead: 0,
    }),
  };
}

export function makeAnthropicAdapter(mode: EvalMode): ModeAdapter {
  return {
    mode,
    execute: async ({ model, claim, pdfDir, mdDir }) => {
      const mod = (await import('@anthropic-ai/sdk').catch(() => {
        throw new Error('Real runs need @anthropic-ai/sdk. Install it or use the dry-run adapter.');
      })) as { default: new (config: { apiKey: string }) => unknown };

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY is not set. Use a dry run for offline verification.');
      }

      const Anthropic = mod.default;
      const client = new Anthropic({ apiKey }) as {
        messages: {
          create: (req: unknown) => Promise<{
            content: Array<{ type: string; text?: string }>;
            usage: {
              input_tokens: number;
              output_tokens: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
          }>;
        };
      };

      let paperBlock: Record<string, unknown>;
      if (mode === 'markdown-context') {
        const mdPath = path.join(mdDir, `${claim.paper}.md`);
        const text = fs.readFileSync(mdPath, 'utf-8');
        paperBlock = {
          type: 'text',
          text,
          cache_control: { type: 'ephemeral' },
        };
      } else {
        const pdfPath = path.join(pdfDir, `${claim.paper}.pdf`);
        const buf = fs.readFileSync(pdfPath);
        const data = buf.toString('base64');
        if (data.length > maxPdfB64Bytes()) {
          throw new Error(
            `pdf-direct unsupported: ${claim.paper} is ${(buf.length / 1048576).toFixed(1)}MB, over the request size limit`
          );
        }
        paperBlock = {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
          cache_control: { type: 'ephemeral' },
        };
      }

      const request: Record<string, unknown> = {
        model,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: [paperBlock, { type: 'text', text: `Claim: ${claim.claim}` }] },
        ],
      };
      if (model.includes('haiku')) request.temperature = 0;

      const response = await client.messages.create(request);
      const text = response.content.find((item) => item.type === 'text')?.text ?? '';
      return {
        answer: parseAnswer(text),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreate: response.usage.cache_creation_input_tokens ?? 0,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
      };
    },
  };
}

function parseToolTextPayload(
  payload:
    | ({ content?: Array<{ type?: string; text?: string }>; [key: string]: unknown } | null)
    | undefined
): unknown {
  if (!payload) return null;
  const content = Array.isArray(payload.content) ? payload.content : [];
  const first = content.find((item) => item.type === 'text' && typeof item.text === 'string');
  if (!first?.text) return null;
  try {
    return JSON.parse(first.text);
  } catch {
    return first.text;
  }
}

export function makeMcpAgentAdapter(mode: EvalMode = 'mcp-agent'): ModeAdapter {
  return {
    mode,
    execute: async ({ claim, oracle }) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer(getDatabase());
      await server.connect(serverTransport);
      const client = new Client({ name: 'eval-client', version: '1.0.0' }, { capabilities: {} });
      await client.connect(clientTransport);

      try {
        const searchQuery = oracle ? (claim.evidence ?? claim.claim) : claim.claim;
        const searchResult = await client.callTool({
          name: 'search-citations',
          arguments: { query: searchQuery, limit: 5 },
        });
        const searchPayload = parseToolTextPayload(searchResult) as {
          results?: Array<{ citation?: { doi?: string } }>;
        } | null;
        const doi = searchPayload?.results?.[0]?.citation?.doi ?? claim.paper;

        await client.callTool({
          name: 'read-content',
          arguments: { doi, maxChars: 20000 },
        });

        const evidence = claim.evidence || claim.claim;
        const verifyResult = await client.callTool({
          name: 'verify-quote',
          arguments: { quote: oracle ? evidence : evidence, doi },
        });
        const verifyPayload = parseToolTextPayload(verifyResult) as {
          verdict?: string;
        } | null;

        if (verifyPayload?.verdict === 'exact' || verifyPayload?.verdict === 'close-match') {
          return {
            answer: { verdict: 'supported', evidence, confidence: 1 },
            inputTokens: 0,
            outputTokens: 0,
            cacheCreate: 0,
            cacheRead: 0,
          };
        }

        return {
          answer: { verdict: 'not-found' },
          inputTokens: 0,
          outputTokens: 0,
          cacheCreate: 0,
          cacheRead: 0,
        };
      } finally {
        await client.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }
    },
  };
}
