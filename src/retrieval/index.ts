import type { Database } from '../db/index';
import type { AuthConfig } from '../models/auth';
import type { RetrievalResult } from '../models/retrieval';
import { ArxivResolver } from './resolvers/arxiv';
import { UnpaywallResolver } from './resolvers/unpaywall';
import { OpenAccessDownloader } from './downloaders/open-access';
import { AuthenticatedDownloader } from './downloaders/authenticated';
import { createLogger } from '../utils/logger';

export { ArxivResolver, ArxivRetriever } from './resolvers/arxiv';
export { UnpaywallResolver, UnpaywallRetriever } from './resolvers/unpaywall';
export { DoiResolver } from './resolvers/doi';
export { OpenAccessDownloader } from './downloaders/open-access';
export { AuthenticatedDownloader } from './downloaders/authenticated';
export { publishers, getAdapter } from './publishers/index';

const logger = createLogger('retrieval-orchestrator');

export class RetrievalOrchestrator {
  private db: Database;
  private authConfig: AuthConfig;
  private downloader: OpenAccessDownloader;

  constructor(db: Database, authConfig: AuthConfig = {}) {
    this.db = db;
    this.authConfig = authConfig;
    this.downloader = new OpenAccessDownloader();
  }

  async retrievePdf(doi: string): Promise<RetrievalResult> {
    const existing = this.downloader.getLocalPath(doi);
    if (existing) {
      return { success: true, localPath: existing, source: 'cache', message: 'Already downloaded' };
    }

    const oaResult = await this.tryOpenAccess(doi);
    if (oaResult.success) return oaResult;

    if (this.authConfig.proxies?.length) {
      return this.tryAuthenticated(doi);
    }

    return oaResult;
  }

  private async tryOpenAccess(doi: string): Promise<RetrievalResult> {
    // 1. Try Unpaywall
    if (this.authConfig.email) {
      const unpaywall = new UnpaywallResolver(this.authConfig.email);
      const pdfUrl = await unpaywall.getOpenAccessPdf(doi);
      if (pdfUrl) {
        try {
          const localPath = await this.downloader.download(doi, pdfUrl);
          this.db.updatePdfPath(doi, localPath);
          this.db.updateVerificationStatus(doi, 'downloaded');
          this.db.updateAccessType(doi, 'open-access');
          return { success: true, pdfUrl, localPath, source: 'unpaywall', message: 'Downloaded via Unpaywall' };
        } catch (err) {
          logger.warn('Unpaywall download failed', { doi, err: String(err) });
        }
      }
    }

    // 2. Try arXiv
    const citation = this.db.getCitation(doi);
    if (citation?.title) {
      const arxiv = new ArxivResolver();
      const results = await arxiv.searchByTitle(citation.title);
      if (results.length > 0) {
        try {
          const pdfUrl = results[0].pdfUrl;
          const localPath = await this.downloader.download(doi, pdfUrl);
          this.db.updatePdfPath(doi, localPath);
          this.db.updateVerificationStatus(doi, 'downloaded');
          this.db.updateAccessType(doi, 'open-access');
          return { success: true, pdfUrl, localPath, source: 'arxiv', message: 'Downloaded via arXiv' };
        } catch (err) {
          logger.warn('arXiv download failed', { doi, err: String(err) });
        }
      }
    }

    return { success: false, source: 'open-access', message: 'No open-access PDF found' };
  }

  private async tryAuthenticated(doi: string): Promise<RetrievalResult> {
    const proxy = this.authConfig.proxies?.[0];
    if (!proxy) {
      return { success: false, source: 'authenticated', message: 'No proxy configured' };
    }

    const authDownloader = new AuthenticatedDownloader();
    const password = proxy.passwordEnvVar
      ? process.env[proxy.passwordEnvVar]
      : undefined;

    try {
      const landingUrl = `https://doi.org/${doi}`;
      const localPath = await authDownloader.download(doi, landingUrl, {
        username: proxy.username,
        password,
        proxyUrl: proxy.proxyUrl,
      });
      this.db.updatePdfPath(doi, localPath);
      this.db.updateVerificationStatus(doi, 'downloaded');
      this.db.updateAccessType(doi, 'institutional');
      return { success: true, localPath, source: 'authenticated', message: 'Downloaded via institutional proxy' };
    } catch (err) {
      return { success: false, source: 'authenticated', message: String(err) };
    }
  }
}
