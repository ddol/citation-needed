/**
 * Pilot runner: one claim suite, two consumption modes (pdf-direct,
 * markdown-context), one model, mechanical grading. A single script by design
 * (docs/plans/claim-grounding-eval.md, phase "Pilot"); the Phase 1 harness
 * generalises it later.
 *
 *   npx ts-node eval/pilot/run.ts --dry        # offline, canned answers
 *   ANTHROPIC_API_KEY=... npx ts-node eval/pilot/run.ts --model claude-haiku-4-5-20251001
 *
 * --dry exercises the whole read -> answer -> grade -> summarise path with
 * canned perfect answers, so the grader and the claim formats are verifiable
 * with zero spend. The real path needs @anthropic-ai/sdk installed and a key,
 * and is bounded by --max-usd (default $2).
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { grade, summarize, type GoldClaim, type ModelAnswer, type Verdict } from './grade';

const REPO = path.resolve(__dirname, '..', '..');
const MD_DIR = path.resolve(REPO, '..', 'velocity.report', 'docs', 'papers', 'markdown');
const PDF_DIR = path.resolve(REPO, '..', 'velocity.report', 'docs', 'papers', 'pdf');
const CACHE_DIR = path.join(__dirname, '.cache');

type Mode = 'pdf-direct' | 'markdown-context';
const MODES: Mode[] = ['pdf-direct', 'markdown-context'];

interface Args {
  dry: boolean;
  model: string;
  maxUsd: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, def: string): string => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  return {
    dry: argv.includes('--dry'),
    model: get('--model', 'claude-haiku-4-5-20251001'),
    maxUsd: Number(get('--max-usd', '2')),
  };
}

function loadClaims(): GoldClaim[] {
  const file = path.join(__dirname, 'claims.jsonl');
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('//'))
    .map((l) => JSON.parse(l) as GoldClaim);
}

const SYSTEM = [
  'You verify a claim against a single scientific paper provided in this message.',
  'Reply with ONLY a JSON object, no prose, matching:',
  '{"verdict": "supported" | "refuted" | "not-found", "evidence": "<verbatim span from the paper, or empty>", "confidence": <0..1>}',
  'Use "supported" only if the paper states the claim; "refuted" if the paper states the opposite;',
  '"not-found" if the paper does not address it. Do not guess.',
].join('\n');

function requestHash(mode: Mode, model: string, claim: GoldClaim): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ mode, model, id: claim.id, claim: claim.claim }))
    .digest('hex')
    .slice(0, 16);
}

function parseAnswer(text: string): ModelAnswer {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: 'not-found' };
  const obj = JSON.parse(match[0]) as { verdict?: string; evidence?: string; confidence?: number };
  const verdict = (['supported', 'refuted', 'not-found'] as Verdict[]).includes(
    obj.verdict as Verdict
  )
    ? (obj.verdict as Verdict)
    : 'not-found';
  return { verdict, evidence: obj.evidence || undefined, confidence: obj.confidence };
}

// Canned "perfect oracle" answer for --dry: proves the pipeline and grader run
// end to end offline. A green summary (100% verdicts, 0 false-supported) is the
// expected smoke-test result; it says nothing about real model accuracy.
function cannedAnswer(claim: GoldClaim): ModelAnswer {
  return { verdict: claim.verdict, evidence: claim.evidence, confidence: 1 };
}

interface CallResult {
  answer: ModelAnswer;
  inputTokens: number;
  outputTokens: number;
}

async function callModel(mode: Mode, model: string, claim: GoldClaim): Promise<CallResult> {
  // Dynamic import so --dry and this file's parse do not require the SDK.
  const mod = (await import('@anthropic-ai/sdk').catch(() => {
    throw new Error(
      'Real runs need @anthropic-ai/sdk. Install it (npm i -D @anthropic-ai/sdk) or use --dry.'
    );
  })) as { default: new (o: { apiKey: string }) => unknown };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Use --dry for an offline check.');
  const Anthropic = mod.default;
  const client = new Anthropic({ apiKey }) as {
    messages: {
      create: (req: unknown) => Promise<{
        content: Array<{ type: string; text?: string }>;
        usage: { input_tokens: number; output_tokens: number };
      }>;
    };
  };

  const user =
    mode === 'markdown-context'
      ? [
          { type: 'text', text: fs.readFileSync(path.join(MD_DIR, `${claim.paper}.md`), 'utf-8') },
          { type: 'text', text: `\nClaim: ${claim.claim}` },
        ]
      : [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: fs.readFileSync(path.join(PDF_DIR, `${claim.paper}.pdf`)).toString('base64'),
            },
          },
          { type: 'text', text: `Claim: ${claim.claim}` },
        ];

  const res = await client.messages.create({
    model,
    max_tokens: 512,
    temperature: 0,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  return {
    answer: parseAnswer(text),
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const claims = loadClaims();
  if (!args.dry) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const results: Array<{ mode: Mode; gold: GoldClaim; answer: ModelAnswer }> = [];
  let usd = 0;
  const PRICE_IN = 1.0 / 1_000_000; // assumed cheap-model input $/token; illustrative
  const PRICE_OUT = 5.0 / 1_000_000;

  for (const mode of MODES) {
    for (const claim of claims) {
      let call: CallResult;
      if (args.dry) {
        call = { answer: cannedAnswer(claim), inputTokens: 0, outputTokens: 0 };
      } else {
        const cacheFile = path.join(CACHE_DIR, `${requestHash(mode, args.model, claim)}.json`);
        if (fs.existsSync(cacheFile)) {
          call = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as CallResult;
        } else {
          call = await callModel(mode, args.model, claim);
          fs.writeFileSync(cacheFile, JSON.stringify(call));
        }
        usd += call.inputTokens * PRICE_IN + call.outputTokens * PRICE_OUT;
        if (usd > args.maxUsd)
          throw new Error(`Aborting: spend $${usd.toFixed(2)} exceeded --max-usd $${args.maxUsd}.`);
      }
      results.push({ mode, gold: claim, answer: call.answer });
    }
  }

  const outFile = path.join(__dirname, args.dry ? 'results.dry.jsonl' : 'results.jsonl');
  fs.writeFileSync(
    outFile,
    `${results.map((r) => JSON.stringify({ ...r, grade: grade(r.gold, r.answer) })).join('\n')}\n`
  );

  process.stdout.write(
    `\nPilot ${args.dry ? '(DRY, canned answers)' : `model=${args.model}`}  claims=${claims.length}  spend=$${usd.toFixed(4)}\n\n`
  );
  for (const mode of MODES) {
    const rows = results
      .filter((r) => r.mode === mode)
      .map((r) => ({ gold: r.gold, grade: grade(r.gold, r.answer) }));
    process.stdout.write(`## ${mode}\n`);
    process.stdout.write('| category | n | verdict acc | evidence | false-supported |\n');
    process.stdout.write('| --- | --- | --- | --- | --- |\n');
    for (const s of summarize(rows)) {
      const ev = s.evidenceRate == null ? '—' : `${(s.evidenceRate * 100).toFixed(0)}%`;
      process.stdout.write(
        `| ${s.category} | ${s.n} | ${(s.verdictAccuracy * 100).toFixed(0)}% | ${ev} | ${s.falseSupported} |\n`
      );
    }
    process.stdout.write('\n');
  }
  process.stdout.write(`Wrote ${path.relative(REPO, outFile)}\n`);
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
