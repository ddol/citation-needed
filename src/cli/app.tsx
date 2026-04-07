import React from 'react';
import { render, Box, Text } from 'ink';
import { Command } from 'commander';
import fs from 'fs';
import { getDatabase } from '../db/index';
import { parseBibtex } from '../bibtex/parser';
import { TrustScorer } from '../trust/scorer';
import { PdfDownloader } from '../retrieval/downloader';
import { startMcpServer } from '../server/mcp';

// ---- Components ----

interface CitationRow {
  doi: string;
  title?: string;
  year?: number;
  trustScore: number;
  trustLevel: string;
  verificationStatus: string;
}

function TrustBadge({ score }: { score: number }): React.ReactElement {
  const color = score >= 0.7 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return (
    <Text color={color}>{score.toFixed(2)}</Text>
  );
}

function CitationsTable({ rows }: { rows: CitationRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return <Text color="yellow">{'No citations found. Import some with: sober-sources import-bibtex <file>'}</Text>;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="cyan">{'DOI'.padEnd(30)}</Text>
        <Text bold color="cyan">{'Title'.padEnd(40)}</Text>
        <Text bold color="cyan">{'Year'.padEnd(6)}</Text>
        <Text bold color="cyan">{'Trust'.padEnd(8)}</Text>
        <Text bold color="cyan">{'Status'}</Text>
      </Box>
      {rows.map((row) => (
        <Box key={row.doi}>
          <Text>{(row.doi || '').slice(0, 29).padEnd(30)}</Text>
          <Text>{(row.title || '(no title)').slice(0, 39).padEnd(40)}</Text>
          <Text>{String(row.year || '').padEnd(6)}</Text>
          <Box width={8}>
            <TrustBadge score={row.trustScore} />
          </Box>
          <Text dimColor>{row.verificationStatus}</Text>
        </Box>
      ))}
    </Box>
  );
}

function ScoreDetails({
  doi,
  score,
  trustLevel,
  history,
}: {
  doi: string;
  score: number;
  trustLevel: string;
  history: Array<{ eventType: string; scoreDelta: number; notes?: string; createdAt?: string }>;
}): React.ReactElement {
  const color = score >= 0.7 ? 'green' : score >= 0.4 ? 'yellow' : 'red';
  return (
    <Box flexDirection="column">
      <Text bold>Trust Score for: <Text color="cyan">{doi}</Text></Text>
      <Text>Score: <Text color={color}>{score.toFixed(3)}</Text> — Level: <Text bold>{trustLevel}</Text></Text>
      {history.length > 0 && (
        <Box flexDirection="column">
          <Text bold>History:</Text>
          {history.map((e, i) => (
            <Text key={i} dimColor>
              [{e.createdAt?.slice(0, 10) ?? 'unknown'}] {e.eventType} Δ{e.scoreDelta >= 0 ? '+' : ''}{e.scoreDelta.toFixed(3)} — {e.notes || ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ---- CLI ----

export function runCli(argv: string[]): void {
  const program = new Command();
  program
    .name('sober-sources')
    .description('Trust and verification sidecar for AI agents')
    .version('0.1.0');

  program
    .command('import-bibtex <file>')
    .description('Import citations from a BibTeX file')
    .action((file: string) => {
      const db = getDatabase();
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = parseBibtex(content);
      let count = 0;
      for (const entry of parsed) {
        if (entry.doi || entry.title) {
          db.addCitation({ ...entry, doi: entry.doi || '' });
          count++;
        }
      }
      render(<Text color="green">Imported {count} citations from {file}</Text>);
    });

  program
    .command('list')
    .description('List all citations with trust scores')
    .action(() => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);
      const citations = db.getAllCitations();
      const rows: CitationRow[] = citations.map((c) => ({
        doi: c.doi,
        title: c.title,
        year: c.year,
        trustScore: c.trustScore ?? 0.5,
        trustLevel: scorer.getTrustLevel(c.trustScore ?? 0.5),
        verificationStatus: c.verificationStatus ?? 'unverified',
      }));
      render(<CitationsTable rows={rows} />);
    });

  program
    .command('download <doi>')
    .description('Download PDF for a citation by DOI')
    .option('--url <url>', 'Direct PDF URL')
    .option('--email <email>', 'Email for Unpaywall API')
    .action(async (doi: string, options: { url?: string; email?: string }) => {
      const db = getDatabase();
      const downloader = new PdfDownloader(db);

      let pdfUrl = options.url;

      if (!pdfUrl && options.email) {
        const { UnpaywallRetriever } = await import('../retrieval/unpaywall.js');
        const unpaywall = new UnpaywallRetriever(options.email);
        pdfUrl = (await unpaywall.getOpenAccessPdf(doi)) || undefined;
      }

      if (!pdfUrl) {
        render(<Text color="red">No PDF URL. Use --url or --email for Unpaywall lookup.</Text>);
        return;
      }

      render(<Text>Downloading PDF for {doi}...</Text>);
      const localPath = await downloader.downloadOpenAccess(doi, pdfUrl);
      render(<Text color="green">Saved to: {localPath}</Text>);
    });

  program
    .command('verify <doi> <claim>')
    .description('Verify a claim against a citation PDF')
    .action(async (doi: string, claim: string) => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);
      const result = await scorer.verifyAndScore(doi, claim);
      const color = result.verified ? 'green' : 'red';
      render(
        <Box flexDirection="column">
          <Text>Verified: <Text color={color}>{result.verified ? 'YES' : 'NO'}</Text></Text>
          <Text>Score: {result.score.toFixed(3)}</Text>
          <Text dimColor>{result.notes}</Text>
        </Box>
      );
    });

  program
    .command('server')
    .description('Start the MCP server')
    .action(async () => {
      await startMcpServer();
    });

  program
    .command('score <doi>')
    .description('Show trust score details for a citation')
    .action((doi: string) => {
      const db = getDatabase();
      const scorer = new TrustScorer(db);
      const citation = db.getCitation(doi);
      if (!citation) {
        render(<Text color="red">Citation not found: {doi}</Text>);
        return;
      }
      const score = citation.trustScore ?? 0.5;
      const trustLevel = scorer.getTrustLevel(score);
      const history = db.getTrustHistory(doi);
      render(
        <ScoreDetails doi={doi} score={score} trustLevel={trustLevel} history={history} />
      );
    });

  program.parse(argv);
}
