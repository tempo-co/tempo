# Browser and E2E testing

Recipes and traps for the Playwright suite under `test/`. Environment setup is in `docs/env-boundaries.md`; the shared helpers and the rules for reusing fixtures are in `docs/e2e-helpers.md`.

## Which specs need the stack

There are two kinds of spec:

- **Seeded specs** log in as seeded users through the `setup` project (`test/auth.setup.ts`) or create accounts through the real API (`freshAccount`). They need the E2E stack.
- **Fully mocked specs** answer every API call with `page.route` and declare `test.use({storageState: {cookies: [], origins: []}})`. List them with `git grep -l "storageState: {cookies: \[\], origins: \[\]}" test`. They run without Docker:

```bash
VITE_API_URL=http://localhost:3000 VITE_APP_URL=http://localhost:5173 VITE_EMAIL_UI_URL=http://localhost:8025 \
  npx playwright test <spec> --project=chromium --no-deps --retries=0
```

Without `--no-deps` the `setup` project needs the seeded API. A seeded spec run with `--no-deps` fails at once with ENOENT on `playwright/.auth/*.json`.

A mocked spec is a UI integration test, not full-stack coverage. Report it separately from seeded runs, and keep backend behaviour (matching, validation, rejection) proved in the seeded suite or in `apps/api`.

## Choosing what to run locally

- Home specs build on the synthetic history in `test/data/home-history.data.ts`: `mockSyntheticHome` answers every Home and month-dialog request, and `test/e2e/home/layout.spec.ts` renders it and a worst-case variant at every width, checking for overflow and amounts cut short or broken across lines. `test/e2e/home/loading.spec.ts` answers the same requests in a staggered order and records Chromium's layout-shift entries, so a section that moves the page as it fills in fails there. When Home gains a query, add its mock there, its delay to that spec's `STAGGER` and its empty answer to `mockEmptyHome` in `test/utils/api-mocks.ts`; when a row layout changes, grep `test/e2e` for `boxOf(` on the surface you changed and run those specs too.
- Run the full suite locally only for cross-cutting changes (`src/utils/api.ts`, `src/query-client.ts`, routing, auth, providers, shared layout or `src/components/ui`) or to reproduce a CI failure the logs do not explain.

## Local runs and shared servers

- A pass that needed a retry is a flake; say so.
- Parallel Playwright runs in one checkout overwrite `test-results/` and `playwright-report/`. Give each run its own `--output` directory and `PLAYWRIGHT_HTML_OUTPUT_DIR`.
- Stop a background preview by PID or port. `pkill -f "<command line>"` also matches the shell running it.

## Flaky tests

CI retries a failed test twice, so a test that fails and then passes leaves the run green. The `Web E2E tests` job lists every such test in its run summary, with its project, the line the first attempt failed on and its first error; the shard logs end with the same names under `flaky`. A flake is fixed at its cause, in the test or in the product: find which step failed and why from the first attempt's error; the trace (`on-first-retry`) records the retry, not the failure. Raising a timeout, adding retries or sleeps, skipping the test or loosening a tolerance without a measured reason is not a fix.

- A shard's blob report keeps the first attempt's page snapshot for one day: `gh run download <run> -n playwright-blob-<shard>`, then read the Markdown file in the unzipped report's resources folder.
- CPU throttling rarely reproduces a race between a user action and React's next render. To hit the gap, send the action from a `MutationObserver` in the same task the element appears in, then once with `setTimeout(…, 0)`. A race goes red on the first and green on the second. `test/e2e/banking/file-import.spec.ts` ("lists the supported files") presses Escape this way.

## Contracts to assert exactly

- Paged lists: seed more rows than the default page, then assert the default page length, the full `total`, the next page's rows and that ids do not repeat across pages. A 200 proves nothing.
- Server-side sort or filter: assert the request sent and the order of the rendered rows. A query that keeps previous data shows the old order while the new request is pending, so a sort that was never sent can look applied.
- When splitting or moving specs, compare `npx playwright test --list --reporter=json` before and after: it counts cases (each table row, in both browser projects), not files.

## Fixtures and RED runs

- A spec fixture that uses a field the client type lacks (`satisfies <Type>`) is a compile error, so the RED run fails on the build instead of on behaviour. Add the type field first, then run RED.
- `test/` is compiled with `tsconfig.app.json` (`lib: ES2020`). Test code must fit that `lib`, not just the installed Node.
- Prove RED in a separate worktree checked out at origin/main, with only the new or changed spec copied in; a spec that passes there is not testing the change. Order assertions so the one specific to the change fails first.
- A RED run of a seeded spec leaves state behind (extra sessions, changed data). Reset the stack before the GREEN run.

## Route mocks

