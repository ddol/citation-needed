import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { sanitizeFilename, getPdfDir, ensureDir } from '../../utils/file';
import { RateLimiter } from '../../utils/rate-limiter';
import { createLogger } from '../../utils/logger';

const logger = createLogger('open-access-downloader');

export class OpenAccessDownloader {
  private storageDir: string;
  private rateLimiter: RateLimiter;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || getPdfDir();
    ensureDir(this.storageDir);
    this.rateLimiter = new RateLimiter(1000);
  }

  async download(doi: string, pdfUrl: string): Promise<string> {
    await this.rateLimiter.wait();

    const filename = `${sanitizeFilename(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);

    logger.info('Downloading PDF', { doi, pdfUrl });

    const response = await axios.get<Buffer>(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': `citation-needed/0.1.0 (mailto:${process.env.CITATION_NEEDED_EMAIL || 'citation-needed@example.com'})`,
      },
    });

    fs.writeFileSync(filePath, Buffer.from(response.data));
    logger.info('PDF saved', { doi, filePath });
    return filePath;
  }

  getLocalPath(doi: string): string | null {
    const filename = `${sanitizeFilename(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }
}
