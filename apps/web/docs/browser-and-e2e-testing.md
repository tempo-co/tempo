# Browser and E2E testing

Recipes and traps for the Playwright suite under `test/`. Environment setup is in `docs/env-boundaries.md`.

## Which specs need the stack

There are two kinds of spec:

- **Seeded specs** log in as seeded users through the `setup` project (`test/auth.setup.ts`) or create accounts through the real API (`freshAccount`). They need the E2E stack.
- **Fully mocked specs** answer every API call with `page.route` and declare `test.use({storageState: {cookies: [], origins: []}})`. List them with `git grep -l "storageState: {cookies: \[\], origins: \[\]}" test`. They run without Docker:

```bash
VITE_API_URL=http://localhost:3000 VITE_APP_URL=http://localhost:5173 VITE_EMAIL_UI_URL=http://localhost:8025 \
  npx playwright test <spec> --project=chromium --no-deps --retries=0
```

Leave `NODE_ENV` unset. Without `--no-deps` the `setup` project needs the seeded API. A seeded spec run with `--no-deps` fails at once with ENOENT on `playwright/.auth/*.json`.

A mocked spec is a UI integration test, not full-stack coverage. Report it separately from seeded runs, and keep backend behaviour (matching, validation, rejection) proved in the seeded suite or in `tempo-api`.

## Choosing what to run locally

- Find the specs for a change with `git grep` over `test/e2e` for the route, component, label or test id. `--only-changed` finds nothing: specs drive the browser and do not import `src`.
- Home layout specs measure geometry. `test/e2e/home/dashboard-density.spec.ts` mocks every Home request and measures row insets from row titles. When Home gains a query, add its mock there; when a row layout changes, grep `test/e2e` for `boxOf(` on the surface you changed and run those specs too.
- Run the full suite locally only for cross-cutting changes (`src/utils/api.ts`, `src/query-client.ts`, routing, auth, providers, shared layout or `src/components/ui`) or to reproduce a CI failure the logs do not explain.

## Local runs and shared servers

- `playwright.config.ts` sets `reuseExistingServer: !process.env.CI`. Locally, any server already on `VITE_APP_URL` is reused, so another worktree's preview on 5173 silently tests the wrong build. Check the listener's working directory first.
- The suite runs with one worker and `fullyParallel: false`; CI retries twice, local runs do not. A pass that needed a retry is a flake; say so.
- Parallel Playwright runs in one checkout overwrite `test-results/` and `playwright-report/`. Give each run its own `--output` directory and `PLAYWRIGHT_HTML_OUTPUT_DIR`.
- Stop a background preview by PID or port. `pkill -f "<command line>"` also matches the shell running it.

## Fixtures and RED runs

- A spec fixture that uses a field the client type lacks (`satisfies <Type>`) is a compile error, so the RED run fails on the build instead of on behaviour. Add the type field first, then run RED.
- `test/` is compiled with `tsconfig.app.json` (`lib: ES2020`). Test code must fit that `lib`, not just the installed Node.
- Prove RED by restoring the old source while keeping the new tests: `git checkout origin/main -- src`, run the spec, then `git checkout HEAD -- src`. Confirm `git status` shows `src` modified before trusting the run; a stash taken after committing the fix is empty and the "RED" run tests the fix. Order assertions so the one specific to the change fails first.
- A RED run of a seeded spec leaves state behind (extra sessions, changed data). Reset the stack before the GREEN run.

## Hook harness

`test/utils/hook-harness.ts` (`createHookHarness`) runs real hooks from `src` against a real `QueryClient` with chosen modules replaced wholesale, for cache behaviour the UI cannot set up. Any named import that a hook starts using from a stubbed module is `undefined` in the harness. When you add an import from `@/utils/api` or `sonner` to a hook, add it to every harness stub for that module (for example `isAuthError: () => false`, `toast.error: () => undefined`), or the failure-path test throws `TypeError` instead of the expected error. Current users: `grep -rl createHookHarness test`.

