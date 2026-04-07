import fs from 'fs';
import { createLogger } from '../utils/logger';

const logger = createLogger('pdf-extractor');

/**
 * Reads a local PDF file and extracts readable text.
 * Uses a best-effort approach: scans for text between BT/ET PDF markers
 * and extracts printable ASCII sequences. Does not require pdfjs.
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF file not found: ${pdfPath}`);
  }

  const buffer = fs.readFileSync(pdfPath);
  const content = buffer.toString('binary');

  const textParts: string[] = [];

  // Extract text between BT (Begin Text) and ET (End Text) markers
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;

  while ((match = btEtRegex.exec(content)) !== null) {
    const block = match[1];
    // Extract strings from Tj and TJ operators: (text)Tj or [(text)]TJ
    const strRegex = /\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g;
    let strMatch: RegExpExecArray | null;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const raw = strMatch[1] || strMatch[2] || '';
      // Filter to printable ASCII
      const printable = raw.replace(/[^\x20-\x7E]/g, ' ').trim();
      if (printable.length > 2) textParts.push(printable);
    }
  }

  // Fallback: extract long printable ASCII runs from binary
  if (textParts.length === 0) {
    const asciiRegex = /[\x20-\x7E]{8,}/g;
    let asciiMatch: RegExpExecArray | null;
    while ((asciiMatch = asciiRegex.exec(content)) !== null) {
      const segment = asciiMatch[0].trim();
      if (segment.split(' ').length > 2) {
        textParts.push(segment);
      }
    }
  }

  const result = textParts.join(' ');
  logger.debug('Extracted PDF text', { pdfPath, chars: result.length });
  return result;
}
