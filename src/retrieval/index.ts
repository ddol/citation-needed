import fs from 'fs';
import type { Database } from '../db/index';
import type { AuthConfig } from '../models/auth';
import type { RetrievalResult } from '../models/retrieval';
import { ArxivResolver, selectArxivMatch } from './resolvers/arxiv';
import { UnpaywallResolver } from './resolvers/unpaywall';
import { OpenAccessDownloader } from './downloaders/open-access';
import { AuthenticatedDownloader } from './downloaders/authenticated';
import { createLogger } from '../utils/logger';
import type { CitationFileIdentity } from '../utils/file';
import { getCitationFileStem } from '../utils/file';
import { getAdapter } from './publishers/index';

export { ArxivResolver } from './resolvers/arxiv';
export { UnpaywallResolver } from './resolvers/unpaywall';
export { DoiResolver } from './resolvers/doi';
export { OpenAccessDownloader } from './downloaders/open-access';
export { AuthenticatedDownloader } from './downloaders/authenticated';
export { publishers, getAdapter } from './publishers/index';

const logger = createLogger('retrieval-orchestrator');

export class RetrievalOrchestrator {
  private db: Database;

  private authConfig: AuthConfig;

  private downloader: OpenAccessDownloader;

  private storageDir?: string;

  constructor(db: Database, authConfig: AuthConfig = {}, storageDir?: string) {
    this.db = db;
    this.authConfig = authConfig;
    this.storageDir = storageDir;
    this.downloader = new OpenAccessDownloader({ storageDir, email: authConfig.email });
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

    // attempts accumulates a one-line summary of every cascade step we tried,
    // so the final RetrievalResult.message can explain why nothing worked.
    const attempts: string[] = [];

    const oaResult = await this.tryOpenAccess(doi, fileStem, attempts);
    if (oaResult.success) return oaResult;

    const publisherResult = await this.tryPublisher(doi, fileStem, attempts);
    if (publisherResult.success) return publisherResult;

    if (this.authConfig.proxies?.length) {
      const authResult = await this.tryAuthenticated(doi, fileStem, attempts);
      if (authResult.success) return authResult;
      return {
        success: false,
        source: 'authenticated',
        message: `${authResult.message}. attempts: ${attempts.join('; ')}`,
      };
    }

    attempts.push('authenticated(no proxy configured)');
    return {
      success: false,
      source: 'open-access',
      message: `No PDF found. attempts: ${attempts.join('; ')}`,
    };
  }

  private async tryOpenAccess(
    doi: string,
    fileStem: string,
    attempts: string[]
  ): Promise<RetrievalResult> {
    if (this.authConfig.email) {
      const unpaywall = new UnpaywallResolver(this.authConfig.email);
      const lookup = await unpaywall.getOpenAccessPdf(doi);
      if (!lookup.ok) {
        attempts.push(`unpaywall(${lookup.error})`);
      } else if (lookup.value) {
        const { value: pdfUrl } = lookup;
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
            source: 'unpaywall',
            message: 'Downloaded via Unpaywall',
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('Unpaywall download failed', { doi, err: message });
          attempts.push(`unpaywall(download failed: ${message})`);
        }
      } else {
        attempts.push('unpaywall(no open-access URL)');
      }
    } else {
      attempts.push('unpaywall(skipped: no email configured)');
    }

    const citation = this.db.getCitation(doi);
    if (citation?.title) {
      const arxiv = new ArxivResolver();
      const search = await arxiv.searchByTitle(citation.title);
      if (!search.ok) {
        attempts.push(`arxiv(${search.error})`);
      } else if (search.value.length > 0) {
        const matched = selectArxivMatch(citation.title, search.value);
        if (!matched) {
          attempts.push(
            `arxiv(no confident title match; best candidate: "${search.value[0].title}")`
          );
          return { success: false, source: 'open-access', message: 'No open-access PDF found' };
        }
        try {
          const { pdfUrl } = matched;
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
            source: 'arxiv',
            message: 'Downloaded via arXiv',
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn('arXiv download failed', { doi, err: message });
          attempts.push(`arxiv(download failed: ${message})`);
        }
      } else {
        attempts.push('arxiv(no matching paper)');
      }
    } else {
      attempts.push('arxiv(skipped: no title for search)');
    }

    return { success: false, source: 'open-access', message: 'No open-access PDF found' };
  }

  private async tryPublisher(
    doi: string,
    fileStem: string,
    attempts: string[]
  ): Promise<RetrievalResult> {
    const adapter = getAdapter(doi);
    if (!adapter) {
      attempts.push('publisher(no adapter for DOI prefix)');
      return { success: false, source: 'publisher', message: 'No publisher adapter' };
    }

    const pdfUrl = adapter.getPdfUrl?.(doi);
    if (!pdfUrl) {
      // Adapters exist for the prefix but can't yet resolve a direct PDF URL.
      // Stubbed in M1, real resolution lands in M2 (Restricted Paywall Access).
      attempts.push(`publisher(${adapter.name}: no direct PDF URL)`);
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
      attempts.push(`publisher(${adapter.name}: ${message})`);
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
    attempts: string[]
  ): Promise<RetrievalResult> {
    const proxy = this.authConfig.proxies?.[0];
    if (!proxy) {
      attempts.push('authenticated(no proxy)');
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
      attempts.push(`authenticated(${message})`);
      return { success: false, source: 'authenticated', message };
    }
  }
}
