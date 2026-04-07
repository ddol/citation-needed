import fs from 'fs';
import path from 'path';
import os from 'os';

// Use require for better-sqlite3 (CommonJS native module)
const BetterSqlite3 = require('better-sqlite3');

export interface Citation {
  id?: number;
  doi: string;
  url?: string;
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
  bibtexKey?: string;
  pdfPath?: string;
  trustScore?: number;
  verificationStatus?: string;
  lastVerified?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TrustEvent {
  id?: number;
  citationId: number;
  eventType: string;
  scoreDelta: number;
  notes?: string;
  agentId?: string;
  createdAt?: string;
}

export class Database {
  private db: InstanceType<typeof BetterSqlite3>;

  constructor(dbPath?: string) {
    const resolvedPath =
      dbPath ||
      process.env.SOBER_SOURCES_DB ||
      path.join(os.homedir(), '.sober-sources', 'citations.db');

    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(resolvedPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS citations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doi TEXT UNIQUE,
        url TEXT,
        title TEXT,
        authors TEXT,
        year INTEGER,
        journal TEXT,
        bibtex_key TEXT,
        pdf_path TEXT,
        trust_score REAL DEFAULT 0.5,
        verification_status TEXT DEFAULT 'unverified',
        last_verified TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS trust_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        citation_id INTEGER REFERENCES citations(id),
        event_type TEXT,
        score_delta REAL,
        notes TEXT,
        agent_id TEXT,
        created_at TEXT
      );
    `);
  }

  addCitation(citation: Citation): Citation {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO citations
        (doi, url, title, authors, year, journal, bibtex_key, trust_score, verification_status, created_at, updated_at)
      VALUES
        (@doi, @url, @title, @authors, @year, @journal, @bibtexKey, @trustScore, @verificationStatus, @createdAt, @updatedAt)
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
      .prepare(
        'UPDATE citations SET trust_score = ?, updated_at = ? WHERE doi = ?'
      )
      .run(score, now, doi);

    this.db
      .prepare(`
        INSERT INTO trust_events (citation_id, event_type, score_delta, notes, agent_id, created_at)
        VALUES (?, 'score_update', ?, ?, ?, ?)
      `)
      .run(citation.id, delta, notes || null, agentId || null, now);
  }

  updatePdfPath(doi: string, pdfPath: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE citations SET pdf_path = ?, updated_at = ? WHERE doi = ?'
      )
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
      verificationStatus: row['verification_status'] as string,
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
