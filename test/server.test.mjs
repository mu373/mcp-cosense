import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createCosenseMcpServer, TOOL_NAMES } from '../src/server.mjs';

class FakeService {
  calls = [];

  async browsePage(pageUrl) {
    this.calls.push(['browsePage', pageUrl]);
    return { content: 'page' };
  }

  async browseRelatedPages(pageUrl) {
    this.calls.push(['browseRelatedPages', pageUrl]);
    return { content: 'related' };
  }

  async readPage(pageUrl) {
    this.calls.push(['readPage', pageUrl]);
    return { data: { id: 'page-id', lines: [] } };
  }

  async searchFullText(projectUrl, query, options) {
    this.calls.push(['searchFullText', projectUrl, query, options]);
    return { data: { pages: [] } };
  }

  async searchVector(projectUrl, query) {
    this.calls.push(['searchVector', projectUrl, query]);
    return { data: { pages: [] } };
  }

  async previewEdit(projectUrl, pageId, operations) {
    this.calls.push(['previewEdit', projectUrl, pageId, operations]);
    return { content: 'preview-id' };
  }

  async previewNewPage(projectUrl, title, lines) {
    this.calls.push(['previewNewPage', projectUrl, title, lines]);
    return { content: 'new-page-preview-id' };
  }

  async submitEdit(projectUrl, previewId) {
    this.calls.push(['submitEdit', projectUrl, previewId]);
    return { content: 'commit-id' };
  }
}

const connectedPair = async service => {
  const server = createCosenseMcpServer(service);
  const client = new Client({ name: 'cosense-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return { client, server };
};

test('MCP server exposes exactly the intended tools', async () => {
  const service = new FakeService();
  const { client, server } = await connectedPair(service);
  try {
    const result = await client.listTools();
    assert.deepEqual(
      result.tools.map(tool => tool.name),
      TOOL_NAMES
    );
    assert.equal(
      result.tools.find(tool => tool.name === 'submit_edit').annotations
        .destructiveHint,
      true
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test('typed edit call crosses the MCP boundary with structured output', async () => {
  const service = new FakeService();
  const { client, server } = await connectedPair(service);
  try {
    const result = await client.callTool({
      name: 'preview_edit',
      arguments: {
        project_url: 'https://scrapbox.io/allowed-project',
        page_id: 'page-id',
        operations: [
          { kind: 'insert_before', line_id: '_end', text: '追記' }
        ]
      }
    });
    assert.deepEqual(result.structuredContent, { content: 'preview-id' });
    assert.deepEqual(service.calls, [
      [
        'previewEdit',
        'https://scrapbox.io/allowed-project',
        'page-id',
        [{ kind: 'insert_before', line_id: '_end', text: '追記' }]
      ]
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP input schema rejects malformed edit operations', async () => {
  const service = new FakeService();
  const { client, server } = await connectedPair(service);
  try {
    const result = await client.callTool({
      name: 'preview_edit',
      arguments: {
        project_url: 'https://scrapbox.io/allowed-project',
        page_id: 'page-id',
        operations: [{ kind: 'delete', line_id: 'line-1', text: 'unexpected' }]
      }
    });
    assert.equal(result.isError, true);
    assert.deepEqual(service.calls, []);
  } finally {
    await client.close();
    await server.close();
  }
});
