import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execute = promisify(execFile);
const binary = fileURLToPath(
  new URL('../bin/mcp-cosense.mjs', import.meta.url)
);

test('CLI reports its version without starting a server', async () => {
  const result = await execute(process.execPath, [binary, '--version']);
  assert.equal(result.stdout, '0.1.0\n');
  assert.equal(result.stderr, '');
});

test('CLI documents stdio, HTTP, and login modes', async () => {
  const result = await execute(process.execPath, [binary, '--help']);
  assert.match(result.stdout, /--stdio/u);
  assert.match(result.stdout, /--http/u);
  assert.match(result.stdout, /login/u);
  assert.equal(result.stderr, '');
});

test('default CLI mode serves MCP over stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binary],
    env: {
      COSENSE_ALLOWED_PROJECTS: 'https://scrapbox.io/allowed-project'
    },
    stderr: 'pipe'
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 8);
    assert.ok(tools.tools.some(tool => tool.name === 'submit_edit'));
  } finally {
    await client.close();
  }
});
