import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDatabase, Database } from '../db/index';
import { loadAuthConfig } from '../auth/config';
import type { AuthConfig } from '../models/auth';
import { citationToolDefinitions, handleCitationTool } from './tools/citations';
import { retrievalToolDefinitions, handleRetrievalTool } from './tools/retrieval';
import { verificationToolDefinitions, handleVerificationTool } from './tools/verification';

export function createMcpServer(db?: Database, authConfig?: AuthConfig): Server {
  const server = new Server(
    { name: 'citation-needed', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  const resolvedDb = db ?? getDatabase();
  const resolvedAuth = authConfig ?? loadAuthConfig();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...citationToolDefinitions,
      ...retrievalToolDefinitions,
      ...verificationToolDefinitions,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args ?? {}) as Record<string, unknown>;

    try {
      const citationResult = await handleCitationTool(name, safeArgs, resolvedDb);
      if (citationResult) return citationResult;

      const retrievalResult = await handleRetrievalTool(name, safeArgs, resolvedDb, resolvedAuth);
      if (retrievalResult) return retrievalResult;

      const verificationResult = await handleVerificationTool(name, safeArgs, resolvedDb);
      if (verificationResult) return verificationResult;

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
