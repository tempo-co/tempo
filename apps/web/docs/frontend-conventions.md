# Frontend conventions

UI rules that the code follows but does not state. Anything visual (colours, type, sizes, components, patterns) is in `DESIGN.md`; read it before any UI change. Formatting, lint and type settings live in `.prettierrc`, `eslint.config.js` and `tsconfig.app.json`; read those instead of copying them here.

## Feedback: one message per event

Each outcome is reported once: an `Alert`, a toast, or neither. Never both.

- Errors: an `Alert` when the surface the failure belongs to stays open and is where the retry happens (a dialog, form, page or import step). A toast when that surface has closed or never existed (inline edits, background saves, a dialog that closed while saving). A row that failed may carry its own short line instead of a toast when the line says which row failed.
- Failures the `api` wrapper already toasted (offline writes, lost connections, expired sessions, rate limits, unverified email) get no `Alert` or toast at the call site: check `wasToasted(error)` (`src/utils/api.ts`) and leave the control ready to retry. With a loading toast, use `toastRequest` (`src/utils/toast-request.ts`) instead of `toast.promise`. A write Tempo makes without a user action passes `quiet: true`, so being offline, a lost connection, an ended session or a rate limit throws without the wrapper's toast.
- Warnings: an `Alert` for a lasting state that needs action (a bank needing attention). A toast only for a passing condition with no place on screen (offline storage unavailable, keep Tempo open until logout is confirmed).
- Info: neither by default. A toast only to explain a redirect (email already verified, log in to finish).
- Success: neither when the screen shows the result where it was made. A toast for outcomes the screen does not show: email sent, session revoked, effects elsewhere, saves that can finish after a dialog closes.
- Retry copy says what failed and "Try again", without "Please".
- An edit whose result shows where it was made (category select, inline fields) shows progress and outcome on the control and its status line. `useUpdateBankTransactionCategory` is the reference: no `toast.promise`, `toast.error` for non-wrapper failures.
- `Alert` comes from `src/components/ui/alert.tsx`; `DESIGN.md` (Alerts) says which variant and role. Do not hand-style bordered callouts or bare red lines for these.
- A flow that can fail asserts its failure message appears exactly once.
- A toast Undo is a shortcut only. Every reversible choice (hide, unlink, dismiss) also needs a persistent way back on the affected row.
- Toast actions are outlined in the toast's own colour, never a primary fill (`actionButton` in `src/components/ui/sonner.tsx`).
- Toasts must stay clickable over modals. `src/components/ui/sonner.tsx` sets `pointer-events-auto` on the Toaster and `src/components/ui/responsive-dialog.tsx` ignores outside clicks on `[data-sonner-toaster]`; keep both. Side sheets move toasts left (`data-side-sheet`, `src/index.css`).
- Stepped sheets use `StepFrame` (`src/components/shared/step-frame.tsx`). The entry holds only `AddDataProvider`; `src/features/add-data/components/add-data-sheet.tsx` loads on first use, then stays mounted.
- When a hook changes which `sonner` methods it calls, update the `sonner` stub in hook-harness specs (see `docs/e2e-helpers.md`).

## Colour and theme

- Destructive buttons keep the `destructive` variant's `text-destructive-foreground` (`src/components/ui/button.tsx`). Never add a text-colour override on a destructive fill; contrast falls well below AA. For "inconsistent colour" reports, grep for per-call overrides of the variant and measure computed colours in both themes.
- `.dark` sets `color-scheme: dark` in `src/index.css`; without it native scrollbars and form controls render light.
- Components use only the Tailwind colour names `src/index.css` exposes (the shadcn names and our additions); the scales and roles behind them are not utilities. In inline styles and SVG attributes, read the same names as `var(--color-…)`, never `hsl(var(--…))`. `DESIGN.md` (Foundations, Colour) says which name serves which job; `test/unit/theme-contrast.spec.ts` checks the contrast pairs.

## Merchant logo tiles

- Use `MerchantLogoTile` for leading transaction and recurring tiles, including category/activity fallbacks. Logos and activity glyphs sit on its neutral `transaction-tile` field, foreground and border colours (`src/index.css`, `DESIGN.md`); a category fallback takes its category's colour from `BANK_TRANSACTION_CATEGORY_META`. Do not recolor the ordinary `BankTransactionCategoryIcon` globally.
- The tile loads `/mask-v3` as an ordinary `img` without `crossOrigin` (CSS masks would drop the API cookies) and tints it with an SVG `SourceAlpha` filter whose `floodColor` references `--color-transaction-tile-foreground`; inherited `currentColor` leaves WebKit's tint stale after a theme change. Keep SVG definitions zero-sized and out of layout.
- Missing or failed derivatives show the fallback glyph. Failure state is keyed to the full source URL so a new version can recover. Never fall back to a full-color original or add merchant-specific artwork rules.

## Phone layouts

