/**
 * Example MCP client usage for citation-needed.
 *
 * Start the server first: citation-needed server
 * Then run: node examples/mcp-client.js
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { spawn } = require('child_process');

async function main() {
  // Spawn the citation-needed MCP server
  const serverProcess = spawn('node', ['dist/index.js', 'server'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const transport = new StdioClientTransport({
    readable: serverProcess.stdout,
    writable: serverProcess.stdin,
  });

  const client = new Client(
    { name: 'example-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // List available tools
  const { tools } = await client.listTools();
  console.log('Available tools:', tools.map((t) => t.name).join(', '));

  // Import a citation
  const importResult = await client.callTool({
    name: 'import-bibtex',
    arguments: {
      bibtex: `@article{test2024,
        title = {Test Paper},
        doi = {10.1234/test.001},
        author = {Test Author},
        year = {2024},
        journal = {Test Journal}
      }`,
    },
  });
  console.log('Import result:', importResult.content[0].text);

  // Get the citation back
  const getResult = await client.callTool({
    name: 'get-citation',
    arguments: { doi: '10.1234/test.001' },
  });
  console.log('Citation:', getResult.content[0].text);

  // List all citations
  const listResult = await client.callTool({
    name: 'list-citations',
    arguments: {},
  });
  const citations = JSON.parse(listResult.content[0].text);
  console.log(`Total citations: ${citations.length}`);

  serverProcess.kill();
}

main().catch(console.error);
