import React from 'react';
import { render, Text } from 'ink';
import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { UnpaywallResolver } from '../../retrieval/resolvers/unpaywall';
import { OpenAccessDownloader } from '../../retrieval/downloaders/open-access';

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <doi>')
    .description('Download PDF for a citation by DOI')
    .option('--url <url>', 'Direct PDF URL')
    .option('--email <email>', 'Email for Unpaywall API')
    .action(async (doi: string, options: { url?: string; email?: string }) => {
      const db = getDatabase();
      const downloader = new OpenAccessDownloader();
      const citation = db.getCitation(doi);

      let pdfUrl = options.url;

      if (!pdfUrl && options.email) {
        const unpaywall = new UnpaywallResolver(options.email);
        pdfUrl = (await unpaywall.getOpenAccessPdf(doi)) || undefined;
      }

      if (!pdfUrl) {
        render(<Text color="red">No PDF URL. Use --url or --email for Unpaywall lookup.</Text>);
        return;
      }

      render(<Text>Downloading PDF for {doi}...</Text>);
      const localPath = await downloader.download(doi, pdfUrl, citation?.bibtexKey || doi);

      if (!citation) {
        render(<Text color="yellow">Warning: DOI {doi} not found in database. PDF saved but citation not updated.</Text>);
      } else {
        db.updatePdfPath(doi, localPath);
        db.updateVerificationStatus(doi, 'downloaded');
      }

      render(<Text color="green">Saved to: {localPath}</Text>);
    });
}
