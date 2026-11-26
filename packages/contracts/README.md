# @tempo/contracts

The HTTP request and response shapes the API serves, plus the fixed value lists they use (categories, cadences, directions). The API and the web app import them, so a renamed or dropped field fails type-checking in both in the same PR. The API's MCP tools use them too, for their input schemas and the category list they serve.

## Rules

- Describe the JSON on the wire: dates and amounts are `string`, absent values are `null`, no `Date`, entities or class instances.
- No dependencies. No Nest, class-validator, zod or browser APIs; the code must compile under both the API's and the web app's compiler settings.
- One file per API area, holding both its shapes and its value lists, re-exported from `src/index.ts`. Add a value list to the area that owns it, not to a shared file. Relative imports end in `.js` (the package is ESM).
- A contract change sets both apps' CI flags, so one run tests and releases both images and the deployer rolls them out in one pass; a contract change can therefore be breaking in a single PR. When a response shape changes in a way old data can't satisfy, bump the offline cache `buster` in `apps/web/src/utils/offline-storage.ts`, or the web app may read old-shaped saved responses after the update. Already-open tabs keep the old web code until they reload.
- `src/ecb-currencies.ts` is generated from the ECB by `.github/scripts/ecb-currencies.mjs` (see `docs/ci-and-images.md`); run the script instead of editing it. The currency lists derive from it: `REPORTING_CURRENCIES` holds the ones still published, `BANK_IMPORT_CURRENCIES` every one with rates.
- UI copy such as labels and icons stays in the web app. API-internal types (entities, detection state) stay in the API.
- The bank list (`src/banks.ts`) is the exception: the web app and the public site show its export steps, so they live here, with each entry's sources in `docs/bank-sources.md`. It names the API's built-in layouts by id; an API unit test keeps those ids and the layouts in agreement.

## How each consumer loads it

- API: a `file:../../packages/contracts` dependency. `npm --prefix apps/api run contracts:build` compiles `dist/`; the API's build, start, seed/schema, lint, typecheck and E2E hooks run it first. Jest and ts-jest (`apps/api/tsconfig.jest.json`) map the import to `src/`, so unit tests need no build. After editing the package, rerun `npm --prefix apps/api run contracts:build` (or restart `start:dev`) so a running API and the editor pick up the change.
- Web: an alias to `src/` in `apps/web/vite.config.ts` and `apps/web/tsconfig.app.json`; nothing to build.
- Docker: both images build from the repository root and place this package two levels above the app directory, matching the checkout.

Formatting follows `.prettierrc` here and runs with the API's `format` and `format:check` scripts.