- Mock only the API request (`fetch`/XHR), never the document navigation to the same path. `routeBankConnectionsApi` in `test/utils/api-mocks.ts` shows the pattern: `GET /bank-connections` is mocked and navigations to the old `/bank-connections` address pass through. A JSON body replacing the SPA is a harness error.
- The query client retries non-final errors (`src/query-client.ts`), so a mocked 500 can keep a query retrying past the 10 s test timeout. Mock 429 when the test needs a generic error state (401 is also final but starts the sign-out flow), unless the hook under test sets `retry: false`. A 429 also shows the shared rate-limit toast instead of the call site's own, so a test of a mutation's failure toast mocks a 500 (mutations never retry).
- Later `page.route` handlers run first. To hold a request on top of a stateful mock, register a second route for the same URL that awaits a release promise, then calls `route.fallback()`; the original mock still answers. Release in `finally` so a failed assertion does not leave the request hanging. For several held writes, push each resolver onto a queue and release with `await expect.poll(() => held.length).toBe(1); held.shift()!()`; a single `let release` races.
- `route.fetch()` goes straight to the network; other `page.route` handlers do not intercept it.
- Chromium loads a `route.fulfill` image even when the real response would be blocked by `Cross-Origin-Resource-Policy`. For cross-origin image behaviour (bank logos load with `crossOrigin = 'anonymous'`), serve the image from a test-owned loopback HTTP server with the API's headers instead.

## Sessions, polling and offline

- A rendered row does not prove every authenticated request has finished. A late rolling-session `Set-Cookie` can restore cookies removed by `context.clearCookies()`. To test that race, get a real response with `route.fetch()`, hold `route.fulfill({response})` across the cookie removal, and assert the protected request actually returns 401 before checking the toast and redirect. Delaying `route.continue()` sends an unauthenticated request and cannot test it.
- Test reconnect session rejection on a protected route without its own data queries, such as `/settings/appearance`. Home and banking requests produce their own 401 redirect and mask a broken `/accounts/me` handler. `onlineManager.setOnline(false)` can render the app before the query reports its network error.
- In polling tests, a route-handler request count does not prove the response or derived-query invalidation has settled. Keep the installed clock running with `page.clock.resume()` while awaiting polls, and assert the refreshed UI as well as the request.
- Offline specs need the service worker, which only a production build registers (see `docs/env-boundaries.md`).

## Dates

- Specs that depend on the local calendar set `timezoneId` (`test/e2e/home/recurring.spec.ts`, `test/e2e/recurring/recurring-series.spec.ts`). Keep local-calendar-date drill URLs in assertions; do not assume UTC midnight.
- `src/hooks/use-local-date.ts` is the reactive local-date owner: it reschedules at local midnight (`setHours(24, 0, 0, 0)`) and on focus/visibility. A parent calling `localDate()` during render keeps yesterday's value even when the child query refetches; pass one `useLocalDate()` value to every date-sensitive section.
- Rollover test: install `page.clock` just before midnight in the spec's zone, return an active item for the earlier `asOf` and an ended item for the next day, advance through midnight without navigating, then assert the new request date and the changed totals. Test tab wake separately with `page.clock.setSystemTime()` plus a focus or visibility event.
- Do not pin an exact relative-time string computed at module load; suite delays cross minute boundaries.

## Dialogs, drawers and phone layouts

- Dialog open state that should close on Back lives in a search param on the host route; see `month` in `src/routes/index.tsx`. Dialogs any page links to (recurring, merchants) take their params on the root route (`src/features/dashboard/components/app-dialogs.tsx`), so a link opens them over the current page with `to='.'`. Close with `router.history.back()` when `useCanGoBack()` is true and with `navigate({replace: true})` only for a deep link. Test: open, Escape, then `page.goBack()` must leave the page.
- Constrain a dialog's inner `ScrollArea` with a definite content height (the merchants dialog) or the `min-h-0` grid in `docs/frontend-conventions.md` (transaction details); an unconstrained viewport grows off screen. Test real mouse-wheel scrolling and Chromium touch swipes with `Input.dispatchTouchEvent` and animation-frame-separated moves; `scrollIntoViewIfNeeded()` is programmatic and passes on a broken dialog. Await opening animations before measuring.
- `test/e2e/settings/dialog-focus.spec.ts` dismisses every settings drawer with Escape and Cancel; extend that loop for drawer regressions (the `shouldScaleBackground` rule is in `docs/frontend-conventions.md`).
- On phone viewports, the fixed tab bar and stacked toasts cover controls near the bottom. Use `focus()` plus `keyboard.press('Enter')`, or scroll the control to the centre first. `locator.click()`, `fill()` and `toBeInViewport()` pass even when another layer would take a real tap; to prove a tap lands, tap the box centre with `page.touchscreen.tap` or `page.mouse.click`.
- Phone screenshots are viewport shots, not `fullPage`: a full-page capture paints the fixed tab bar in the middle of the list.
- Wait out open animations before screenshots or measuring with `animationsSettled` from `test/utils/layout.ts`; a mid-fade dialog looks transparent. Check the computed `backgroundColor`/`opacity` at rest before changing styles.
- Theme: the storage key is `vite-ui-theme`. Set it with `page.addInitScript` and assert the rendered theme; a different key leaves both captures in the default theme.
- The Transactions Filters control scrolls only inside its Radix scroll-area viewport (`[data-radix-scroll-area-viewport]`): the desktop panel's options pane and the phone sheet's body. Filter components rendered with `variant='pane'` have no scroll box of their own. `openTransactionFilter` in `test/utils/transaction-filters.ts` opens one filter on either layout.

