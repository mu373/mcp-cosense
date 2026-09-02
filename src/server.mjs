import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

import {
  CosenseCli,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS
} from './cli.mjs';
import { CosenseService } from './service.mjs';
import {
  MAX_ARGUMENT_BYTES,
  MAX_INPUT_BYTES,
  MAX_OPERATIONS,
  ProjectAllowlist
} from './validation.mjs';

export const TOOL_NAMES = [
  'browse_page',
  'browse_related_pages',
  'read_page',
  'search_full_text',
  'search_vector',
  'preview_edit',
  'preview_new_page',
  'submit_edit'
];

const url = z.string().min(1).max(MAX_ARGUMENT_BYTES);
const textArgument = z.string().min(1).max(MAX_ARGUMENT_BYTES);
const lineId = z.string().min(1).max(128);
const editOperation = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('insert_before'),
      line_id: lineId,
      text: z.string().max(MAX_INPUT_BYTES)
    })
    .strict(),
  z
    .object({
      kind: z.literal('replace'),
      line_id: lineId,
      text: z.string().max(MAX_INPUT_BYTES)
    })
    .strict(),
  z
    .object({
      kind: z.literal('delete'),
      line_id: lineId
    })
    .strict()
]);
const textOutput = {
  content: z.string(),
  warnings: z.string().optional()
};
const jsonOutput = {
  data: z.unknown(),
  warnings: z.string().optional()
};

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};
const previewAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true
};

const toolResult = output => ({
  content: [{ type: 'text', text: JSON.stringify(output) }],
  structuredContent: output
});