- Drawers (`src/components/ui/drawer.tsx`, vaul) never pass `shouldScaleBackground` (vaul's default keeps it off). The fixed tab bar lives inside the app tree, and scaling would move it and blacken the body during close.
- The tab bar, toasts and drawer footers pad with `env(safe-area-inset-bottom)`. `index.html`'s viewport meta has no `viewport-fit=cover`, so the inset is 0 on iOS until that is added.
- Touch targets inside composite controls still need 44px on phones (`max-sm:h-12` on the token field).
- Phones cannot hover: no information only in a `title` tooltip.
- Shared Button, Select and Command choices have 44px minimum touch targets on phones and coarse-pointer devices. Calendar days fill their seven-column cells on narrow phones; do not force seven 44px columns into a 320px viewport. Search and verification-code inputs use 16px text for touch entry.
- Ordinary dialogs and drawers own bounded vertical scrolling; fixed-header inspector layouts can override it with their own scrolling body. Drawer content hides vaul's below-sheet `::after` filler, which otherwise creates empty scroll space. Drawer footers include the bottom safe area.
- Escape closes only the top dialog. Radix moves its Escape listener to a dialog opened over another one a render late, so `src/components/ui/responsive-dialog.tsx` makes the dialog beneath pass an early Escape to the top one instead of closing both. A `ResponsiveDialog` without an `open` prop keeps its open state there for that, and closes when it swaps between dialog and drawer.

## Scrolling and secondary disclosures

- Use the shared shadcn `ScrollArea` for scrollable content, not native browser scrollbars. Keep content position and width stable when overflow appears; the overlay scrollbar must not create a native gutter. The page itself is the exception: it keeps the browser's scroller (iOS status-bar tap, toolbar collapse, keyboard scrolling and Back restoration depend on it), styled like `ScrollArea` with standard `scrollbar-color`/`scrollbar-width` in `src/index.css`. Don't add `::-webkit-scrollbar` rules: they make macOS Safari's overlay scrollbar permanent. Chrome on Linux still draws small arrow buttons on it; that is expected.
- A content-sized flex dialog with a maximum height can constrain its ScrollArea with a local `min-h-0` grid and `grid-rows-[minmax(0,1fr)]`. Verify actual Radix viewport wheel/touch scrolling and reachability of the final action, not only programmatic scrolling.
- Secondary folds reuse the existing ghost Button with a leading chevron and consistent hover/focus/touch targets. Transaction category provenance sits at the right edge of its label row.
- A paged list ends in `LoadMore` (`src/components/shared/load-more.tsx`): one full-width ghost Button, "Load more", that adds one page per press and disappears after the last one. A later page that fails keeps the loaded rows and the button and toasts "Couldn't load more." with a Retry (id `load-more-failed`), unless the `api` wrapper already toasted the error; a failed first page shows the list's own error state. Other text actions use `TextAction` (`src/components/shared/text-action.tsx`).
- Hoverable list rows keep their text on the section's edge: each row pads its sides and the list takes the same negative margin (`px-2` and `-mx-2` on Home's own rows), so the hover wash extends past the text on both sides.

## Interaction feedback and motion

- Select and Command choices request a brief haptic only on committed touch selection. Mouse, keyboard, cancelled gestures and reduced-motion selections stay quiet. Vibration is optional; unsupported or restricted feedback never blocks the action. Do not add haptics to every Button or overlay opening.
- Overlay primitives share `overlay-motion`: 180ms ease-out for anchored/centred overlays and 250ms for drawers. Preserve trigger transform origins, and let vaul own drag transforms and release behavior. Reduced motion disables overlay animation and transition, including vaul's injected styles.
- `press-feedback` gives coarse-pointer buttons a subtle press scale without animating layout. Reduced motion keeps the press static; navigation, lists and financial values do not get decorative entry motion.

## Charts

Use `ChartContainer` and `ChartTooltip` for the shared pointer behavior. Mouse hover follows
Recharts; touch inspection begins with a brief hold or a horizontal drag and ends on release
or cancellation. Vertical gestures scroll the page and pinch zoom remains available. A short
tap keeps the chart's click action; releasing an inspection must not navigate. Only x picks the
period, so a finger on the axis labels inspects the period above them.

Touch readouts sit at the top of the plot without movement animation. Supported browsers can
request a brief vibration when the inspected period changes; Safari has no Vibration API.
Keep exact values and actions available through the chart's accessible table as well.
Pointer focus outlines on SVG marks are suppressed centrally, including Recharts z-index layers;
ordinary controls and table links retain their keyboard focus indicators.

Value axes take their ticks from `axisTicks` (`src/features/dashboard/utils/chart-axis.ts`): round steps from zero with
about 6% headroom, passed as explicit `ticks` rather than `tickCount`. A Recharts `Bar` has no default fill: a `Cell`
without `fill` takes the bar's, and with neither the bar renders black.

HTML bars (the Insights cash flow) use `axisTicks` too, and a pair is a link only while it is a 44px target.

## Settings lists

Pattern in `src/features/settings/components/settings-group.tsx` and the access-token settings:

