import fs from 'fs';
import type { Database } from '../db/index';
import type { ReadContentRequest, ReadContentResponse } from './contracts';
import { resolveMarkdownPath } from './markdown-locator';

const DEFAULT_MAX_CHARS = 20_000;
const MAX_MAX_CHARS = 100_000;

export type ReadContentResult =
  | { status: 'ok'; response: ReadContentResponse }
  | { status: 'unknown-doi' }
  | { status: 'no-markdown' };

/**
 * Serve a citation's extracted Markdown, paginated by character offset. The
 * cursor is a base64-encoded `{ offset }`, matching the opaque-cursor style
 * used elsewhere in the codebase.
 */
export class ContentService {
  constructor(private readonly db: Database) {}

  read(request: ReadContentRequest): ReadContentResult {
    const citation = this.db.getCitation(request.doi);
    if (!citation) return { status: 'unknown-doi' };

    const markdownPath = resolveMarkdownPath(citation);
    if (!markdownPath) return { status: 'no-markdown' };

    const full = fs.readFileSync(markdownPath, 'utf-8');
    const offset = request.cursor ? decodeOffsetCursor(request.cursor) : 0;
    const maxChars = Math.min(Math.max(request.maxChars ?? DEFAULT_MAX_CHARS, 1), MAX_MAX_CHARS);

    const text = full.slice(offset, offset + maxChars);
    const nextOffset = offset + maxChars;

    return {
      status: 'ok',
      response: {
        doi: citation.doi,
        title: citation.title,
        text,
        nextCursor: nextOffset < full.length ? encodeOffsetCursor(nextOffset) : undefined,
      },
    };
  }
}

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64');
}

export function decodeOffsetCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as {
      offset?: unknown;
    };
    if (typeof parsed.offset !== 'number' || parsed.offset < 0) {
      throw new Error('Invalid cursor');
    }
    return parsed.offset;
  } catch {
    throw new Error('Invalid cursor');
  }
}
