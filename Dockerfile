ARG COSENSE_CLI_VERSION=1.14.1

FROM node:24-bookworm-slim AS build
ARG COSENSE_CLI_VERSION

WORKDIR /build
COPY package.json package-lock.json ./
RUN test "$(node -p "require('./package.json').dependencies['@helpfeel/cosense-cli']")" = "$COSENSE_CLI_VERSION" \
    && npm ci
COPY bin ./bin
COPY src ./src
RUN mkdir -p /out/cosense-cli/dist /out/home/cosense/.cosense /out/licenses \
    && ./node_modules/.bin/esbuild bin/mcp-cosense.mjs \
        --bundle \
        --platform=node \
        --format=esm \
        --target=node24 \
        --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
        --legal-comments=linked \
        --outfile=/out/mcp-cosense.mjs \
    && ./node_modules/.bin/esbuild node_modules/@helpfeel/cosense-cli/src/cli.ts \
        --bundle \
        --platform=node \
        --format=esm \
        --target=node24 \
        --legal-comments=linked \
        --outfile=/out/cosense-cli/dist/cli.mjs \
    && cp node_modules/@helpfeel/cosense-cli/package.json /out/cosense-cli/package.json \
    && find node_modules -maxdepth 4 -type f \
        \( -iname 'license' -o -iname 'license.*' -o -iname 'copying' -o -iname 'notice' \) \
        -exec cp --parents '{}' /out/licenses/ \; \
    && test "$(node /out/cosense-cli/dist/cli.mjs --version)" = "cosense v${COSENSE_CLI_VERSION}" \
    && node --check /out/mcp-cosense.mjs

FROM gcr.io/distroless/nodejs24-debian13:nonroot

COPY --from=build --chown=10002:10002 /out/mcp-cosense.mjs* /app/
COPY --from=build --chown=10002:10002 /out/cosense-cli /app/cosense-cli
COPY --from=build /out/licenses /licenses/cosense
COPY --from=build --chown=10002:10002 /out/home /home

ENV HOME=/home/cosense \
    COSENSE_HOME=/home/cosense \
    COSENSE_CLI_SCRIPT=/app/cosense-cli/dist/cli.mjs \
    COSENSE_MCP_HOST=0.0.0.0 \
    NODE_ENV=production \
    PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin

USER 10002:10002
EXPOSE 8798
ENTRYPOINT ["/nodejs/bin/node", "/app/mcp-cosense.mjs"]
CMD ["--http"]
