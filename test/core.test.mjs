import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CosenseCli } from '../src/cli.mjs';
import { CosenseService } from '../src/service.mjs';
import { ProjectAllowlist } from '../src/validation.mjs';

const PROJECT_URL = 'https://scrapbox.io/allowed-project';
const PAGE_URL = `${PROJECT_URL}/A_page`;

class FakeCli {
  calls = [];

  async execute(command, arguments_, { inputText } = {}) {
    this.calls.push([command, [...arguments_], inputText]);
    if (['readPage', 'searchFullText', 'searchVector'].includes(command)) {
      return {
        stdout: JSON.stringify({ command, pages: [] }),
        stderr: ''
      };
    }
    return { stdout: `${command} result\n`, stderr: '' };
  }
}

test('project allowlist normalizes origins and blocks other projects', () => {
  const allowlist = new ProjectAllowlist([
    'https://SCRAPBOX.io:443/Allowed-Project/'
  ]);

  allowlist.requireProjectUrl(PROJECT_URL);
  allowlist.requirePageUrl(`${PAGE_URL}#0123456789abcdef01234567`);
  assert.throws(
    () => allowlist.requirePageUrl('https://scrapbox.io/another/page'),
    /not in COSENSE_ALLOWED_PROJECTS/u
  );
  assert.throws(
    () => allowlist.requireProjectUrl(PAGE_URL),
    /wrong path shape/u
  );
});

test('empty allowlist disables Cosense access', () => {
  assert.throws(
    () => new ProjectAllowlist([]).requirePageUrl(PAGE_URL),
    /COSENSE_ALLOWED_PROJECTS is empty/u
  );
});

test('reads and searches with fixed CLI arguments', async () => {
  const cli = new FakeCli();
  const service = new CosenseService(cli, new ProjectAllowlist([PROJECT_URL]));

  const page = await service.browsePage(PAGE_URL);
  const search = await service.searchFullText(PROJECT_URL, '設計 design', {
    matchAny: true,
    sort: 'updated'
  });
  const vector = await service.searchVector(PROJECT_URL, '設計思想');

  assert.deepEqual(page, { content: 'browsePage result\n' });
  assert.equal(search.data.command, 'searchFullText');
  assert.equal(vector.data.command, 'searchVector');
  assert.deepEqual(cli.calls, [
    ['browsePage', [PAGE_URL], undefined],
    [
      'searchFullText',
      [PROJECT_URL, '設計 design', '--or', '--sort', 'updated'],
      undefined
    ],
    ['searchVector', [PROJECT_URL, '設計思想'], undefined]
  ]);
});

test('existing page edit serializes typed operations to stdin', async () => {
  const cli = new FakeCli();
  const service = new CosenseService(cli, new ProjectAllowlist([PROJECT_URL]));

  const result = await service.previewEdit(PROJECT_URL, 'page-id', [
    { kind: 'insert_before', line_id: '_end', text: '追記' },
    { kind: 'replace', line_id: 'line-1', text: '更新' },
    { kind: 'delete', line_id: 'line-2' }
  ]);

  assert.deepEqual(result, { content: 'previewEdit result\n' });
  const [command, arguments_, inputText] = cli.calls[0];
  assert.equal(command, 'previewEdit');
  assert.deepEqual(arguments_, [PROJECT_URL, 'page-id']);
  assert.deepEqual(JSON.parse(inputText), {
    ops: [
      { insertBefore: '_end', text: '追記' },
      { replace: 'line-1', text: '更新' },
      { delete: 'line-2' }
    ]
  });
});

test('replace rejects multiline text before calling the CLI', async () => {
  const cli = new FakeCli();
  const service = new CosenseService(cli, new ProjectAllowlist([PROJECT_URL]));

  await assert.rejects(
    service.previewEdit(PROJECT_URL, 'page-id', [
      { kind: 'replace', line_id: 'line-1', text: 'a\nb' }
    ]),
    /single line/u
  );
  assert.deepEqual(cli.calls, []);
});

test('new-page preview and submit remain separate calls', async () => {
  const cli = new FakeCli();
  const service = new CosenseService(cli, new ProjectAllowlist([PROJECT_URL]));

  await service.previewNewPage(PROJECT_URL, '新しいページ', ['本文', '']);
  await service.submitEdit(PROJECT_URL, 'preview-123');

  assert.deepEqual(cli.calls, [
    ['previewEdit', ['--new', PROJECT_URL], '新しいページ\n本文\n'],
    ['submitEdit', [PROJECT_URL, 'preview-123'], undefined]
  ]);
});

test('CLI child receives only the minimal environment', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosense-cli-test-'));
  const script = path.join(directory, 'inspect-environment.mjs');
  await writeFile(
    script,
    `console.log(JSON.stringify({
      args: process.argv.slice(2),
      home: process.env.HOME,
      unrelatedSecret: process.env.UNRELATED_SECRET,
      pat: process.env.COSENSE_PAT
    }));\n`
  );
  process.env.UNRELATED_SECRET = 'must-not-leak';
  process.env.COSENSE_PAT = 'must-not-leak-either';
  try {
    const cli = new CosenseCli({
      binary: process.execPath,
      prefixArguments: [script],
      home: path.join(directory, 'home')
    });
    const output = await cli.execute('readPage', [PAGE_URL]);
    assert.deepEqual(JSON.parse(output.stdout), {
      args: ['readPage', PAGE_URL],
      home: path.join(directory, 'home')
    });
  } finally {
    delete process.env.UNRELATED_SECRET;
    delete process.env.COSENSE_PAT;
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI enforces its output bound', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cosense-cli-test-'));
  const script = path.join(directory, 'large-output.mjs');
  await writeFile(script, `process.stdout.write('x'.repeat(2048));\n`);
  try {
    const cli = new CosenseCli({
      binary: process.execPath,
      maxOutputBytes: 1024
    });
    await assert.rejects(
      cli.execute(script, []),
      /exceeded the 1024-byte output limit/u
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
