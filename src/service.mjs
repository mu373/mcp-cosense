import {
  assertInputSize,
  ProjectAllowlist,
  requiredText,
  validateEditOperations
} from './validation.mjs';

const textResult = output => {
  const result = { content: output.stdout };
  if (output.stderr.trim()) result.warnings = output.stderr.trim();
  return result;
};

const jsonResult = output => {
  let data;
  try {
    data = JSON.parse(output.stdout);
  } catch (error) {
    throw new Error(
      'cosense CLI returned invalid JSON; check the pinned CLI version',
      { cause: error }
    );
  }
  const result = { data };
  if (output.stderr.trim()) result.warnings = output.stderr.trim();
  return result;
};

export class CosenseService {
  constructor(cli, allowlist = new ProjectAllowlist([])) {
    this.cli = cli;
    this.allowlist = allowlist;
  }

  async browsePage(pageUrl) {
    this.allowlist.requirePageUrl(pageUrl);
    return textResult(await this.cli.execute('browsePage', [pageUrl]));
  }

  async browseRelatedPages(pageUrl) {
    this.allowlist.requirePageUrl(pageUrl);
    return textResult(await this.cli.execute('browseRelatedPages', [pageUrl]));
  }

  async readPage(pageUrl) {
    this.allowlist.requirePageUrl(pageUrl);
    return jsonResult(await this.cli.execute('readPage', [pageUrl]));
  }

  async searchFullText(
    projectUrl,
    query,
    { matchAny = false, sort = 'pageRank' } = {}
  ) {
    this.allowlist.requireProjectUrl(projectUrl);
    requiredText(query, 'query');
    if (!['pageRank', 'updated'].includes(sort)) {
      throw new TypeError('sort must be pageRank or updated');
    }
    const arguments_ = [projectUrl, query];
    if (matchAny) arguments_.push('--or');
    arguments_.push('--sort', sort);
    return jsonResult(
      await this.cli.execute('searchFullText', arguments_)
    );
  }

  async searchVector(projectUrl, query) {
    this.allowlist.requireProjectUrl(projectUrl);
    requiredText(query, 'query');
    return jsonResult(
      await this.cli.execute('searchVector', [projectUrl, query])
    );
  }

  async previewEdit(projectUrl, pageId, operations) {
    this.allowlist.requireProjectUrl(projectUrl);
    requiredText(pageId, 'page_id');
    const payload = JSON.stringify({ ops: validateEditOperations(operations) });
    assertInputSize(payload, 'Cosense CLI input');
    return textResult(
      await this.cli.execute('previewEdit', [projectUrl, pageId], {
        inputText: payload
      })
    );
  }

  async previewNewPage(projectUrl, title, lines) {
    this.allowlist.requireProjectUrl(projectUrl);
    requiredText(title, 'title');
    if (title.includes('\r') || title.includes('\n')) {
      throw new TypeError('title must be a single line');
    }
    if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
    for (const line of lines) {
      if (
        typeof line !== 'string' ||
        line.includes('\r') ||
        line.includes('\n') ||
        line.includes('\0')
      ) {
        throw new TypeError('each page line must be a single valid line');
      }
    }
    const body = [title, ...lines].join('\n');
    assertInputSize(body, 'new page body');
    return textResult(
      await this.cli.execute('previewEdit', ['--new', projectUrl], {
        inputText: body
      })
    );
  }

  async submitEdit(projectUrl, previewId) {
    this.allowlist.requireProjectUrl(projectUrl);
    requiredText(previewId, 'preview_id');
    if (previewId.length > 256 || /\s/u.test(previewId)) {
      throw new TypeError('preview_id is invalid');
    }
    return textResult(
      await this.cli.execute('submitEdit', [projectUrl, previewId])
    );
  }
}
