import fs from 'fs';
import pdf2md from '@opendocsg/pdf2md';
import { createLogger } from '../utils/logger';

const logger = createLogger('pdf-markdown');

export interface PdfMarkdownExtractor {
  extract(pdfPath: string): Promise<string>;
}

class Pdf2MarkdownExtractor implements PdfMarkdownExtractor {
  async extract(pdfPath: string): Promise<string> {
    const buffer = await fs.promises.readFile(pdfPath);
    return pdf2md(buffer);
  }
}

const defaultExtractor = new Pdf2MarkdownExtractor();

export async function extractPdfMarkdown(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const markdown = (await defaultExtractor.extract(pdfPath)).trim();
  logger.debug('Extracted PDF markdown', { pdfPath, chars: markdown.length });
  return markdown;
}
