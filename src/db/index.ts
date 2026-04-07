import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Citation, TrustEvent } from '../models/citation';
import type { RetrievalAttempt } from '../models/retrieval';
import {
  CREATE_CITATIONS_TABLE,
  CREATE_TRUST_EVENTS_TABLE,
  CREATE_RETRIEVAL_LOG_TABLE,
} from './schema';

// Use require for better-sqlite3 (CommonJS native module)
const BetterSqlite3 = require('better-sqlite3');

export type { Citation, TrustEvent };

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
    this.db.exec(CREATE_TRUST_EVENTS_TABLE);
    this.db.exec(CREATE_RETRIEVAL_LOG_TABLE);
    // Add access_type column if missing (migration for existing dbs)
    try {
      this.db.exec(`ALTER TABLE citations ADD COLUMN access_type TEXT DEFAULT 'unknown'`);
    } catch {
      // column already exists, ignore
    }
  }

  addCitation(citation: Citation): Citation {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO citations
        (doi, url, title, authors, year, journal, bibtex_key, trust_score,
         verification_status, access_type, created_at, updated_at)
      VALUES
        (@doi, @url, @title, @authors, @year, @journal, @bibtexKey, @trustScore,
         @verificationStatus, @accessType, @createdAt, @updatedAt)
    `);
    stmt.run({
      doi: citation.doi || null,
      url: citation.url || null,
      title: citation.title || null,
      authors: citation.authors || null,
      year: citation.year || null,
      journal: citation.journal || null,
      bibtexKey: citation.bibtexKey || null,
      trustScore: citation.trustScore ?? 0.5,
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

  updateTrustScore(
    doi: string,
    score: number,
    notes?: string,
    agentId?: string
  ): void {
    const citation = this.getCitationByDoi(doi);
    if (!citation || citation.id == null) return;

    const oldScore = citation.trustScore ?? 0.5;
    const delta = score - oldScore;
    const now = new Date().toISOString();

    this.db
      .prepare('UPDATE citations SET trust_score = ?, updated_at = ? WHERE doi = ?')
      .run(score, now, doi);

    this.db
      .prepare(`
        INSERT INTO trust_events
          (citation_id, event_type, score_delta, notes, agent_id, created_at)
        VALUES (?, 'score_update', ?, ?, ?, ?)
      `)
      .run(citation.id, delta, notes || null, agentId || null, now);
  }

  updatePdfPath(doi: string, pdfPath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE citations SET pdf_path = ?, updated_at = ? WHERE doi = ?')
      .run(pdfPath, now, doi);
  }

  updateVerificationStatus(doi: string, status: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE citations SET verification_status = ?, last_verified = ?, updated_at = ? WHERE doi = ?'
      )
      .run(status, now, now, doi);
  }

  updateAccessType(doi: string, accessType: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE citations SET access_type = ?, updated_at = ? WHERE doi = ?')
      .run(accessType, now, doi);
  }

  getTrustHistory(doi: string): TrustEvent[] {
    const citation = this.getCitationByDoi(doi);
    if (!citation || citation.id == null) return [];

    const rows = this.db
      .prepare(
        'SELECT * FROM trust_events WHERE citation_id = ? ORDER BY created_at ASC'
      )
      .all(citation.id) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: r['id'] as number,
      citationId: r['citation_id'] as number,
      eventType: r['event_type'] as string,
      scoreDelta: r['score_delta'] as number,
      notes: r['notes'] as string | undefined,
      agentId: r['agent_id'] as string | undefined,
      createdAt: r['created_at'] as string | undefined,
    }));
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
      trustScore: row['trust_score'] as number,
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
