# @tempo/contracts

The HTTP request and response shapes the API serves, plus the fixed value lists they use (categories, cadences, directions). The API and the web app import them, so a renamed or dropped field fails type-checking in both in the same PR. The MCP package imports them too, for its input schemas and the category list it serves.

## Rules

- Describe the JSON on the wire: dates and amounts are `string`, absent values are `null`, no `Date`, entities or class instances.
- No dependencies. No Nest, class-validator, zod or browser APIs; the code must compile under both the API's and the web app's compiler settings.
- One file per API area, holding both its shapes and its value lists, re-exported from `src/index.ts`. Add a value list to the area that owns it, not to a shared file. Relative imports end in `.js` (the package is ESM).
- Keep changes additive across a deploy. The API and web roll out separately, so for a few minutes one side runs the old contract: add the new field or value, ship it, and remove the old one in a later PR. Type-checking catches drift inside a PR, not between running versions.
- UI copy such as labels and icons stays in the web app. API-internal types (entities, detection state) stay in the API.

## How each consumer loads it

- API: a `file:../../packages/contracts` dependency. `npm run contracts:build` compiles `dist/`; the API's build, start, seed/schema and E2E hooks run it first. Jest and ts-jest (`tsconfig.jest.json`) map the import to `src/`, so unit tests need no build. After editing the package, rerun `npm run contracts:build` (or restart `start:dev`) so a running API and the editor pick up the change.
- Web: an alias to `src/` in `vite.config.ts` and `tsconfig.app.json`; nothing to build.
- MCP (`apps/api/mcp`): a `file:../../../packages/contracts` dependency. Its `build` compiles the package before itself.
- Docker: both images build from the repository root and place this package two levels above the app directory, matching the checkout.

Formatting follows `.prettierrc` here and runs with the API's `format` and `format:check` scripts.
