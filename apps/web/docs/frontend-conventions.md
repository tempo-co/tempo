# Frontend conventions

UI rules that the code follows but does not state. Formatting, lint and type settings live in `.prettierrc`, `eslint.config.js` and `tsconfig.app.json`; read those instead of copying them here.

## Formatting

- `npm run format` covers `src/**/*.{js,jsx,ts,tsx}` only. Do not run Prettier on `src/index.css` (it reflows the token comments) or on Markdown (it reflows unrelated lines); edit those by hand. `npx prettier --write src` touches CSS too, so run it on changed paths and check `git status` for collateral files.
- `prettier-plugin-tailwindcss` must stay last in `plugins`.

## Feedback: confirm in place, toast the rest

- An edit whose result shows where it was made (category select, inline fields) shows progress and outcome on the control and its status line, and toasts only on failure. `useUpdateBankTransactionCategory` is the reference: no `toast.promise`, `toast.error` for non-auth failures.
- Toast failures and outcomes the screen does not show: email sent, session revoked, effects elsewhere, saves that can finish after a dialog closes.
- The `api` wrapper toasts offline writes, lost write connections, expired sessions, rate limits and unverified email, and marks those errors. A call site that toasts a failure skips errors where `wasToasted(error)` (`src/utils/api.ts`) is true; with a loading toast, use `toastRequest` (`src/utils/toast-request.ts`) instead of `toast.promise`.
- A toast Undo is a shortcut only. Every reversible choice (hide, unlink, dismiss) also needs a persistent way back on the affected row.
- Toast actions are outlined in the toast's own colour, never a primary fill (`actionButton` in `src/components/ui/sonner.tsx`).
- Toasts must stay clickable over modals. `src/components/ui/sonner.tsx` sets `pointer-events-auto` on the Toaster and `src/components/ui/responsive-dialog.tsx` ignores outside clicks that land on `[data-sonner-toaster]`; keep both when touching either.
- The Toaster uses sonner's default lifetime and stacking. Sonner has no per-type duration, so split success/error lifetimes mean touching call sites.
- When a hook changes which `sonner` methods it calls, update the `sonner` stub in hook-harness specs (see `docs/browser-and-e2e-testing.md`).

## Colour and theme

- Destructive buttons keep the `destructive` variant's `text-destructive-foreground` (`src/components/ui/button.tsx`). Never add a text-colour override on a destructive fill; contrast falls well below AA. For "inconsistent colour" reports, grep for per-call overrides of the variant and measure computed colours in both themes.
- `.dark` sets `color-scheme: dark` in `src/index.css`; without it native scrollbars and form controls render light.
- `--clay` (mid-tone Clay) is for large accents and the logo's offset plane. Small text and controls on light use `--primary` (Clay strong). `DESIGN.md` holds the palette, contrast rules and component tokens.

## Phone layouts

- Drawers (`src/components/ui/drawer.tsx`, vaul) never pass `shouldScaleBackground` (vaul's default keeps it off). The fixed tab bar lives inside the app tree, and scaling would move it and blacken the body during close.
- The tab bar, toasts and drawer footers pad with `env(safe-area-inset-bottom)`. `index.html`'s viewport meta has no `viewport-fit=cover`, so the inset is 0 on iOS until that is added.
- Touch targets inside composite controls still need 44px on phones (`max-sm:h-12` on the token field).
- Phones cannot hover: no information only in a `title` tooltip.

## Charts

Use `ChartContainer` and `ChartTooltip` for the shared pointer behavior. Mouse hover follows
Recharts; touch inspection begins with a brief hold or a horizontal drag and ends on release
or cancellation. Vertical gestures scroll the page and pinch zoom remains available. A short
tap keeps the chart's click action; releasing an inspection must not navigate.

Touch readouts sit at the top of the plot without movement animation. Supported browsers can
request a brief vibration when the inspected period changes; Safari has no Vibration API.
Keep exact values and actions available through the chart's accessible table as well.
Pointer focus outlines on SVG marks are suppressed centrally, including Recharts z-index layers;
ordinary controls and table links retain their keyboard focus indicators.

## Settings lists

Pattern in `src/features/settings/components/settings-group.tsx` and the access-token settings:

- A group's create action sits on the heading row (`SettingsGroup action`), never as a trailing row. When the list is empty, the empty state carries the only create button; the header button appears once items exist. Keep one dialog instance outside the empty state so it survives the list refetch, and return focus to whichever create button exists after close. Access-token creation uses the primary button in either state.
- Access-token rows mirror session rows: an icon, a truncated name, last-used text on the second line, and an always-visible Revoke action with 16px of space on either side. Clicking the row opens a details dialog with the token prefix, permissions, creation timestamp, last-used timestamp and expiration. Created/prefix/expiration metadata belongs in that dialog, not the row; expired values use destructive colour. The full secret is only shown during creation. Revocation from either entry point uses the same confirmation flow.
- Last-used reads `today`, `yesterday` or a date, never relative "N hours ago".
- Repeated row buttons get an accessible name that includes the item (`Revoke <name>`).

## Secrets shown once

Pattern in `src/features/settings/components/access-tokens/create-token-dialog.tsx`:

- One-line read-only monospace input that selects all on focus, `text-ellipsis`, with Copy joined inside the field's border behind a `border-l` divider. A button positioned over the text hides part of the secret.
- No focus ring on the field wrapper (`focus-within`); it fires when the inner Copy button is clicked. The Copy button keeps its own focus-visible outline.
- Copy shows `Copied` for about 2 s, then reverts; clear the timer on unmount.
- Reset dialog state on the open transition (`useEffect` on `open`), never in a delayed close timeout; a timer that fires after a quick reopen wipes the fresh form.
- Do not cap the dialog body height or give inner blocks their own scroll: nested scroll regions show double scrollbars once content grows. If the dialog must scroll, scroll it once as a whole.
- Credentials get an expiry choice at creation (`TOKEN_LIFETIMES`: 30 days, 90 days, 1 year, No expiration). Expired tokens stay listed until revoked.

## Copy

- Name a feature by its use and an item by convention (tab `Integrations`, item `Access tokens`). Explain the use once on the page; keep dialogs about the item.
- Never name specific third-party products in UI copy, placeholders or hints, and do not name Tempo itself in descriptions ("Bills and income found in your history").
- Do not ship setup snippets that need a local checkout path; only developers could use them.

## Routing and URL state

- Dialog state that Back should close lives in the host route's search schema; see `docs/browser-and-e2e-testing.md` for the close/back rule and the test.
- Input limits that reach the URL use one exported constant for the schema and the input's `maxLength` (`BANK_TRANSACTION_SEARCH_MAX_LENGTH`).

## UI primitives

`src/components/ui` holds application-owned shadcn-style wrappers over Radix, vaul (drawer), cmdk (command), react-day-picker (calendar) and input-otp. Changing `components.json` or a package is not a migration: wrappers, call sites and the adjacent packages all move. Keep the incumbent unless a candidate replaces a concrete dependency or fixes a demonstrated defect, migrate one component at a time, and verify each with `npm run build` plus the Playwright flows for that overlay, menu, form or date surface. Check focus return, portals, DOM selectors and animation state attributes; other libraries differ there (for example `render` instead of `asChild`).
