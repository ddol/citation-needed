import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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
  executeCall?: (args: {
    mode: EvalMode;
    model: string;
    claim: EvalClaim;
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
      result = await args.executeCall({ mode: args.mode, model: args.model, claim });
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