## Route mocks

- Mock only the API request (`fetch`/XHR), never the document navigation to the same path. `routeBankConnectionsApi` in `test/utils/api-mocks.ts` shows the pattern: `GET /bank-connections` is mocked and navigations to `/bank-connections` pass through. A JSON body replacing the SPA is a harness error.
- The query client retries non-final errors (`src/query-client.ts`), so a mocked 500 can keep a query retrying past the 10 s test timeout. Mock 429 when the test needs a generic error state (401 is also final but starts the sign-out flow), unless the hook under test sets `retry: false`.
- Later `page.route` handlers run first. To hold a request on top of a stateful mock, register a second route for the same URL that awaits a release promise, then calls `route.fallback()`; the original mock still answers. Release in `finally` so a failed assertion does not leave the request hanging. For several held writes, push each resolver onto a queue and release with `await expect.poll(() => held.length).toBe(1); held.shift()!()`; a single `let release` races.
- `route.fetch()` goes straight to the network; other `page.route` handlers do not intercept it.
- Chromium loads a `route.fulfill` image even when the real response would be blocked by `Cross-Origin-Resource-Policy`. For cross-origin image behaviour (bank logos load with `crossOrigin = 'anonymous'`), serve the image from a test-owned loopback HTTP server with the API's headers instead.

## Sessions, polling and offline

- A rendered row does not prove every authenticated request has finished. A late rolling-session `Set-Cookie` can restore cookies removed by `context.clearCookies()`. To test that race, get a real response with `route.fetch()`, hold `route.fulfill({response})` across the cookie removal, and assert the protected request actually returns 401 before checking the toast and redirect. Delaying `route.continue()` sends an unauthenticated request and cannot test it.
- Test reconnect session rejection on a protected route without its own data queries, such as `/settings/appearance`. Home and banking requests produce their own 401 redirect and mask a broken `/accounts/me` handler. `onlineManager.setOnline(false)` can render the app before the query reports its network error.
- In polling tests, a route-handler request count does not prove the response or derived-query invalidation has settled. Keep the installed clock running with `page.clock.resume()` while awaiting polls, and assert the refreshed UI as well as the request.
- Offline specs need the service worker, which only a production build registers (see `docs/env-boundaries.md`).

## Dates

- Specs that depend on the local calendar set `timezoneId` (`test/e2e/home/recurring.spec.ts`, `test/e2e/banking/recurring-series.spec.ts`). Keep local-calendar-date drill URLs in assertions; do not assume UTC midnight.
- `src/hooks/use-local-date.ts` is the reactive local-date owner: it reschedules at local midnight (`setHours(24, 0, 0, 0)`) and on focus/visibility. A parent calling `localDate()` during render keeps yesterday's value even when the child query refetches; pass one `useLocalDate()` value to every date-sensitive section.
- Rollover test: install `page.clock` just before midnight in the spec's zone, return an active item for the earlier `asOf` and an ended item for the next day, advance through midnight without navigating, then assert the new request date and the changed totals. Test tab wake separately with `page.clock.setSystemTime()` plus a focus or visibility event.
- Do not pin an exact relative-time string computed at module load; suite delays cross minute boundaries.

## Dialogs, drawers and phone layouts

