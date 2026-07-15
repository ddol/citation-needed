import fs from 'fs';
import type { Database } from '../db/index';
import type { AuthConfig } from '../models/auth';
import type { RetrievalResult } from '../models/retrieval';
import { ArxivResolver, selectArxivMatch } from './resolvers/arxiv';
import { UnpaywallResolver } from './resolvers/unpaywall';
import { SemanticScholarResolver, resetSemanticScholarBreaker } from './resolvers/semantic-scholar';
import { DOI_LOOKUP_THRESHOLD, isTitleMatch } from './title-match';
import { OpenAccessDownloader } from './downloaders/open-access';
import { AuthenticatedDownloader } from './downloaders/authenticated';
import { createLogger } from '../utils/logger';
import type { CitationFileIdentity } from '../utils/file';
import { getCitationFileStem } from '../utils/file';
import { getAdapter } from './publishers/index';

export { ArxivResolver } from './resolvers/arxiv';
export { UnpaywallResolver } from './resolvers/unpaywall';
export { SemanticScholarResolver } from './resolvers/semantic-scholar';
export { DoiResolver } from './resolvers/doi';
export { OpenAccessDownloader } from './downloaders/open-access';
export { AuthenticatedDownloader } from './downloaders/authenticated';
export { publishers, getAdapter } from './publishers/index';

const logger = createLogger('retrieval-orchestrator');

/**
 * Accumulated across one DOI's trip through the cascade.
 *
 * `attempts` is a one-line summary of every stage tried, so the final
 * `RetrievalResult.message` can explain why nothing worked. `throttled` records
 * that a stage refused because it was rate-limiting us, which means this DOI was
 * never really tried and is worth retrying later — unlike "no source has it".
 */
interface CascadeContext {
  attempts: string[];
  throttled: boolean;
}

export const UNPAYWALL_EMAIL_HINT =
  'no contact email; run `citation-needed auth set-email <you@example.org>` ' +
  'or set CITATION_NEEDED_EMAIL to enable Unpaywall';

/**
 * Unpaywall rejects placeholder addresses with HTTP 422 ("Please use your own
 * email address in API calls"), so DEFAULT_CONTACT_EMAIL — fine as a download
 * User-Agent — must not be passed here. Treat it as absent and say so, rather
 * than burning a lookup on a guaranteed 422.
 */
