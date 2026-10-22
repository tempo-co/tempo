FROM node:22-alpine AS builder
WORKDIR /usr/src/app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/
COPY mcp/src/ ./mcp/src/
COPY mcp/scripts/generate-categories.mjs ./mcp/scripts/
COPY ops/claude-bridge/contract.json ops/claude-bridge/merchant-contract.json ./ops/claude-bridge/
COPY scripts/ ./scripts/
COPY nest-cli.json ./
RUN npm run build

FROM node:22-alpine AS runtime-dependencies

RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY package*.json ./
RUN node -e 'require("node:fs").writeFileSync("/tmp/dev-dependencies.json", JSON.stringify(Object.keys(require("./package.json").devDependencies)))' \
    && npm pkg delete devDependencies \
    && npm install --package-lock-only --ignore-scripts \
    && npm ci --omit=dev --omit=peer

COPY --from=builder --chown=node:node /usr/src/app/dist ./dist

FROM node:22-alpine AS runtime

# Without NODE_ENV the config falls back to development, which this image has no env file for.
ENV NODE_ENV=production

RUN apk add --no-cache curl libstdc++

WORKDIR /usr/src/app

COPY --from=runtime-dependencies --chown=node:node /usr/src/app/ ./
COPY --from=runtime-dependencies /tmp/dev-dependencies.json /tmp/dev-dependencies.json
COPY ops/runtime-image-smoke.js /tmp/runtime-image-smoke.js
RUN node /tmp/runtime-image-smoke.js \
    && rm /tmp/dev-dependencies.json /tmp/runtime-image-smoke.js

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f "http://localhost:3000/health" || exit 1

CMD ["node", "dist/src/main.js"]