export const createCosenseMcpServer = service => {
  const server = new McpServer(
    {
      name: 'mcp-cosense',
      version: '0.1.0'
    },
    {
      instructions:
        'Read and search only operator-allowed Cosense projects through the ' +
        'official Helpfeel CLI. Editing is a two-step preview/submit flow. ' +
        'Never preview an edit unless the user explicitly requested a write. ' +
        'Read the current page before editing and inspect the complete preview ' +
        'before submitting it. A preview expires after five minutes and can be ' +
        'submitted only once.'
    }
  );

  server.registerTool(
    'browse_page',
    {
      description:
        'Read one Cosense page in an agent-friendly format with metadata and links.',
      inputSchema: { page_url: url },
      outputSchema: textOutput,
      annotations: readOnlyAnnotations
    },
    async ({ page_url: pageUrl }) => toolResult(await service.browsePage(pageUrl))
  );

  server.registerTool(
    'browse_related_pages',
    {
      description: 'List one-hop and two-hop pages related to a Cosense page.',
      inputSchema: { page_url: url },
      outputSchema: textOutput,
      annotations: readOnlyAnnotations
    },
    async ({ page_url: pageUrl }) =>
      toolResult(await service.browseRelatedPages(pageUrl))
  );

  server.registerTool(
    'read_page',
    {
      description:
        'Read structured page JSON, including page ID and line IDs used for edits.',
      inputSchema: { page_url: url },
      outputSchema: jsonOutput,
      annotations: readOnlyAnnotations
    },
    async ({ page_url: pageUrl }) => toolResult(await service.readPage(pageUrl))
  );

  server.registerTool(
    'search_full_text',
    {
      description: 'Search complete Cosense page text with AND or OR matching.',
      inputSchema: {
        project_url: url,
        query: textArgument,
        match_any: z.boolean().default(false),
        sort: z.enum(['pageRank', 'updated']).default('pageRank')
      },
      outputSchema: jsonOutput,
      annotations: readOnlyAnnotations
    },
    async ({ project_url: projectUrl, query, match_any: matchAny, sort }) =>
      toolResult(
        await service.searchFullText(projectUrl, query, { matchAny, sort })
      )
  );

  server.registerTool(
    'search_vector',
    {
      description: 'Semantically search Cosense titles and link notation.',
      inputSchema: { project_url: url, query: textArgument },
      outputSchema: jsonOutput,
      annotations: readOnlyAnnotations
    },
    async ({ project_url: projectUrl, query }) =>
      toolResult(await service.searchVector(projectUrl, query))
  );

  server.registerTool(
    'preview_edit',
    {
      description:
        'Preview an explicitly requested edit without changing the page. ' +
        'First call read_page and use its top-level page ID and lines[].id values. ' +
        'Inspect the returned complete post-edit page before calling submit_edit.',
      inputSchema: {
        project_url: url,
        page_id: textArgument,
        operations: z.array(editOperation).min(1).max(MAX_OPERATIONS)
      },
      outputSchema: textOutput,
      annotations: previewAnnotations
    },
    async ({ project_url: projectUrl, page_id: pageId, operations }) =>
      toolResult(await service.previewEdit(projectUrl, pageId, operations))
  );

  server.registerTool(
    'preview_new_page',
    {
      description:
        'Preview creation of a new page without changing Cosense. Use this only ' +
        'for an explicitly requested write. The title and each item in lines ' +
        'represent one Cosense line. Inspect the preview before submitting it.',
      inputSchema: {
        project_url: url,
        title: textArgument,
        lines: z.array(z.string().max(MAX_INPUT_BYTES))
      },
      outputSchema: textOutput,
      annotations: previewAnnotations
    },
    async ({ project_url: projectUrl, title, lines }) =>
      toolResult(await service.previewNewPage(projectUrl, title, lines))
  );

  server.registerTool(
    'submit_edit',
    {
      description:
        'Commit one inspected Cosense edit preview. This mutates Cosense. Call it ' +
        'only for the same explicit user write request that produced the preview. ' +
        'Never retry an ambiguous result before read_page confirms whether the ' +
        'intended change already landed.',
      inputSchema: {
        project_url: url,
        preview_id: z.string().min(1).max(256)
      },
      outputSchema: textOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async ({ project_url: projectUrl, preview_id: previewId }) =>
      toolResult(await service.submitEdit(projectUrl, previewId))
  );

  return server;
};

const environmentInteger = (name, fallback, { multiplier = 1 } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return parsed * multiplier;
};

export const configuredService = () => {
  const configuredCliScript = process.env.COSENSE_CLI_SCRIPT;
  const configuredCliBinary = process.env.COSENSE_CLI_BINARY;
  const cliScript =
    configuredCliScript ??
    (configuredCliBinary
      ? undefined
      : fileURLToPath(
          import.meta.resolve('@helpfeel/cosense-cli/bin/cosense')
        ));
  return new CosenseService(
    new CosenseCli({
      binary: configuredCliBinary ?? process.execPath,
      prefixArguments: cliScript ? [cliScript] : [],
      home: process.env.COSENSE_HOME ?? process.env.HOME ?? homedir(),
      timeoutMs: environmentInteger(
        'COSENSE_CLI_TIMEOUT_SECONDS',
        DEFAULT_TIMEOUT_MS,
        { multiplier: 1000 }
      ),
      maxOutputBytes: environmentInteger(
        'COSENSE_CLI_MAX_OUTPUT_BYTES',
        DEFAULT_MAX_OUTPUT_BYTES
      ),
      concurrency: environmentInteger('COSENSE_CLI_CONCURRENCY', 4)
    }),
    ProjectAllowlist.fromEnvironment()
  );
};

const allowedHostsFromEnvironment = () => {
  const configured =
    process.env.COSENSE_MCP_ALLOWED_HOSTS ??
    'cosense-mcp,localhost,127.0.0.1';
  return configured
    .split(',')
    .map(host => host.trim())
    .filter(Boolean);
};

export const createHttpApp = (
  service = configuredService(),
  { host = '0.0.0.0', allowedHosts = allowedHostsFromEnvironment() } = {}
) => {
  const app = createMcpExpressApp({ host, allowedHosts });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });

  app.post('/mcp', async (request, response) => {
    const server = createCosenseMcpServer(service);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error('Cosense MCP request failed', error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  });

  const methodNotAllowed = (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null
    });
  };
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
  return app;
};

export const startStdioServer = async (service = configuredService()) => {
  const server = createCosenseMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
};

export const startHttpServer = () => {
  const port = environmentInteger('COSENSE_MCP_PORT', 8798);
  const host = process.env.COSENSE_MCP_HOST ?? '127.0.0.1';
  const app = createHttpApp(undefined, { host });
  const listener = app.listen(port, host, () => {
    console.error(`mcp-cosense listening on ${host}:${port}`);
  });
  const shutdown = signal => {
    console.error(`Received ${signal}; stopping mcp-cosense`);
    listener.close(error => {
      if (error) {
        console.error('Cosense MCP shutdown failed', error);
        process.exitCode = 1;
      }
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return listener;
};
