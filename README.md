# mcp-cosense

An MCP server for reading, searching, and safely editing
[Cosense](https://scrapbox.io/) projects through Helpfeel's official
[`@helpfeel/cosense-cli`](https://github.com/helpfeel/cosense-cli).

The server exposes a fixed set of MCP tools instead of a general shell. Project access
is restricted by an exact URL allowlist, and writes use the official CLI's two-step,
five-minute preview and submit flow.

## Requirements

- Node.js 24 or later, or Docker
- A Cosense Personal Access Token or project Service Account

## Authenticate

Credentials are stored by the official Cosense CLI under `~/.cosense`. Pass the
Cosense origin to store a Personal Access Token, or an exact project URL to store a
Service Account for that project.

```bash
npx mcp-cosense login https://scrapbox.io
```

The token is entered interactively and is not passed through MCP.

## Local MCP over stdio

Set `COSENSE_ALLOWED_PROJECTS` to the exact project URLs the server may access. Separate
multiple projects with commas. An empty allowlist disables all Cosense operations.

```json
{
  "mcpServers": {
    "cosense": {
      "command": "npx",
      "args": ["-y", "mcp-cosense"],
      "env": {
        "COSENSE_ALLOWED_PROJECTS": "https://scrapbox.io/example-project"
      }
    }
  }
}
```

Running `mcp-cosense` without arguments uses stdio. `--stdio` selects it explicitly.

## Docker and Streamable HTTP

Copy `.env.example` to `.env`, configure the allowlist, authenticate into the dedicated
volume, and start the server:

```bash
cp .env.example .env
docker compose --profile setup run --rm login
docker compose up -d --build server
```

The endpoint is `http://127.0.0.1:8798/mcp` by default. The published port binds only
to loopback unless `COSENSE_BIND_ADDRESS` is changed.

The image also runs directly:

```bash
docker build -t mcp-cosense .
docker run --rm --read-only -p 127.0.0.1:8798:8798 \
  -e COSENSE_ALLOWED_PROJECTS=https://scrapbox.io/example-project \
  -v mcp-cosense-credentials:/home/cosense/.cosense:ro \
  mcp-cosense
```

## Tools

- `browse_page`
- `browse_related_pages`
- `read_page`
- `search_full_text`
- `search_vector`
- `preview_edit`
- `preview_new_page`
- `submit_edit`

`preview_edit` and `preview_new_page` do not change Cosense. Only `submit_edit` mutates
a page. A preview expires after five minutes and can be submitted only once.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `COSENSE_ALLOWED_PROJECTS` | empty | Comma-separated exact project URLs; empty disables access |
| `COSENSE_HOME` | current home | Home containing `.cosense` credentials |
| `COSENSE_CLI_TIMEOUT_SECONDS` | `120` | Per-command timeout |
| `COSENSE_CLI_MAX_OUTPUT_BYTES` | `4194304` | Per-stream output limit |
| `COSENSE_CLI_CONCURRENCY` | `4` | Maximum concurrent CLI processes |
| `COSENSE_MCP_HOST` | `127.0.0.1` | HTTP listen address; Docker sets `0.0.0.0` |
| `COSENSE_MCP_PORT` | `8798` | HTTP listen port |
| `COSENSE_MCP_ALLOWED_HOSTS` | localhost values | Accepted HTTP Host headers |

## Security

- The Cosense CLI child process receives a minimal environment and no unrelated
  application secrets.
- The Docker image is distroless, unprivileged, and contains neither npm nor a shell.
- The Compose service uses a read-only root filesystem, drops all Linux capabilities,
  and mounts credentials read-only outside the interactive login job.
- Input size, output size, execution time, process count, and concurrency are bounded.
- Project URLs are checked against the operator-configured allowlist before the CLI is
  invoked.

## Development

```bash
npm ci
npm test
```
