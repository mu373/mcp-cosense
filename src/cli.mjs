import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import {
  assertArgument,
  assertInputSize
} from './validation.mjs';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export class CosenseCliError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'CosenseCliError';
  }
}

class Semaphore {
  constructor(limit) {
    this.available = limit;
    this.waiters = [];
  }

  async acquire() {
    if (this.available > 0) {
      this.available -= 1;
    } else {
      await new Promise(resolve => this.waiters.push(resolve));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (waiter) waiter();
      else this.available += 1;
    };
  }
}

const positiveInteger = (value, name, minimum = 1) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TypeError(`${name} must be an integer of at least ${minimum}`);
  }
  return parsed;
};

const killProcessGroup = child => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
};

export class CosenseCli {
  constructor({
    binary = 'cosense',
    prefixArguments = [],
    home = homedir(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    concurrency = 4
  } = {}) {
    this.binary = binary;
    if (!Array.isArray(prefixArguments)) {
      throw new TypeError('prefixArguments must be an array');
    }
    for (const argument of prefixArguments) assertArgument(argument);
    this.prefixArguments = [...prefixArguments];
    this.home = home;
    this.timeoutMs = positiveInteger(timeoutMs, 'timeoutMs');
    this.maxOutputBytes = positiveInteger(
      maxOutputBytes,
      'maxOutputBytes',
      1024
    );
    this.semaphore = new Semaphore(
      positiveInteger(concurrency, 'concurrency')
    );
  }

  environment(source = process.env) {
    const environment = {
      HOME: this.home,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      NO_COLOR: '1',
      PATH: source.PATH ?? dirname(process.execPath)
    };
    if (source.TZ) environment.TZ = source.TZ;
    return environment;
  }

  validate(command, arguments_, inputText) {
    if (
      typeof command !== 'string' ||
      !command ||
      /[\r\n\0]/u.test(command)
    ) {
      throw new TypeError('invalid Cosense CLI command');
    }
    for (const argument of arguments_) assertArgument(argument);
    if (inputText !== undefined) {
      if (typeof inputText !== 'string') {
        throw new TypeError('Cosense CLI input must be a string');
      }
      assertInputSize(inputText, 'Cosense CLI input');
    }
  }

  async execute(command, arguments_, { inputText } = {}) {
    this.validate(command, arguments_, inputText);
    const release = await this.semaphore.acquire();
    try {
      return await this.run(command, arguments_, inputText);
    } finally {
      release();
    }
  }

  run(command, arguments_, inputText) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.binary,
        [...this.prefixArguments, command, ...arguments_],
        {
          detached: true,
          env: this.environment(),
          shell: false,
          stdio: [inputText === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
        }
      );
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let abortReason;
      let spawnError;

      const capture = (chunks, currentBytes, chunk) => {
        const remaining = this.maxOutputBytes - currentBytes;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        return currentBytes + chunk.length;
      };

      const abort = reason => {
        if (abortReason) return;
        abortReason = reason;
        try {
          killProcessGroup(child);
        } catch {
          child.kill('SIGKILL');
        }
      };

      child.stdout.on('data', chunk => {
        stdoutBytes = capture(stdout, stdoutBytes, chunk);
        if (stdoutBytes > this.maxOutputBytes) abort('output');
      });
      child.stderr.on('data', chunk => {
        stderrBytes = capture(stderr, stderrBytes, chunk);
        if (stderrBytes > this.maxOutputBytes) abort('output');
      });
      child.once('error', error => {
        spawnError = error;
      });

      const timer = setTimeout(() => abort('timeout'), this.timeoutMs);
      timer.unref();

      if (inputText !== undefined) {
        child.stdin.on('error', error => {
          if (error.code !== 'EPIPE' && error.code !== 'ECONNRESET') {
            spawnError ??= error;
          }
        });
        child.stdin.end(inputText, 'utf8');
      }

      child.once('close', code => {
        clearTimeout(timer);
        try {
          killProcessGroup(child);
        } catch {
          // The CLI process is already closed; a missing process group is harmless.
        }
        if (spawnError) {
          reject(
            new CosenseCliError(`could not start cosense ${command}`, {
              cause: spawnError
            })
          );
          return;
        }
        if (abortReason === 'timeout') {
          reject(
            new CosenseCliError(
              `cosense ${command} timed out after ${this.timeoutMs} milliseconds`
            )
          );
          return;
        }
        if (abortReason === 'output') {
          reject(
            new CosenseCliError(
              `cosense ${command} exceeded the ` +
                `${this.maxOutputBytes}-byte output limit`
            )
          );
          return;
        }
        const stdoutText = Buffer.concat(stdout).toString('utf8');
        const stderrText = Buffer.concat(stderr).toString('utf8');
        if (code !== 0) {
          const detail =
            stderrText.trim() || 'command failed without an error message';
          reject(
            new CosenseCliError(`cosense ${command} failed: ${detail}`)
          );
          return;
        }
        resolve({ stdout: stdoutText, stderr: stderrText });
      });
    });
  }
}
