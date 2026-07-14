import crypto from 'crypto';
import fs from 'fs';

/** sha256 hex digest of an in-memory string (used for extracted Markdown). */
export function sha256String(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Streaming sha256 hex digest of a file (used for PDFs of arbitrary size). */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (part) => hash.update(part));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
