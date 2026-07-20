import { Command } from 'commander';
import { getDatabase } from '../../db/index';
import { UnpaywallResolver } from '../../retrieval/resolvers/unpaywall';
import { OpenAccessDownloader } from '../../retrieval/downloaders/open-access';
import { green, print, printError, red, yellow } from '../output';

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
        const lookup = await unpaywall.getOpenAccessPdf(doi);
        if (!lookup.ok) {
          printError(red(`Unpaywall lookup failed: ${lookup.error}`));
          process.exitCode = 1;
          return;
        }
        pdfUrl = lookup.value || undefined;
      }

      if (!pdfUrl) {
        printError(red('No PDF URL. Use --url or --email for Unpaywall lookup.'));
        process.exitCode = 1;
        return;
      }

      print(`Downloading PDF for ${doi}...`);
      const localPath = await downloader.download(doi, pdfUrl, citation?.bibtexKey || doi);

      if (!citation) {
        print(
          yellow(`Warning: DOI ${doi} not found in database. PDF saved but citation not updated.`)
        );
      } else {
        db.updatePdfPath(doi, localPath);
        db.updateVerificationStatus(doi, 'downloaded');
      }

      print(green(`Saved to: ${localPath}`));
    });
}
