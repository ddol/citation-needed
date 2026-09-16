import fs from 'fs';
import path from 'path';

import { createMcpServer } from '../src/mcp/server';
import { getDatabase } from '../src/db/index';
import {
  makeAnthropicAdapter,
  makeDryAdapter,
  type EvalClaim,
  type EvalMode,
  type ModeAdapter,
} from './runner';

export interface Phase1Config {
  claims: EvalClaim[];
  model: string;
  mode: EvalMode;
  pdfDir: string;
  mdDir: string;
  cacheDir: string;
  dryRun?: boolean;
  maxUsd?: number;
}

export function createModeAdapter(mode: EvalMode, dryRun = false): ModeAdapter {
  return dryRun ? makeDryAdapter(mode) : makeAnthropicAdapter(mode);
}

export async function runPhase1Eval(config: Phase1Config) {
  const adapter = createModeAdapter(config.mode, config.dryRun ?? false);
  const cacheDir = config.cacheDir || path.join(process.cwd(), 'eval', '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const db = getDatabase();
  createMcpServer(db);

  const suite = config.claims;
  const result = await (async () => {
    const rows = [] as Array<{ claim: EvalClaim; answer: { verdict: string } }>;
    for (const claim of suite) {
      const response = await adapter.execute({
        mode: config.mode,
        model: config.model,
        claim,
        pdfDir: config.pdfDir,
        mdDir: config.mdDir,
      });
      rows.push({ claim, answer: response.answer });
    }
    return rows;
  })();

  return result;
}
