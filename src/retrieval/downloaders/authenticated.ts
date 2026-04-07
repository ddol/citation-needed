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

      await page.pdf({ path: filePath });
      logger.info('Authenticated PDF saved', { doi, filePath });
    } finally {
      await browser.close();
    }

    return filePath;
  }
}