- A group's create action sits on the heading row (`SettingsGroup action`), never as a trailing row. When the list is empty, the empty state carries the only create button; the header button appears once items exist. Keep one dialog instance outside the empty state so it survives the list refetch, and return focus to whichever create button exists after close. Access-token creation uses the primary button in either state.
- Access-token rows mirror session rows: an icon, a truncated name, last-used text on the second line, and an always-visible Revoke action with 16px of space on either side. Clicking an access-token or session row opens a bottom drawer on phones and a dialog on desktop. Token details show the prefix, permissions, creation timestamp, last-used timestamp and expiration. Created/prefix/expiration metadata belongs in those details, not the row; expired values use destructive colour. The full secret is only shown during creation. Revocation from either entry point uses the same confirmation flow.
- Last-used reads `today`, `yesterday` or a date, never relative "N hours ago".
- Repeated row buttons get an accessible name that includes the item (`Revoke <name>`).

## Secrets shown once

Pattern in `src/features/settings/components/access-tokens/create-token-dialog.tsx`:

- One-line read-only monospace input that selects all on focus, `text-ellipsis`, with Copy joined inside the field's border behind a `border-l` divider. A button positioned over the text hides part of the secret.
- No focus ring on the field wrapper (`focus-within`); it fires when the inner Copy button is clicked. The Copy button keeps its own focus-visible outline.
- Copy shows `Copied` for about 2 s, then reverts; clear the timer on unmount.
- Reset dialog state on each opening: the opener gives the dialog a new `key` (`src/features/settings/components/access-tokens/access-token-settings.tsx`). Never reset in a delayed close timeout; a timer that fires after a quick reopen wipes the fresh form.
- Do not cap the dialog body height or give inner blocks their own scroll: nested scroll regions show double scrollbars once content grows. If the dialog must scroll, scroll it once as a whole.
- Credentials get an expiry choice at creation (`TOKEN_LIFETIMES`: 30 days, 90 days, 1 year, No expiration). Expired tokens stay listed until revoked.

## Copy

- Name a feature by its use and an item by convention (tab `Integrations`, item `Access tokens`). Explain the use once on the page; keep dialogs about the item.
- Never name the services Tempo is built on (its bank-data, AI or logo providers, for example) in UI copy, placeholders or hints, and do not name Tempo itself in descriptions ("Bills and income found in your history"). The user's own banks and their export formats may be named, because that is how the user recognises them: account rows show bank names, and the bank picker names the file to pick ("CSV").
- Do not ship setup snippets that need a local checkout path; only developers could use them.
- When something is briefly busy or failed for a moment, say what the user can do, not which internal process is busy ("Tempo is busy right now", not "Other files are being imported"). Say "Try again in a moment." for a short wait; name a duration only when the server gives a real one (`formatRetryAfter`).

## Routing and URL state

- Dialog state that Back should close lives in the host route's search schema; see `docs/browser-and-e2e-testing.md` for the close/back rule and the test.
- A rail's opened item (the Insights merchant) lives in the search with `replace`: beside the content from 1280px, in a `Sheet` narrower (bottom on phones).
- Input limits that reach the URL use one exported constant for the schema and the input's `maxLength` (`BANK_TRANSACTION_SEARCH_MAX_LENGTH`).

## Query caches

- `invalidateBankDerivedData` (`src/features/banking/api/invalidate-bank-derived-data.ts`) lists every cache derived from bank transactions; a new derived query goes under one of its roots.
- A finished sync marks that data stale only when a connection leaves its in-progress status or its `lastSyncedAt` advances (`hasSyncAdvanced` in `src/features/banking/api/use-get-all-bank-connections.ts`), never on a first read or an unchanged poll. Ingestion finishing does not mean categorization, conversion or matching has.
- Aggregates have their own key root (`['bank-dashboard']`, `src/features/banking/api/aggregate-query-keys.ts`). Code that scans the transaction-list root with `getQueriesData` reads every entry as a page list and breaks on another shape; grep `getQueriesData` and `setQueriesData` before caching under an existing root.
- A mutation that changes a server-filtered field can patch cached lists for an immediate result, then invalidates the derived data, since the server decides membership and totals (`src/features/banking/api/use-update-bank-transaction-category.ts`).
- `keepPreviousData` is set per query. Where a period label or a total is shown, gate on `isPlaceholderData`, as the Transactions page does (`src/routes/transactions/index.tsx`), so old figures never stand under a new label.
- A Transactions filter that reaches the API is an entry in `BANK_TRANSACTION_FILTER_KEYS` (`src/features/banking/types/bank-transaction.ts`). That list feeds the request, the filter count, Clear filters and the chip labels, so a param read outside it reaches none of them.

## Library traps

- Radix `ScrollArea` wraps its content in a `display: table` box with `min-width: 100%`. Inside a grid track with the default `min-width: auto`, wide content then widens the whole sheet; give the grid `grid-cols-1` and measure the ancestors, not only the scrolled element.
- Capture a dialog's focus-return target from `event.currentTarget` in the click handler (a transaction row in `src/features/banking/components/bank-transaction-ledger.tsx`), never from `document.activeElement`: Safari on iPhone does not focus a tapped button.

## UI primitives

`src/components/ui` holds application-owned shadcn-style wrappers over Radix, vaul (drawer), cmdk (command), react-day-picker (calendar) and input-otp. When changing one, verify focus return, portals, DOM selectors and animation state attributes.