function usableContactEmail(email?: string): string | undefined {
  const trimmed = email?.trim();
  if (!trimmed || /@(example|test|invalid|localhost)\.(com|org|net)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export class RetrievalOrchestrator {
  private db: Database;

  private authConfig: AuthConfig;

  private downloader: OpenAccessDownloader;

  private storageDir?: string;

  constructor(db: Database, authConfig: AuthConfig = {}, storageDir?: string) {
    this.db = db;
    // CITATION_NEEDED_EMAIL already configures the downloader's User-Agent and
    // the DOI resolver, so honour it for Unpaywall too. Without this, setting
    // only the env var silently skipped Unpaywall — the widest open-access
    // source we have — and dumped every lookup on the arXiv fallback.
    this.authConfig = {
      ...authConfig,
      email: authConfig.email || process.env.CITATION_NEEDED_EMAIL,
    };
    this.storageDir = storageDir;
    this.downloader = new OpenAccessDownloader({ storageDir, email: this.authConfig.email });
  }

  async retrievePdf(doi: string, identity?: CitationFileIdentity): Promise<RetrievalResult> {
    const cachedCitation = this.db.getCitation(doi);
    if (cachedCitation?.pdfPath && fs.existsSync(cachedCitation.pdfPath)) {
      return {
        success: true,
        localPath: cachedCitation.pdfPath,
        source: 'cache',
        message: 'Already downloaded',
      };
    }

    const fileStem = getCitationFileStem({ doi, ...identity });
    const existing = this.downloader.getLocalPath(doi, fileStem);
    if (existing) {
      return { success: true, localPath: existing, source: 'cache', message: 'Already downloaded' };
    }

    const ctx: CascadeContext = { attempts: [], throttled: false };

    const oaResult = await this.tryOpenAccess(doi, fileStem, ctx);
    if (oaResult.success) return oaResult;

    const publisherResult = await this.tryPublisher(doi, fileStem, ctx);
    if (publisherResult.success) return publisherResult;

    if (this.authConfig.proxies?.length) {
      const authResult = await this.tryAuthenticated(doi, fileStem, ctx);
      if (authResult.success) return authResult;
      return {
        success: false,
        source: 'authenticated',
        throttled: ctx.throttled,
        message: `${authResult.message}. attempts: ${ctx.attempts.join('; ')}`,
      };
    }

    ctx.attempts.push('authenticated(no proxy configured)');
    return {
      success: false,
      source: 'open-access',
      throttled: ctx.throttled,
      message: `No PDF found. attempts: ${ctx.attempts.join('; ')}`,
    };
  }

  /**
   * Clear per-run transient state (the Semantic Scholar throttle breaker) so a
   * caller can make a second attempt at DOIs a rate limit refused. Optional on
   * the retriever interface — a test double need not implement it.
   */
  // eslint-disable-next-line class-methods-use-this
  resetTransientState(): void {
    resetSemanticScholarBreaker();
  }

  /**
   * DOI-keyed sources run before the arXiv title search: a DOI names exactly
   * one paper, whereas a title search is a guess that has to be validated. It
   * also spares arXiv a request whenever a precise source already answered.
   */
  private async tryOpenAccess(
    doi: string,
    fileStem: string,
    ctx: CascadeContext
  ): Promise<RetrievalResult> {
    const title = this.db.getCitation(doi)?.title;

    const unpaywall = await this.tryUnpaywall(doi, fileStem, ctx);
    if (unpaywall) return unpaywall;

    const semanticScholar = await this.trySemanticScholar(doi, fileStem, ctx, title);
    if (semanticScholar) return semanticScholar;

    const arxiv = await this.tryArxiv(doi, fileStem, ctx, title);
    if (arxiv) return arxiv;

    return { success: false, source: 'open-access', message: 'No open-access PDF found' };
  }

  /** Download, record, and report — shared by every open-access source. */
  private async downloadAndRecord(
    doi: string,
    pdfUrl: string,
    fileStem: string,
    source: string,
    message: string
  ): Promise<RetrievalResult> {
    const localPath = await this.downloader.download(doi, pdfUrl, fileStem);
    this.db.transaction(() => {
      this.db.updatePdfPath(doi, localPath);
      this.db.updateVerificationStatus(doi, 'downloaded');
      this.db.updateAccessType(doi, 'open-access');
    });
    return { success: true, pdfUrl, localPath, source, message };
  }

  private async tryUnpaywall(
    doi: string,
    fileStem: string,
    ctx: CascadeContext
  ): Promise<RetrievalResult | undefined> {
    const email = usableContactEmail(this.authConfig.email);
    if (!email) {
      ctx.attempts.push(`unpaywall(skipped: ${UNPAYWALL_EMAIL_HINT})`);
      return undefined;
    }

    const lookup = await new UnpaywallResolver(email).getOpenAccessPdf(doi);
    if (!lookup.ok) {
      ctx.attempts.push(`unpaywall(${lookup.error})`);
      return undefined;
    }
    if (!lookup.value) {
      ctx.attempts.push('unpaywall(no open-access URL)');
      return undefined;
    }

    try {
      return await this.downloadAndRecord(
        doi,
        lookup.value,
        fileStem,
        'unpaywall',
        'Downloaded via Unpaywall'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Unpaywall download failed', { doi, err: message });
      ctx.attempts.push(`unpaywall(download failed: ${message})`);
      return undefined;
    }
  }

  private async trySemanticScholar(
    doi: string,
    fileStem: string,
    ctx: CascadeContext,
    title?: string
  ): Promise<RetrievalResult | undefined> {
    const lookup = await new SemanticScholarResolver().getOpenAccessPdf(doi);
    if (!lookup.ok) {
      ctx.attempts.push(`semantic-scholar(${lookup.error})`);
      if (lookup.throttled) ctx.throttled = true;
      return undefined;
    }
    if (!lookup.value) {
      ctx.attempts.push('semantic-scholar(no open-access PDF)');
      return undefined;
    }

    // Looked up by DOI, so the title is only a guard against bad upstream
    // metadata — hence the loose threshold. It still catches real errors:
    // Semantic Scholar offered koval2013precontact.pdf for Held 2016.
    const { pdfUrl, title: upstreamTitle } = lookup.value;
    if (title && upstreamTitle && !isTitleMatch(title, upstreamTitle, DOI_LOOKUP_THRESHOLD)) {
      ctx.attempts.push(`semantic-scholar(title mismatch for DOI: "${upstreamTitle}")`);
      return undefined;
    }

    try {
      return await this.downloadAndRecord(
        doi,
        pdfUrl,
        fileStem,
        'semantic-scholar',
        'Downloaded via Semantic Scholar'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Semantic Scholar download failed', { doi, err: message });
      ctx.attempts.push(`semantic-scholar(download failed: ${message})`);
      return undefined;
    }
  }

  private async tryArxiv(
    doi: string,
    fileStem: string,
    ctx: CascadeContext,
    title?: string
  ): Promise<RetrievalResult | undefined> {
    if (!title) {
      ctx.attempts.push('arxiv(skipped: no title for search)');
      return undefined;
    }

    const search = await new ArxivResolver().searchByTitle(title);
    if (!search.ok) {
      ctx.attempts.push(`arxiv(${search.error})`);
      return undefined;
    }
    if (search.value.length === 0) {
      ctx.attempts.push('arxiv(no matching paper)');
      return undefined;
    }

    const matched = selectArxivMatch(title, search.value);
    if (!matched) {
      ctx.attempts.push(
        `arxiv(no confident title match; best candidate: "${search.value[0].title}")`
      );
      return undefined;
    }

    try {
      return await this.downloadAndRecord(
        doi,
        matched.pdfUrl,
        fileStem,
        'arxiv',
        'Downloaded via arXiv'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('arXiv download failed', { doi, err: message });
      ctx.attempts.push(`arxiv(download failed: ${message})`);
      return undefined;
    }
  }

  private async tryPublisher(
    doi: string,
    fileStem: string,
    ctx: CascadeContext
  ): Promise<RetrievalResult> {
    const adapter = getAdapter(doi);
    if (!adapter) {
      ctx.attempts.push('publisher(no adapter for DOI prefix)');
      return { success: false, source: 'publisher', message: 'No publisher adapter' };
    }

    const pdfUrl = adapter.getPdfUrl?.(doi);
    if (!pdfUrl) {
      // Adapters exist for the prefix but can't yet resolve a direct PDF URL.
      // Stubbed in M1, real resolution lands in M2 (Restricted Paywall Access).
      ctx.attempts.push(`publisher(${adapter.name}: no direct PDF URL)`);
      return {
        success: false,
        source: 'publisher',
        message: `${adapter.name} has no direct PDF URL`,
      };
    }

    try {
      const localPath = await this.downloader.download(doi, pdfUrl, fileStem);
      this.db.transaction(() => {
        this.db.updatePdfPath(doi, localPath);
        this.db.updateVerificationStatus(doi, 'downloaded');
        this.db.updateAccessType(doi, 'open-access');
      });
      return {
        success: true,
        pdfUrl,
        localPath,
        source: `publisher:${adapter.name}`,
        message: `Downloaded via ${adapter.name}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Publisher download failed', { doi, adapter: adapter.name, err: message });
      ctx.attempts.push(`publisher(${adapter.name}: ${message})`);
      return {
        success: false,
        source: `publisher:${adapter.name}`,
        message: `${adapter.name} download failed: ${message}`,
      };
    }
  }

  private async tryAuthenticated(
    doi: string,
    fileStem: string,
    ctx: CascadeContext
  ): Promise<RetrievalResult> {
    const proxy = this.authConfig.proxies?.[0];
    if (!proxy) {
      ctx.attempts.push('authenticated(no proxy)');
      return { success: false, source: 'authenticated', message: 'No proxy configured' };
    }

    const authDownloader = new AuthenticatedDownloader(this.storageDir);
    const password = proxy.passwordEnvVar ? process.env[proxy.passwordEnvVar] : undefined;

    try {
      const landingUrl = `https://doi.org/${doi}`;
      const localPath = await authDownloader.download(doi, landingUrl, {
        username: proxy.username,
        password,
        fileStem,
        proxyUrl: proxy.proxyUrl,
      });
      this.db.transaction(() => {
        this.db.updatePdfPath(doi, localPath);
        this.db.updateVerificationStatus(doi, 'downloaded');
        this.db.updateAccessType(doi, 'institutional');
      });
      return {
        success: true,
        localPath,
        source: 'authenticated',
        message: 'Downloaded via institutional proxy',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.attempts.push(`authenticated(${message})`);
      return { success: false, source: 'authenticated', message };
    }
  }
}
