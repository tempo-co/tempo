# Built from the repository root. `@tempo/contracts` is a `file:../../packages/contracts` dependency, so it sits two
# levels above the app directory here too.
FROM node:26-alpine AS builder
WORKDIR /usr/src/app

RUN apk add --no-cache python3 make g++

COPY packages/contracts/package.json packages/contracts/tsconfig.json /usr/packages/contracts/
COPY packages/contracts/src/ /usr/packages/contracts/src/
COPY apps/api/package*.json ./
RUN npm ci

COPY apps/api/tsconfig*.json ./
COPY apps/api/src/ ./src/
COPY apps/api/mcp/src/ ./mcp/src/
COPY apps/api/claude-bridge/contract.json apps/api/claude-bridge/merchant-contract.json ./claude-bridge/
COPY apps/api/scripts/ ./scripts/
COPY apps/api/nest-cli.json ./
RUN npm run build

FROM node:26-alpine AS runtime-dependencies

RUN apk add --no-cache python3 make g++

WORKDIR /usr/src/app

COPY --from=builder /usr/packages/contracts/package.json /usr/packages/contracts/
COPY --from=builder /usr/packages/contracts/dist/ /usr/packages/contracts/dist/
COPY apps/api/package*.json ./
RUN node -e 'require("node:fs").writeFileSync("/tmp/dev-dependencies.json", JSON.stringify(Object.keys(require("./package.json").devDependencies)))' \
    && npm pkg delete devDependencies \
    && npm install --package-lock-only --ignore-scripts \
    && npm ci --omit=dev --omit=peer

COPY --from=builder --chown=node:node /usr/src/app/dist ./dist

FROM node:26-alpine AS runtime

# Without NODE_ENV the config falls back to development, which this image has no env file for.
ENV NODE_ENV=production

RUN apk add --no-cache curl libstdc++

WORKDIR /usr/src/app

COPY --from=runtime-dependencies --chown=node:node /usr/src/app/ ./
COPY --from=runtime-dependencies --chown=node:node /usr/packages/ /usr/packages/
COPY --from=runtime-dependencies /tmp/dev-dependencies.json /tmp/dev-dependencies.json
COPY apps/api/scripts/runtime-image-smoke.js /tmp/runtime-image-smoke.js
RUN node /tmp/runtime-image-smoke.js \
    && rm /tmp/dev-dependencies.json /tmp/runtime-image-smoke.js

USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f "http://localhost:3000/health" || exit 1

CMD ["node", "dist/src/main.js"]
