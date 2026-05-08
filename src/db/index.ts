import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Citation, VerificationStatus, AccessType } from '../models/citation';
import type { RetrievalAttempt } from '../models/retrieval';
import {
  CREATE_CITATIONS_TABLE,
  CREATE_RETRIEVAL_LOG_TABLE,
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
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(CREATE_CITATIONS_TABLE);
    this.db.exec(CREATE_RETRIEVAL_LOG_TABLE);
    this.ensureAccessTypeColumn();
    this.migrateLegacyCitationSchema();
  }

  private ensureAccessTypeColumn(): void {
    try {
      this.db.exec(`ALTER TABLE citations ADD COLUMN access_type TEXT DEFAULT 'unknown'`);
    } catch {
      // column already exists, ignore
    }
  }

  private migrateLegacyCitationSchema(): void {
    const columns = this.db
      .prepare('PRAGMA table_info(citations)')
      .all() as Array<{ name: string }>;
    const hasExpectedShape =
      columns.length === EXPECTED_CITATION_COLUMNS.length &&
      EXPECTED_CITATION_COLUMNS.every((expectedColumn) =>
        columns.some((column) => column.name === expectedColumn)
      );

    if (hasExpectedShape) {
      return;
    }

    this.db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE citations_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doi TEXT UNIQUE,
        url TEXT,
        title TEXT,
        authors TEXT,
        year INTEGER,
        journal TEXT,
        bibtex_key TEXT,
        pdf_path TEXT,
        verification_status TEXT DEFAULT 'unverified',
        access_type TEXT DEFAULT 'unknown',
        last_verified TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
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
    const row = this.db
      .prepare('SELECT * FROM citations WHERE doi = ?')
      .get(doi) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return this.rowToCitation(row);
  }

  getAllCitations(): Citation[] {
    const rows = this.db
      .prepare('SELECT * FROM citations ORDER BY created_at DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToCitation(r));
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
      .prepare(`
        INSERT INTO retrieval_log
          (citation_id, source, url, success, error_message, duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
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
      .prepare(
        'SELECT * FROM retrieval_log WHERE citation_id = ? ORDER BY created_at DESC'
      )
      .all(citation.id) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r['id'] as number,
      citationId: r['citation_id'] as number,
      source: r['source'] as string,
      url: r['url'] as string | undefined,
      success: Boolean(r['success']),
      errorMessage: r['error_message'] as string | undefined,
      durationMs: r['duration_ms'] as number | undefined,
      createdAt: r['created_at'] as string | undefined,
    }));
  }

  close(): void {
    this.db.close();
  }

  private rowToCitation(row: Record<string, unknown>): Citation {
    return {
      id: row['id'] as number,
      doi: row['doi'] as string,
      url: row['url'] as string | undefined,
      title: row['title'] as string | undefined,
      authors: row['authors'] as string | undefined,
      year: row['year'] as number | undefined,
      journal: row['journal'] as string | undefined,
      bibtexKey: row['bibtex_key'] as string | undefined,
      pdfPath: row['pdf_path'] as string | undefined,
      verificationStatus: row['verification_status'] as Citation['verificationStatus'],
      accessType: row['access_type'] as Citation['accessType'],
      lastVerified: row['last_verified'] as string | undefined,
      createdAt: row['created_at'] as string | undefined,
      updatedAt: row['updated_at'] as string | undefined,
    };
  }
}

let _instance: Database | undefined;

export function getDatabase(dbPath?: string): Database {
  if (!_instance) {
    _instance = new Database(dbPath);
  }
  return _instance;
}
