export const MAX_INPUT_BYTES = 1024 * 1024;
export const MAX_OPERATIONS = 256;
export const MAX_ARGUMENT_BYTES = 32 * 1024;

const utf8Bytes = value => Buffer.byteLength(value, 'utf8');

const normalizedUrl = value => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`invalid Cosense URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Cosense URLs must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('Cosense URLs must not contain user information');
  }
  return parsed;
};

export const projectReference = (value, { page = false } = {}) => {
  const parsed = normalizedUrl(value);
  if (parsed.search) {
    throw new TypeError('Cosense URLs must not contain a query string');
  }
  if (!page && parsed.hash) {
    throw new TypeError('Cosense project URLs must not contain a fragment');
  }
  const rawParts = parsed.pathname.split('/').filter(Boolean);
  if ((page && rawParts.length < 2) || (!page && rawParts.length !== 1)) {
    const expected = page ? 'page' : 'project';
    throw new TypeError(
      `Cosense ${expected} URL has the wrong path shape: ${value}`
    );
  }
  let projectName;
  try {
    projectName = decodeURIComponent(rawParts[0]);
  } catch {
    throw new TypeError('Cosense project name has invalid URL encoding');
  }
  if (!projectName || projectName.includes('/') || projectName.includes('\0')) {
    throw new TypeError('Cosense project name is invalid');
  }
  return {
    origin: parsed.origin,
    projectName,
    key: `${parsed.origin}\0${projectName.toLocaleLowerCase('und')}`
  };
};

export class ProjectAllowlist {
  constructor(projectUrls) {
    this.projects = new Set(
      projectUrls
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => projectReference(value).key)
    );
  }

  static fromEnvironment(environment = process.env) {
    return new ProjectAllowlist(
      (environment.COSENSE_ALLOWED_PROJECTS ?? '').split(',')
    );
  }

  requireProjectUrl(value) {
    this.require(projectReference(value));
  }

  requirePageUrl(value) {
    this.require(projectReference(value, { page: true }));
  }

  require(project) {
    if (this.projects.size === 0) {
      throw new TypeError(
        'Cosense access is disabled because COSENSE_ALLOWED_PROJECTS is empty'
      );
    }
    if (!this.projects.has(project.key)) {
      throw new TypeError(
        `Cosense project is not in COSENSE_ALLOWED_PROJECTS: ` +
          `${project.origin}/${project.projectName}`
      );
    }
  }
}

export const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must not be empty`);
  }
  if (value.includes('\0')) {
    throw new TypeError(`${field} contains an invalid NUL character`);
  }
  return value;
};

const validLineId = (value, field = 'line_id') => {
  requiredText(value, field);
  if (value.length > 128) {
    throw new TypeError(`${field} must be at most 128 characters`);
  }
};

export const validateEditOperations = operations => {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TypeError('operations must not be empty');
  }
  if (operations.length > MAX_OPERATIONS) {
    throw new TypeError(`at most ${MAX_OPERATIONS} edit operations are allowed`);
  }
  return operations.map(operation => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new TypeError('each edit operation must be an object');
    }
    const keys = Object.keys(operation);
    if (operation.kind === 'insert_before') {
      if (keys.some(key => !['kind', 'line_id', 'text'].includes(key))) {
        throw new TypeError('insert_before operation has an unexpected field');
      }
      validLineId(operation.line_id);
      if (typeof operation.text !== 'string') {
        throw new TypeError('insert_before text must be a string');
      }
      return { insertBefore: operation.line_id, text: operation.text };
    }
    if (operation.kind === 'replace') {
      if (keys.some(key => !['kind', 'line_id', 'text'].includes(key))) {
        throw new TypeError('replace operation has an unexpected field');
      }
      validLineId(operation.line_id);
      if (typeof operation.text !== 'string') {
        throw new TypeError('replace text must be a string');
      }
      if (operation.text.includes('\n') || operation.text.includes('\r')) {
        throw new TypeError('replace text must be a single line');
      }
      return { replace: operation.line_id, text: operation.text };
    }
    if (operation.kind === 'delete') {
      if (keys.some(key => !['kind', 'line_id'].includes(key))) {
        throw new TypeError('delete operation has an unexpected field');
      }
      validLineId(operation.line_id);
      return { delete: operation.line_id };
    }
    throw new TypeError(`unknown edit operation kind: ${operation.kind}`);
  });
};

export const assertInputSize = (value, description) => {
  if (utf8Bytes(value) > MAX_INPUT_BYTES) {
    throw new TypeError(
      `${description} must be at most ${MAX_INPUT_BYTES} UTF-8 bytes`
    );
  }
};

export const assertArgument = value => {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    utf8Bytes(value) > MAX_ARGUMENT_BYTES
  ) {
    throw new TypeError('invalid or oversized Cosense CLI argument');
  }
};
