import fs from 'fs';
import os from 'os';
import path from 'path';

import pdf2md from '@opendocsg/pdf2md';
import { extractPdfMarkdown } from '../../../src/verification/markdown';

jest.mock('@opendocsg/pdf2md', () => jest.fn());

function tempPdfPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citation-needed-pdf-md-'));
  return path.join(dir, 'paper.pdf');
}

describe('extractPdfMarkdown', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('throws a clear error when PDF file does not exist', async () => {
    await expect(extractPdfMarkdown('/tmp/does-not-exist.pdf')).rejects.toThrow(
      'PDF file not found: /tmp/does-not-exist.pdf'
    );
  });

  test('reads PDF bytes, converts with pdf2md, and trims output', async () => {
    const pdfPath = tempPdfPath();
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nmock'));

    (pdf2md as jest.Mock).mockResolvedValueOnce('\n\n# Heading\n\nBody\n\n');

    const result = await extractPdfMarkdown(pdfPath);

    expect(result).toBe('# Heading\n\nBody');
    expect(pdf2md).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer((pdf2md as jest.Mock).mock.calls[0][0])).toBe(true);

    fs.rmSync(path.dirname(pdfPath), { recursive: true, force: true });
  });
});