- Dialog open state that should close on Back lives in a search param on the host route; see `recurring` in `src/routes/index.tsx`. Close with `router.history.back()` when `useCanGoBack()` is true and with `navigate({replace: true})` only for a deep link. Test: open, Escape, then `page.goBack()` must leave the page.
- A `flex flex-col` dialog with only `max-h-[90dvh]` gives its inner `ScrollArea` no definite height, so a long list grows off screen. Give the content a definite height as the transaction details and recurring dialogs do (`h-[min(90dvh,56rem)]` plus `max-h`). Test scrolling with `page.mouse.wheel` over the dialog; `scrollIntoViewIfNeeded()` scrolls programmatically and passes on a broken dialog. Poll a phone sheet's bounding box until its slide-in finishes before asserting it fits.
- `src/components/ui/drawer.tsx` never passes vaul's `shouldScaleBackground` (off by default); never add it. Turning it on transforms the app wrapper, which becomes the containing block for the fixed tab bar (`app-nav.tsx`) and blackens the body during close. `test/e2e/settings/dialog-focus.spec.ts` dismisses every settings drawer with Escape and Cancel; extend that loop for drawer regressions.
- On phone viewports, the fixed tab bar and stacked toasts cover controls near the bottom. Use `focus()` plus `keyboard.press('Enter')`, or scroll the control to the centre first.
- Wait out open animations (about 300 ms) before screenshots; a mid-fade dialog looks transparent. Check the computed `backgroundColor`/`opacity` at rest before changing styles.
- Theme: the storage key is `vite-ui-theme`. Set it with `page.addInitScript` and assert the rendered theme; a different key leaves both captures in the default theme.
- Mobile filter drawers scroll inside the Radix scroll-area viewport (`[data-radix-scroll-area-viewport]`), not the nested command list.

## Visual checks that pass when they should not

- `toBeVisible()` passes for `sr-only` content. Assert geometry and a real Tab/Enter path for anything revealed on focus.
- Tailwind `outline-hidden` sets `--tw-outline-style: none`. Overriding only outline width or colour (for example on the Recharts surface in `src/components/ui/chart.tsx`) shows nothing; add `outline-solid` locally and check the computed style.
- Recharts 3 axis labels are `.recharts-cartesian-axis-tick-value`; older tick-group selectors match nothing.
- A plain block `Card` ignores `gap-*` unless its caller makes it a grid or flex container.
- For colour contracts, compare the element's computed colour with a temporary `<span class="text-<token>">` probe in the page instead of hard-coding RGB.

## URL-backed search limits

The transaction search cap is one constant, `BANK_TRANSACTION_SEARCH_MAX_LENGTH` in `src/features/banking/types/bank-transaction.ts`, used by both the route schema and the input's `maxLength`. To change it:

1. Trace input → debounced `navigate` → route schema → request → API DTO. Raising one boundary alone leaves the router error or turns it into an API rejection; coordinate the `tempo-api` validator.
2. Percent-encoded three-byte characters cost nine request-line bytes each. `nginx/tempo.conf` sizes `large_client_header_buffers` for the current cap, and `ops/tests/tempo-web-security-headers-test.sh` sends 1000 `€` through both the SPA route and the API proxy. Update both with the cap.
3. In the existing search journey, type exactly the maximum, check the full value in the request and URL plus the pagination reset, reload and check the restored input, then try one extra character and confirm the input stays bounded.

## Cash flow filters

`INTERNAL` is a parent of the internal-movement kinds (`BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS`). The route schema normalizes subtypes and still accepts the older `financialEventTypes` parameter. When narrowing to a child, replace the parent rather than appending; the API treats the list as OR. Test Home drill navigation separately from direct `INTERNAL`, subtype and legacy URLs.

## Standalone scripts against a build

For stress tests with synthetic data, screenshots or frame-by-frame animation probes, build once and drive the preview from a scratch script:

1. `VITE_API_URL=http://api.example.test npx vite build --outDir <scratch>/dist --emptyOutDir`, then `npx vite preview --outDir <scratch>/dist --port <free> --strictPort`.
2. In the script, import Playwright from this repo's `node_modules`, fulfil `/accounts/me`, `/bank-connections` and `/bank-transactions[/<id>]` (plus whatever the page requests) with `page.route`, and log unexpected API paths so a missing mock is visible.
3. Phone context: 412x915, `isMobile`, `hasTouch`. Theme via `vite-ui-theme` in an init script.
4. For an animation glitch, sample `getBoundingClientRect()`, the body background and overlay opacity on every `requestAnimationFrame` inside one `page.evaluate`, and print only changes. A value pinned for exactly a library's transition length names the culprit. Then turn it into assertions in the spec for that flow.