## Merchant logo rendering

`test/e2e/banking/merchant-logos.spec.ts` asserts on decoded browser screenshots of the tinted tile, with images served from a loopback server that requires a synthetic cookie and sends the API's cache and CORP headers. Run it locally with localhost for both the web and API URLs, or the cookie and same-site image origin do not match. It mocks the API, so verify logo authorization against the API itself.

## WebKit project

Every iPhone browser is WebKit, so `playwright.config.ts` runs every spec a second time in the `webkit` project, a new spec included without listing it. It uses the same desktop default viewport as Chromium; a spec reaches iPhone layouts by setting a phone width (390 or 320) itself, so a layout check belongs at those widths. Run one spec with `--project=webkit`.

- WebKit sends requests from a controlling service worker past `page.route`, so mocks stop applying once the worker takes over and requests leak to the real API. The project blocks service workers and ignores the saved-app specs that need one (`testIgnore` in `playwright.config.ts`); a new spec that needs the worker goes on that list.
- Touch gestures are sent with Chromium CDP (`Input.dispatchTouchEvent`), and hover-tooltip checks need a mouse; both skip outside Chromium. Real iPhone touch, native drag-and-drop and the Android on-screen keyboard are not covered; check them by hand on a device.
- With Playwright's clock installed (`mockSyntheticHome` does), WebKit can keep reporting an element's position from the last frame it read of a finished CSS transition until its next rendering update, hundreds of milliseconds later, so an element that stands still may not have arrived. Wait until it has no animations left and its computed transform matches its style, as `settled` in `test/e2e/home/where-you-stand.spec.ts` does. `animationsSettled` polls because awaiting `animation.finished` fails in WebKit when an animation is cancelled.
- WebKit cannot fulfill a mocked 3xx, so mock a redirect with `fulfillRedirect` from `test/utils/api-mocks.ts`. Only Chromium lets a test read the clipboard back; the copy itself still runs in WebKit.
- Put worst-case data (long names, large amounts, flags) in layout specs: kind seed data fits any screen in any engine.

## Visual checks that pass when they should not

- `toBeVisible()` passes for `sr-only` content. Assert geometry and a real Tab/Enter path for anything revealed on focus.
- Tailwind `outline-hidden` sets `--tw-outline-style: none`. Overriding only outline width or colour (for example on the Recharts surface in `src/components/ui/chart.tsx`) shows nothing; add `outline-solid` locally and check the computed style.
- Select Recharts 3 axis labels by `.recharts-cartesian-axis-tick-value`; tick-group selectors match nothing.
- A plain block `Card` ignores `gap-*` unless its caller makes it a grid or flex container.
- For colour contracts, compare the element's computed colour with a temporary `<span class="text-<token>">` probe in the page instead of hard-coding RGB.

## URL-backed search limits

To change the transaction search cap (`BANK_TRANSACTION_SEARCH_MAX_LENGTH`, see `docs/frontend-conventions.md`):

1. Trace input → debounced `navigate` → route schema → request → API DTO. Raising one boundary alone leaves the router error or turns it into an API rejection; change the API validator in `apps/api` in the same PR.
2. Percent-encoded three-byte characters cost nine request-line bytes each. `nginx/tempo.conf` sizes `large_client_header_buffers` for the current cap, and `scripts/tempo-web-security-headers-test.sh` sends 1000 `€` through both the SPA route and the API proxy. Update both with the cap.
3. In the existing search journey, type exactly the maximum, check the full value in the request and URL, reload and check the restored input, then try one extra character and confirm the input stays bounded.

## Cash flow filters

`INTERNAL` is a parent of the internal-movement kinds (`BANK_TRANSACTION_INTERNAL_MOVEMENT_KINDS`). The route schema normalizes subtypes and ignores search params it does not define. When narrowing to a child, replace the parent rather than appending; the API treats the list as OR. Test Home drill navigation separately from direct `INTERNAL` and subtype URLs.

## Animation glitches

Sample `getBoundingClientRect()`, the body background and overlay opacity on every `requestAnimationFrame` inside one `page.evaluate`, and print only changes. A value pinned for exactly a library's transition length names the culprit. Then turn it into assertions in the spec for that flow.
