import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getCitationFileStem, sanitizeFilename, getPdfDir, ensureDir } from '../../utils/file';
import { RateLimiter } from '../../utils/rate-limiter';
import { createLogger } from '../../utils/logger';
import { VERSION } from '../../utils/version';
import {
  DEFAULT_CONTACT_EMAIL,
  OPEN_ACCESS_DOWNLOAD_TIMEOUT_MS,
  OPEN_ACCESS_RATE_LIMIT_MS,
} from '../config';

const logger = createLogger('open-access-downloader');

export interface OpenAccessDownloaderOptions {
  storageDir?: string;
  email?: string;
}

export class OpenAccessDownloader {
  private storageDir: string;

  private rateLimiter: RateLimiter;

  private email: string;

  constructor(storageDirOrOptions?: string | OpenAccessDownloaderOptions) {
    const options: OpenAccessDownloaderOptions =
      typeof storageDirOrOptions === 'string'
        ? { storageDir: storageDirOrOptions }
        : (storageDirOrOptions ?? {});

    this.storageDir = options.storageDir || getPdfDir();
    ensureDir(this.storageDir);
    this.rateLimiter = new RateLimiter(OPEN_ACCESS_RATE_LIMIT_MS);
    this.email = options.email || process.env.CITATION_NEEDED_EMAIL || DEFAULT_CONTACT_EMAIL;
  }

  async download(doi: string, pdfUrl: string, fileStem?: string): Promise<string> {
    await this.rateLimiter.wait();

    const filename = `${sanitizeFilename(fileStem || getCitationFileStem({ doi }))}.pdf`;
    const filePath = path.join(this.storageDir, filename);

    logger.info('Downloading PDF', { doi, pdfUrl });

    const response = await axios.get<Buffer>(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: OPEN_ACCESS_DOWNLOAD_TIMEOUT_MS,
      headers: {
        'User-Agent': `citation-needed/${VERSION} (mailto:${this.email})`,
      },
    });

    fs.writeFileSync(filePath, Buffer.from(response.data));
    logger.info('PDF saved', { doi, filePath });
    return filePath;
  }

  getLocalPath(doi: string, fileStem?: string): string | null {
    const preferredFilename = `${sanitizeFilename(fileStem || getCitationFileStem({ doi }))}.pdf`;
    const preferredPath = path.join(this.storageDir, preferredFilename);
    if (fs.existsSync(preferredPath)) {
      return preferredPath;
    }

    const legacyFilename = `${sanitizeFilename(doi)}.pdf`;
    const legacyPath = path.join(this.storageDir, legacyFilename);
    return fs.existsSync(legacyPath) ? legacyPath : null;
  }
}
