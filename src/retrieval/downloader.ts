import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import type { Database } from '../db/index';

export class PdfDownloader {
  private db: Database;
  private storageDir: string;

  constructor(db: Database, storageDir?: string) {
    this.db = db;
    this.storageDir =
      storageDir ||
      process.env.SOBER_SOURCES_PDF_DIR ||
      path.join(os.homedir(), '.sober-sources', 'pdfs');

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  private sanitizeDoi(doi: string): string {
    return doi.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  async downloadOpenAccess(doi: string, pdfUrl: string): Promise<string> {
    const filename = `${this.sanitizeDoi(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);

    const response = await axios.get<Buffer>(pdfUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': `sober-sources/0.1.0 (mailto:${process.env.SOBER_SOURCES_EMAIL || 'sober-sources@example.com'})`,
      },
    });

    fs.writeFileSync(filePath, Buffer.from(response.data));
    this.db.updatePdfPath(doi, filePath);
    this.db.updateVerificationStatus(doi, 'downloaded');

    return filePath;
  }

  async downloadWithPlaywright(
    doi: string,
    url: string,
    credentials?: { username: string; password: string }
  ): Promise<string> {
    let playwright: typeof import('playwright') | undefined;
    try {
      playwright = require('playwright') as typeof import('playwright');
    } catch {
      throw new Error(
        'playwright is not installed. Install it with: npm install playwright'
      );
    }

    const filename = `${this.sanitizeDoi(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);

    const browser = await playwright.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      if (credentials) {
        // Fill login form if credentials provided
        const usernameField = page.locator(
          'input[type="text"], input[name*="user"], input[id*="user"]'
        );
        const passwordField = page.locator('input[type="password"]');

        if ((await usernameField.count()) > 0) {
          await usernameField.first().fill(credentials.username);
          await passwordField.first().fill(credentials.password);
          await page.keyboard.press('Enter');
          await page.waitForLoadState('networkidle');
        }
      }

      // Try to trigger PDF download
      await page.pdf({ path: filePath });

      this.db.updatePdfPath(doi, filePath);
      this.db.updateVerificationStatus(doi, 'downloaded');
    } finally {
      await browser.close();
    }

    return filePath;
  }

  getLocalPath(doi: string): string | null {
    const citation = this.db.getCitation(doi);
    if (citation?.pdfPath && fs.existsSync(citation.pdfPath)) {
      return citation.pdfPath;
    }

    // Fallback: check storage dir
    const filename = `${this.sanitizeDoi(doi)}.pdf`;
    const filePath = path.join(this.storageDir, filename);
    return fs.existsSync(filePath) ? filePath : null;
  }
}
