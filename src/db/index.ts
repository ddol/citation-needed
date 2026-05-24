import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Citation, VerificationStatus, AccessType } from '../models/citation';
import type { RetrievalAttempt } from '../models/retrieval';
import {
  CREATE_CITATIONS_TABLE,
  CREATE_RETRIEVAL_LOG_TABLE,
  CREATE_INDEXES,
  createCitationsTableStatement,
} from './schema';

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
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(CREATE_CITATIONS_TABLE);
    this.db.exec(CREATE_RETRIEVAL_LOG_TABLE);
    this.ensureAccessTypeColumn();
    this.migrateLegacyCitationSchema();
    this.migrateRetrievalLogForeignKey();
    this.ensureIndexes();
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

  addCitation(citation: Citation): Citation {
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
    stmt.run({
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
    return this.getCitationByDoi(citation.doi) || citation;
  }

  getCitation(doi: string): Citation | undefined {
    return this.getCitationByDoi(doi);
  }

  private getCitationByDoi(doi: string): Citation | undefined {
    const row = this.db.prepare('SELECT * FROM citations WHERE doi = ?').get(doi) as
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
      const rows = this.db
        .prepare('SELECT * FROM citations ORDER BY created_at DESC')
        .all() as Record<string, unknown>[];
      return rows.map((r) => this.rowToCitation(r));
    }

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    const rows = cursor
      ? (this.db
          .prepare(
            `SELECT * FROM citations
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
          .prepare('SELECT * FROM citations ORDER BY created_at ASC, id ASC LIMIT @limit')
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

  searchCitations(query: string): Citation[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM citations
         WHERE title LIKE ? OR authors LIKE ?
         ORDER BY created_at DESC`
      )
      .all(like, like) as Record<string, unknown>[];
    return rows.map((r) => this.rowToCitation(r));
  }

  updatePdfPath(doi: string, pdfPath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE citations SET pdf_path = ?, updated_at = ? WHERE doi = ?')
      .run(pdfPath, now, doi);
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
      pdfPath: row.pdf_path as string | undefined,
      verificationStatus: row.verification_status as Citation['verificationStatus'],
      accessType: row.access_type as Citation['accessType'],
      lastVerified: row.last_verified as string | undefined,
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }
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
  if (!_instance) {
    _instance = new Database(dbPath);
  }
  return _instance;
}
