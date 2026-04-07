import fs from 'fs';
import path from 'path';
import { sanitizeFilename, getPdfDir, ensureDir } from '../../utils/file';
import { createLogger } from '../../utils/logger';

const logger = createLogger('authenticated-downloader');

export interface AuthDownloadOptions {
  username?: string;
  password?: string;
  proxyUrl?: string;
  timeout?: number;
}

export class AuthenticatedDownloader {
  private storageDir: string;

  constructor(storageDir?: string) {
    this.storageDir = storageDir || getPdfDir();
    ensureDir(this.storageDir);
  }

  async download(
    doi: string,
    url: string,
    options?: AuthDownloadOptions
  ): Promise<string> {
    let playwright: typeof import('playwright') | undefined;
    try {
      playwright = require('playwright') as typeof import('playwright');
    } catch {
      throw new Error(
        'playwright is not installed. Install it with: npm install playwright'
      );
    }

    const filename = `${sanitizeFilename(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);
    const timeout = options?.timeout ?? 30000;

    logger.info('Authenticated download starting', { doi, url });

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(
        options?.proxyUrl
          ? { proxy: { server: options.proxyUrl } }
          : undefined
      );
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'networkidle', timeout });

      if (options?.username && options?.password) {
        const usernameField = page.locator(
          'input[type="text"], input[name*="user"], input[id*="user"]'
        );
        const passwordField = page.locator('input[type="password"]');

        if ((await usernameField.count()) > 0) {
          await usernameField.first().fill(options.username);
          await passwordField.first().fill(options.password);
          await page.keyboard.press('Enter');
          await page.waitForLoadState('networkidle');
        }
      }

      // Look for a PDF link on the page and trigger a real download
      // instead of using page.pdf() which only snapshots the HTML
      const pdfLink = page.locator('a[href$=".pdf"], a[href*="pdf"]').first();
      if ((await pdfLink.count()) > 0) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout }),
          pdfLink.click(),
        ]);
        await download.saveAs(filePath);
      } else {
        // Fallback: try navigating to the URL directly and intercepting the response
        const response = await page.goto(url, { waitUntil: 'load', timeout });
        const contentType = response?.headers()['content-type'] || '';

        if (contentType.includes('application/pdf')) {
          const body = await response!.body();
          fs.writeFileSync(filePath, body);
        } else {
          throw new Error(
            `Could not find a downloadable PDF at ${url}. ` +
            `The page returned content-type: ${contentType}. ` +
            'Try providing a direct PDF URL instead.'
          );
        }
      }

      logger.info('Authenticated PDF saved', { doi, filePath });
    } finally {
      await browser.close();
    }

    return filePath;
  }
}
