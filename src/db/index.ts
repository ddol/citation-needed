import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Citation, VerificationStatus, AccessType } from '../models/citation';
import type { Manifestation, ManifestationInput, ManifestationKind } from '../models/manifestation';
import type { RetrievalAttempt } from '../models/retrieval';
import {
  CREATE_CITATIONS_TABLE,
  CREATE_RETRIEVAL_LOG_TABLE,
  CREATE_INDEXES,
  createCitationsTableStatement,
} from './schema';
import { ensureFtsSchema, runMigrations } from './migrations';

// Use require for better-sqlite3 (CommonJS native module)
const BetterSqlite3 = require('better-sqlite3');

export type { Citation };

const EXPECTED_CITATION_COLUMNS = [
  'id',
  'doi',
  'url',
  'title',
  'authors',
  'year',
  'journal',
  'bibtex_key',
  'pdf_path',
  'verification_status',
  'access_type',
  'last_verified',
  'created_at',
  'updated_at',
] as const;

// Every citation read derives the effective PDF path from manifestations
// (the source of truth), falling back to the legacy pdf_path column for
// rows that predate the backfill.
const CITATION_SELECT = `SELECT citations.*, (
    SELECT m.path FROM manifestations m
    WHERE m.citation_id = citations.id AND m.kind = 'pdf'
    ORDER BY m.id DESC LIMIT 1
  ) AS manifest_pdf_path
  FROM citations`;

export interface ChunkInput {
  ordinal: number;
  sectionPath: string[];
  text: string;
}

export interface ChunkRecord {
  ordinal: number;
  sectionPath?: string[];
  text: string;
}

export interface ChunkCandidate extends ChunkRecord {
  doi: string;
}

export interface ChunkMatch {
  chunkOrdinal: number;
  sectionPath?: string[];
  snippet: string;
}

export interface AddCitationResult {
  citation: Citation;
  inserted: boolean;
}

export class Database {
  private db: InstanceType<typeof BetterSqlite3>;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ||
      process.env.CITATION_NEEDED_DB ||
      path.join(os.homedir(), '.citation-needed', 'citations.db');

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(resolvedPath);
    this.db.pragma('foreign_keys = ON');
    // Cascade deletes must fire the FTS sync triggers on chunks.
    this.db.pragma('recursive_triggers = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(CREATE_CITATIONS_TABLE);
    this.db.exec(CREATE_RETRIEVAL_LOG_TABLE);
    this.ensureAccessTypeColumn();
    this.migrateLegacyCitationSchema();
    this.migrateRetrievalLogForeignKey();
    this.ensureIndexes();
    runMigrations(this.db);
    // Defensive: the legacy rebuild above drops the citations table (and with
    // it the FTS sync triggers); recreate anything missing idempotently.
    ensureFtsSchema(this.db);
  }

  private ensureIndexes(): void {
    for (const stmt of CREATE_INDEXES) {
      this.db.exec(stmt);
    }
  }

