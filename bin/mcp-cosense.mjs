#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startHttpServer,
  startStdioServer
} from '../src/server.mjs';

const VERSION = '0.1.0';

const usage = `Usage: mcp-cosense [--stdio | --http]
       mcp-cosense login [PROJECT_URL_OR_ORIGIN]

Commands:
  --stdio  Run an MCP server over stdio (default)
  --http   Run a Streamable HTTP MCP server
  login    Store Cosense credentials using the official Cosense CLI
  --help   Show this help
  --version
`;

const cliInvocation = () => {
  const configuredScript = process.env.COSENSE_CLI_SCRIPT;
  const configuredBinary = process.env.COSENSE_CLI_BINARY;
  const script =
    configuredScript ??
    (configuredBinary
      ? undefined
      : fileURLToPath(
          import.meta.resolve('@helpfeel/cosense-cli/bin/cosense')
        ));
  return {
    binary: configuredBinary ?? process.execPath,
    prefixArguments: script ? [script] : []
  };
};

const login = target =>
  new Promise((resolve, reject) => {
    if (/[^\S ]|\0/u.test(target)) {
      reject(new TypeError('login target contains invalid characters'));
      return;
    }
    const { binary, prefixArguments } = cliInvocation();
    const environment = {
      HOME: process.env.COSENSE_HOME ?? process.env.HOME ?? homedir(),
      LANG: process.env.LANG ?? 'C.UTF-8',
      LC_ALL: process.env.LC_ALL ?? 'C.UTF-8',
      PATH: process.env.PATH ?? dirname(process.execPath)
    };
    for (const name of [
      'COLORTERM',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_COLOR',
      'NO_PROXY',
      'NODE_EXTRA_CA_CERTS',
      'TERM',
      'TZ'
    ]) {
      if (process.env[name]) environment[name] = process.env[name];
    }
    const child = spawn(
      binary,
      [...prefixArguments, 'login', target],
      { env: environment, shell: false, stdio: 'inherit' }
    );
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Cosense login stopped by ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });

const main = async () => {
  const [command = '--stdio', ...rest] = process.argv.slice(2);
  if (command === '--help' || command === '-h') {
    process.stdout.write(usage);
    return;
  }
  if (command === '--version' || command === '-V') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === '--stdio') {
    if (rest.length > 0) throw new TypeError('--stdio accepts no arguments');
    await startStdioServer();
    return;
  }
  if (command === '--http') {
    if (rest.length > 0) throw new TypeError('--http accepts no arguments');
    startHttpServer();
    return;
  }
  if (command === 'login') {
    if (rest.length > 1) throw new TypeError('login accepts at most one target');
    process.exitCode = await login(rest[0] ?? 'https://scrapbox.io');
    return;
  }
  throw new TypeError(`unknown argument: ${command}`);
};

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
