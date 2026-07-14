import { z } from 'zod';
import type { VerificationStatus } from '../models/citation';

// Shared operation contracts: one zod schema per operation is the single
// source of truth. Services consume the inferred types; MCP tool definitions
// derive their inputSchema from the same schema via toInputSchema().

export const SearchCitationsArgs = z.object({
  query: z
    .string()
    .min(1, 'query is required')
    .describe('Search text matched against title, authors, journal, BibTeX key, and DOI'),
  mode: z.literal('lexical').optional().describe("Search mode; only 'lexical' is supported"),
  limit: z.number().int().min(1).max(200).optional().describe('Page size (1–200, default 50)'),
  cursor: z.string().optional().describe('Opaque cursor from a previous search-citations response'),
});
export type SearchCitationsRequest = z.infer<typeof SearchCitationsArgs>;

export const ReadContentArgs = z.object({
  doi: z.string().min(1, 'doi is required').describe('DOI of the citation to read'),
  cursor: z.string().optional().describe('Opaque cursor from a previous read-content response'),
  maxChars: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe('Maximum characters to return per page (default 20000)'),
});
export type ReadContentRequest = z.infer<typeof ReadContentArgs>;

export const VerifyQuoteArgs = z.object({
  quote: z.string().min(1, 'quote is required').describe('The quoted passage to verify'),
  doi: z
    .string()
    .optional()
    .describe('Restrict the check to this citation; omit to search the whole corpus'),
});
export type VerifyQuoteRequest = z.infer<typeof VerifyQuoteArgs>;

export interface CitationSummary {
  doi: string;
  title?: string;
  year?: number;
  journal?: string;
  verificationStatus?: VerificationStatus;
}

export interface SearchMatch {
  chunkOrdinal: number;
  sectionPath?: string[];
  snippet: string;
}

export interface SearchResultEntry {
  citation: CitationSummary;
  matchedFields: string[];
  /** Body-text hits with section provenance; present once the FTS index exists. */
  matches?: SearchMatch[];
}

export interface SearchResponse {
  results: SearchResultEntry[];
  nextCursor?: string;
}

export interface ReadContentResponse {
  doi: string;
  title?: string;
  text: string;
  nextCursor?: string;
}

// 'close-match' is reserved for verify-quote v2 (FTS fuzzy fallback); v1 only
// emits 'exact' and 'not-found'.
export type VerifyQuoteVerdict = 'exact' | 'close-match' | 'not-found';

export interface VerifyQuoteMatch {
  doi: string;
  similarity: number;
  snippet: string;
  sectionPath?: string[];
  chunkOrdinal?: number;
}

export interface VerifyQuoteResponse {
  verdict: VerifyQuoteVerdict;
  matches: VerifyQuoteMatch[];
}

/**
 * Derive an MCP tool inputSchema from a zod contract. Drops the `$schema`
 * marker so the result matches the plain JSON Schema literals used by the
 * hand-written tool definitions.
 */
export function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