  /**
   * Execute `fn` inside a SQLite transaction.
   *
   * Wraps better-sqlite3's `db.transaction(...)` so callers can group multiple
   * writes (e.g. a citation insert plus retrieval-log row) without partial
   * commits surviving a crash mid-loop.
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private ensureAccessTypeColumn(): void {
    try {
      this.db.exec(`ALTER TABLE citations ADD COLUMN access_type TEXT DEFAULT 'unknown'`);
    } catch {
      // column already exists, ignore
    }
  }

  private migrateLegacyCitationSchema(): void {
    const columns = this.db.prepare('PRAGMA table_info(citations)').all() as Array<{
      name: string;
    }>;
    const createSql = this.getTableCreateSql('citations');
    const hasExpectedColumns =
      columns.length === EXPECTED_CITATION_COLUMNS.length &&
      EXPECTED_CITATION_COLUMNS.every((expectedColumn) =>
        columns.some((column) => column.name === expectedColumn)
      );
    const hasCheckConstraints =
      createSql !== null && /CHECK\s*\(verification_status/i.test(createSql);

    if (hasExpectedColumns && hasCheckConstraints) {
      return;
    }

    // Rebuild the table so we pick up CHECK constraints and any new columns.
    // foreign_keys must be off while we DROP/RENAME to avoid violating
    // retrieval_log -> citations(id).
    this.db.pragma('foreign_keys = OFF');
    try {
      const migratedTableSql = createCitationsTableStatement('citations_migrated', {
        ifNotExists: false,
      });

      this.db.exec(`
        BEGIN TRANSACTION;
        ${migratedTableSql};
        INSERT INTO citations_migrated (
          id,
          doi,
          url,
          title,
          authors,
          year,
          journal,
          bibtex_key,
          pdf_path,
          verification_status,
          access_type,
          last_verified,
          created_at,
          updated_at
        )
        SELECT
          id,
          doi,
          url,
          title,
          authors,
          year,
          journal,
          bibtex_key,
          pdf_path,
          verification_status,
          access_type,
          last_verified,
          created_at,
          updated_at
        FROM citations;
        DROP TABLE citations;
        ALTER TABLE citations_migrated RENAME TO citations;
        COMMIT;
      `);
    } finally {
      this.db.pragma('foreign_keys = ON');
    }
  }

  private migrateRetrievalLogForeignKey(): void {
    // Existing DBs created before this change have the FK without ON DELETE CASCADE.
    // SQLite can't ALTER a constraint in place, so rebuild the table if the FK
    // action isn't CASCADE.
    const fks = this.db.prepare('PRAGMA foreign_key_list(retrieval_log)').all() as Array<{
      table: string;
      on_delete: string;
    }>;
    const hasCascade = fks.some(
      (fk) => fk.table === 'citations' && fk.on_delete.toUpperCase() === 'CASCADE'
    );
    if (hasCascade) {
      return;
    }

    this.db.pragma('foreign_keys = OFF');
    try {
      this.db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE retrieval_log_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          citation_id INTEGER NOT NULL
            REFERENCES citations(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          url TEXT,
          success INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          duration_ms INTEGER,
          created_at TEXT NOT NULL
        );
        INSERT INTO retrieval_log_migrated (
          id, citation_id, source, url, success, error_message, duration_ms, created_at
        )
        SELECT id, citation_id, source, url, success, error_message, duration_ms, created_at
        FROM retrieval_log;
        DROP TABLE retrieval_log;
        ALTER TABLE retrieval_log_migrated RENAME TO retrieval_log;
        COMMIT;
      `);
    } finally {
      this.db.pragma('foreign_keys = ON');
    }
  }

  private getTableCreateSql(tableName: string): string | null {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { sql?: string } | undefined;
    return row?.sql ?? null;
  }

  addCitationWithResult(citation: Citation): AddCitationResult {
    if (!citation.doi || citation.doi.trim() === '') {
      throw new Error('Citation must have a non-empty DOI');
    }
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO citations
        (doi, url, title, authors, year, journal, bibtex_key,
         verification_status, access_type, created_at, updated_at)
      VALUES
        (@doi, @url, @title, @authors, @year, @journal, @bibtexKey,
         @verificationStatus, @accessType, @createdAt, @updatedAt)
    `);
    const result = stmt.run({
      doi: citation.doi,
      url: citation.url || null,
      title: citation.title || null,
      authors: citation.authors || null,
      year: citation.year || null,
      journal: citation.journal || null,
      bibtexKey: citation.bibtexKey || null,
      verificationStatus: citation.verificationStatus || 'unverified',
      accessType: citation.accessType || 'unknown',
      createdAt: now,
      updatedAt: now,
    });
    return {
      citation: this.getCitationByDoi(citation.doi) || citation,
      inserted: result.changes > 0,
    };
  }

  addCitation(citation: Citation): Citation {
    return this.addCitationWithResult(citation).citation;
  }

  getCitation(doi: string): Citation | undefined {
    return this.getCitationByDoi(doi);
  }

  private getCitationByDoi(doi: string): Citation | undefined {
    const row = this.db.prepare(`${CITATION_SELECT} WHERE doi = ?`).get(doi) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToCitation(row);
  }

  /**
   * List stored citations.
   *
   * `cursor` is a base64-encoded JSON snapshot of the last row seen
   * (`{ createdAt, id }`) — pass `nextCursor` from the previous response to
   * fetch the next page. Returns rows in ascending `(created_at, id)` order so
   * pagination is stable when new rows arrive.
   *
   * For the legacy descending "all rows" view, call with no arguments.
   */
  getAllCitations(): Citation[];
  getAllCitations(options: { cursor?: string; limit?: number }): {
    citations: Citation[];
    nextCursor?: string;
  };
  getAllCitations(options?: {
    cursor?: string;
    limit?: number;
  }): Citation[] | { citations: Citation[]; nextCursor?: string } {
    if (options === undefined) {
      const rows = this.db.prepare(`${CITATION_SELECT} ORDER BY created_at DESC`).all() as Record<
        string,
        unknown
      >[];
      return rows.map((r) => this.rowToCitation(r));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const rows = cursor
      ? (this.db
          .prepare(
            `${CITATION_SELECT}
             WHERE (created_at > @createdAt)
                OR (created_at = @createdAt AND id > @id)
             ORDER BY created_at ASC, id ASC
             LIMIT @limit`
          )
          .all({ createdAt: cursor.createdAt, id: cursor.id, limit: limit + 1 }) as Record<
          string,
          unknown
        >[])
      : (this.db
          .prepare(`${CITATION_SELECT} ORDER BY created_at ASC, id ASC LIMIT @limit`)
          .all({ limit: limit + 1 }) as Record<string, unknown>[]);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const citations = pageRows.map((r) => this.rowToCitation(r));
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor({
            createdAt: (pageRows[pageRows.length - 1].created_at as string) ?? '',
            id: (pageRows[pageRows.length - 1].id as number) ?? 0,
          })
        : undefined;

    return { citations, nextCursor };
  }

  /**
   * Search citations by substring across title, authors, journal, BibTeX key,
   * and DOI.
   *
   * Mirrors `getAllCitations`: call with no options for the legacy descending
   * array, or pass `{ cursor, limit }` for stable ascending `(created_at, id)`
   * pagination.
   */
  searchCitations(query: string): Citation[];
  searchCitations(
    query: string,
    options: { cursor?: string; limit?: number }
  ): { citations: Citation[]; nextCursor?: string };
  searchCitations(
    query: string,
    options?: { cursor?: string; limit?: number }
  ): Citation[] | { citations: Citation[]; nextCursor?: string } {
    const like = `%${query}%`;
    const matchClause = `(title LIKE @like OR authors LIKE @like OR journal LIKE @like
         OR bibtex_key LIKE @like OR doi LIKE @like)`;

    if (options === undefined) {
      const rows = this.db
        .prepare(
          `${CITATION_SELECT}
           WHERE ${matchClause}
           ORDER BY created_at DESC`
        )
        .all({ like }) as Record<string, unknown>[];
      return rows.map((r) => this.rowToCitation(r));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const rows = cursor
      ? (this.db
          .prepare(
            `${CITATION_SELECT}
             WHERE ${matchClause}
               AND ((created_at > @createdAt)
                OR (created_at = @createdAt AND id > @id))
             ORDER BY created_at ASC, id ASC
             LIMIT @limit`
          )
          .all({
            like,
            createdAt: cursor.createdAt,
            id: cursor.id,
            limit: limit + 1,
          }) as Record<string, unknown>[])
      : (this.db
          .prepare(
            `${CITATION_SELECT}
             WHERE ${matchClause}
             ORDER BY created_at ASC, id ASC
             LIMIT @limit`
          )
          .all({ like, limit: limit + 1 }) as Record<string, unknown>[]);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const citations = pageRows.map((r) => this.rowToCitation(r));
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeCursor({
            createdAt: (pageRows[pageRows.length - 1].created_at as string) ?? '',
            id: (pageRows[pageRows.length - 1].id as number) ?? 0,
          })
        : undefined;

    return { citations, nextCursor };
  }

  updatePdfPath(doi: string, pdfPath: string): void {
    const now = new Date().toISOString();
    // Transition dual-write: manifestations are the source of truth; the
    // legacy column is still written for one release (downgrade safety).
    this.db
      .prepare('UPDATE citations SET pdf_path = ?, updated_at = ? WHERE doi = ?')
      .run(pdfPath, now, doi);
    const row = this.db.prepare('SELECT id FROM citations WHERE doi = ?').get(doi) as
      | { id?: number }
      | undefined;
    if (row?.id != null) {
      this.upsertManifestation({ citationId: row.id, kind: 'pdf', path: pdfPath });
    }
  }

  /**
   * Insert or refresh a manifestation row. Refreshes last_seen_at and fills
   * hash/extractor fields without ever nulling values a previous writer
   * recorded (COALESCE against the incoming row).
   */
  upsertManifestation(input: ManifestationInput): number {
    const now = new Date().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO manifestations
           (citation_id, kind, path, content_hash, extractor_name, extractor_version,
            created_at, last_seen_at)
         VALUES (@citationId, @kind, @path, @contentHash, @extractorName, @extractorVersion,
            @now, @now)
         ON CONFLICT (citation_id, kind, path) DO UPDATE SET
           content_hash = COALESCE(excluded.content_hash, manifestations.content_hash),
           extractor_name = COALESCE(excluded.extractor_name, manifestations.extractor_name),
           extractor_version = COALESCE(excluded.extractor_version, manifestations.extractor_version),
           last_seen_at = excluded.last_seen_at
         RETURNING id`
      )
      .get({
        citationId: input.citationId,
        kind: input.kind,
        path: input.path,
        contentHash: input.contentHash ?? null,
        extractorName: input.extractorName ?? null,
        extractorVersion: input.extractorVersion ?? null,
        now,
      }) as { id: number };
    return row.id;
  }

  getManifestation(citationId: number, kind: ManifestationKind): Manifestation | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM manifestations
         WHERE citation_id = ? AND kind = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(citationId, kind) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: row.id as number,
      citationId: row.citation_id as number,
      kind: row.kind as ManifestationKind,
      path: row.path as string,
      contentHash: (row.content_hash as string | null) ?? undefined,
      extractorName: (row.extractor_name as string | null) ?? undefined,
      extractorVersion: (row.extractor_version as string | null) ?? undefined,
      createdAt: row.created_at as string,
      lastSeenAt: (row.last_seen_at as string | null) ?? undefined,
    };
  }

  /** True when the FTS5 virtual tables exist (they do after migrations run). */
  hasFtsIndex(): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'")
      .get() as { name?: string } | undefined;
    return row?.name === 'chunks_fts';
  }

  /**
   * Replace all chunks for a manifestation in one transaction. The FTS index
   * stays consistent via the sync triggers. content_hash is the hash of the
   * SOURCE Markdown (shared by every chunk row) so unchanged documents can be
   * skipped on re-index.
   */
  replaceChunks(args: {
    manifestationId: number;
    citationId: number;
    contentHash: string;
    chunkerVersion: number;
    chunks: ChunkInput[];
  }): void {
    const del = this.db.prepare('DELETE FROM chunks WHERE manifestation_id = ?');
    const ins = this.db.prepare(
      `INSERT INTO chunks
         (citation_id, manifestation_id, ordinal, section_path, text, content_hash, chunker_version)
       VALUES (@citationId, @manifestationId, @ordinal, @sectionPath, @text, @contentHash, @chunkerVersion)`
    );
    this.db.transaction(() => {
      del.run(args.manifestationId);
      for (const chunk of args.chunks) {
        ins.run({
          citationId: args.citationId,
          manifestationId: args.manifestationId,
          ordinal: chunk.ordinal,
          sectionPath: JSON.stringify(chunk.sectionPath),
          text: chunk.text,
          contentHash: args.contentHash,
          chunkerVersion: args.chunkerVersion,
        });
      }
    })();
  }

  /** Source hash + chunker version of the existing index for a manifestation. */
  getChunkIndexState(
    manifestationId: number
  ): { contentHash: string; chunkerVersion: number } | undefined {
    const row = this.db
      .prepare(
        'SELECT content_hash, chunker_version FROM chunks WHERE manifestation_id = ? LIMIT 1'
      )
      .get(manifestationId) as { content_hash: string; chunker_version: number } | undefined;
    if (!row) return undefined;
    return { contentHash: row.content_hash, chunkerVersion: row.chunker_version };
  }

  getChunksForCitation(citationId: number): ChunkRecord[] {
    const rows = this.db
      .prepare(
        'SELECT ordinal, section_path, text FROM chunks WHERE citation_id = ? ORDER BY ordinal'
      )
      .all(citationId) as Record<string, unknown>[];
    return rows.map((row) => ({
      ordinal: row.ordinal as number,
      sectionPath: parseSectionPath(row.section_path),
      text: row.text as string,
    }));
  }

  /**
   * Ranked full-text search across citation metadata (citations_fts) and
   * extracted-body chunks (chunks_fts), merged per citation by best bm25 rank.
   * Offset-paginated: bm25 ordering has no stable natural cursor.
   */
  searchFts(
    query: string,
    options: { limit?: number; offset?: number } = {}
  ): { results: Array<{ citation: Citation; matches: ChunkMatch[] }>; hasMore: boolean } {
    const match = toFtsQuery(query);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);

    const rows = this.db
      .prepare(
        `WITH meta AS (
           SELECT rowid AS citation_id, citations_fts.rank AS rank
           FROM citations_fts WHERE citations_fts MATCH @match
         ),
         chunk_hits AS (
           SELECT c.citation_id AS citation_id, MIN(chunks_fts.rank) AS rank
           FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
           WHERE chunks_fts MATCH @match
           GROUP BY c.citation_id
         ),
         combined AS (
           SELECT citation_id, MIN(rank) AS rank FROM (
             SELECT citation_id, rank FROM meta
             UNION ALL
             SELECT citation_id, rank FROM chunk_hits
           ) GROUP BY citation_id
         )
         SELECT citations.*, (
             SELECT m.path FROM manifestations m
             WHERE m.citation_id = citations.id AND m.kind = 'pdf'
             ORDER BY m.id DESC LIMIT 1
           ) AS manifest_pdf_path
         FROM combined JOIN citations ON citations.id = combined.citation_id
         ORDER BY combined.rank ASC, citations.id ASC
         LIMIT @limit OFFSET @offset`
      )
      .all({ match, limit: limit + 1, offset }) as Record<string, unknown>[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const matchStmt = this.db.prepare(
      `SELECT c.ordinal AS ordinal, c.section_path AS section_path,
              snippet(chunks_fts, 0, '<b>', '</b>', '…', 12) AS snip
       FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
       WHERE chunks_fts MATCH @match AND c.citation_id = @citationId
       ORDER BY chunks_fts.rank LIMIT 3`
    );

    const results = pageRows.map((row) => ({
      citation: this.rowToCitation(row),
      matches: (matchStmt.all({ match, citationId: row.id }) as Record<string, unknown>[]).map(
        (m) => ({
          chunkOrdinal: m.ordinal as number,
          sectionPath: parseSectionPath(m.section_path),
          snippet: m.snip as string,
        })
      ),
    }));

    return { results, hasMore };
  }

  /** Top chunk candidates for verify-quote's fuzzy fallback. */
  searchChunkCandidates(
    ftsMatch: string,
    options: { doi?: string; limit?: number } = {}
  ): ChunkCandidate[] {
    const limit = Math.min(Math.max(options.limit ?? 5, 1), 20);
    const doiClause = options.doi ? 'AND cit.doi = @doi' : '';
    const rows = this.db
      .prepare(
        `SELECT cit.doi AS doi, c.ordinal AS ordinal, c.section_path AS section_path,
                c.text AS text
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN citations cit ON cit.id = c.citation_id
         WHERE chunks_fts MATCH @match ${doiClause}
         ORDER BY chunks_fts.rank LIMIT @limit`
      )
      .all({ match: ftsMatch, doi: options.doi, limit }) as Record<string, unknown>[];
    return rows.map((row) => ({
      doi: row.doi as string,
      ordinal: row.ordinal as number,
      sectionPath: parseSectionPath(row.section_path),
      text: row.text as string,
    }));
  }

  updateVerificationStatus(doi: string, status: VerificationStatus): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE citations SET verification_status = ?, last_verified = ?, updated_at = ? WHERE doi = ?'
      )
      .run(status, now, now, doi);
  }

  updateAccessType(doi: string, accessType: AccessType): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE citations SET access_type = ?, updated_at = ? WHERE doi = ?')
      .run(accessType, now, doi);
  }

  logRetrieval(attempt: RetrievalAttempt): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO retrieval_log
          (citation_id, source, url, success, error_message, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        attempt.citationId,
        attempt.source,
        attempt.url || null,
        attempt.success ? 1 : 0,
        attempt.errorMessage || null,
        attempt.durationMs || null,
        now
      );
  }

  getRetrievalLog(doi: string): RetrievalAttempt[] {
    const citation = this.getCitationByDoi(doi);
    if (!citation || citation.id == null) return [];

    const rows = this.db
      .prepare('SELECT * FROM retrieval_log WHERE citation_id = ? ORDER BY created_at DESC')
      .all(citation.id) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r.id as number,
      citationId: r.citation_id as number,
      source: r.source as string,
      url: r.url as string | undefined,
      success: Boolean(r.success),
      errorMessage: r.error_message as string | undefined,
      durationMs: r.duration_ms as number | undefined,
      createdAt: r.created_at as string | undefined,
    }));
  }

  close(): void {
    this.db.close();
  }

  private rowToCitation(row: Record<string, unknown>): Citation {
    return {
      id: row.id as number,
      doi: row.doi as string,
      url: row.url as string | undefined,
      title: row.title as string | undefined,
      authors: row.authors as string | undefined,
      year: row.year as number | undefined,
      journal: row.journal as string | undefined,
      bibtexKey: row.bibtex_key as string | undefined,
      pdfPath: ((row.manifest_pdf_path ?? row.pdf_path) as string | null) ?? undefined,
      verificationStatus: row.verification_status as Citation['verificationStatus'],
      accessType: row.access_type as Citation['accessType'],
      lastVerified: row.last_verified as string | undefined,
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }
}

function parseSectionPath(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
      return parsed as string[];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build a safe FTS5 MATCH expression from free text: a fully double-quoted
 * query becomes one phrase; otherwise each whitespace token is quoted and
 * joined (implicit AND), so user input can never inject FTS operators.
 */
export function toFtsQuery(query: string): string {
  const trimmed = query.trim();
  const inner = trimmed.slice(1, -1);
  if (
    trimmed.length > 1 &&
    trimmed.startsWith('"') &&
    trimmed.endsWith('"') &&
    !inner.includes('"')
  ) {
    return `"${inner}"`;
  }
  const tokens = trimmed
    .split(/\s+/)
    .map((token) => token.replace(/"/g, ''))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return '""';
  return tokens.map((token) => `"${token}"`).join(' ');
}

interface CursorState {
  createdAt: string;
  id: number;
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
}

function decodeCursor(cursor: string): CursorState {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64').toString('utf8')
    ) as Partial<CursorState>;
    if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'number') {
      throw new Error('Invalid cursor');
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new Error('Invalid cursor');
  }
}

let _instance: Database | undefined;

export function getDatabase(dbPath?: string): Database {
  if (dbPath) {
    return new Database(dbPath);
  }
  if (!_instance) {
    _instance = new Database();
  }
  return _instance;
}
