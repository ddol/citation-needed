import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDatabase, Database } from '../db/index';
import { loadAuthConfig } from '../auth/config';
import type { AuthConfig } from '../models/auth';
import { citationToolDefinitions, handleCitationTool } from './tools/citations';
import type { ToolContext } from './tools/citations';
import { retrievalToolDefinitions, handleRetrievalTool } from './tools/retrieval';
import { VERSION } from '../utils/version';

export function createMcpServer(db?: Database, authConfig?: AuthConfig): Server {
  const server = new Server(
    { name: 'citation-needed', version: VERSION },
    { capabilities: { tools: {} } }
  );

  const resolvedDb = db ?? getDatabase();
  const resolvedAuth = authConfig ?? loadAuthConfig();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...citationToolDefinitions, ...retrievalToolDefinitions],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    // Wire up MCP progress notifications when the client supplied a
    // progressToken in `_meta`. Tools use sendProgress to stream long-running
    // work like batch BibTeX imports.
    const meta = (request.params as { _meta?: { progressToken?: string | number } })._meta;
    const progressToken = meta?.progressToken;
    const toolContext: ToolContext = {
      progressToken,
      sendProgress:
        progressToken !== undefined && extra?.sendNotification
          ? async ({ progress, total, message }) => {
              await extra.sendNotification({
                method: 'notifications/progress',
                params: { progressToken, progress, total, message },
              });
            }
          : undefined,
    };

    try {
      const citationResult = await handleCitationTool(name, safeArgs, resolvedDb, toolContext);
      if (citationResult) return citationResult;

      const retrievalResult = await handleRetrievalTool(name, safeArgs, resolvedDb, resolvedAuth);
      if (retrievalResult) return retrievalResult;

      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
