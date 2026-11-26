# Design System: Tempo

The design system's single document. Product scope is in `PRODUCT.md`; what screens show is in
`docs/product-ui-rules.md`.

The interface is quiet and trustworthy, data-forward, and distinctive through proportion, spacing
and a few deliberate forms, never through effects. A signed-in screen makes the financial state, the
next action and the path to detail obvious first. Never fabricate balances, transactions or sync
outcomes, label synthetic data as synthetic, and use no decorative gradients.

## Brand

### Name and colours

The product is moving to the Wisp name; the name strings still say "Tempo". Two brand colours:

- **Midnight** `#232B66`: the action colour in the interface (light theme), and the logo's bars.
- **Rose** `#D9577A`: the logo's dot only. Rose never appears in the interface.

### Logo

The mark is the Wisp symbol: three rounded Midnight bars with a floating Rose dot. Bars and dot
share one width, and the gap above the last bar equals the gaps between bars. The wordmark sets
"Wisp" with its letters outlined to paths; the lockups pair it with the symbol, side by side or
stacked. The app shows the symbol alone (`src/assets/logo.tsx`).

| Colour | Value | Use |
| --- | --- | --- |
| Midnight | `#232B66` | The bars on light, the app-icon tile |
| Rose | `#D9577A` | The dot, in every version |
| White | `#FFFFFF` | The bars on dark and on Midnight |

On dark, the bars turn white and the dot stays Rose: the symbol component switches to the reversed
master under the `dark` class, and `favicon.svg` does the same when the device prefers dark.
These are fixed brand colours, not theme roles.

Keep clear space of one bar width all round. The smallest size is 16 px, drawn from the
pixel-snapped 16 px cut (`favicon-16.png`).

Logo files are copied from the approved masters: never redraw, recolour or decorate the mark. The favicons, app icons, maskable icon and apple-touch icon live
in `public/`, listed in `config/app-icons.ts` and wired by `manifest.webmanifest` and
`index.html` (`docs/pwa.md`). The browser's theme colour is the page background of each theme
(`#F5F6FA` light, `#121420` dark); the manifest uses the light one.

## Foundations

### Themes

Light, dark and system are first-class; system is the default (`ThemeProvider`), and a device with
no preference gets light. Light is the reference theme for tuning and review; every screen is still
checked in dark, with keyboard focus, reduced motion and narrow widths, before it is finished. `.dark`
sets `color-scheme: dark` so native controls and scrollbars follow.

### Colour

Midnight is for actions only, on cool neutrals; data is drawn in ink. Colour is built in three
layers in `src/index.css`.

**1. Scales.** Raw 12-step colours, both themes' values on `:root` (`--grey-1` … `--grey-12`,
`--grey-dark-1` … `--grey-dark-12`). They are never used in components and no Tailwind class reaches
them.

- **Grey** (cool neutrals) and **Midnight** were generated once with Radix's custom-palette method
  (Midnight `#232B66` on `#FFFFFF` for light, `#AEB6F2` on `#121420` for dark, cool grey seeds), then
  the agreed Wisp values replaced their nearest steps. Midnight's step 9 is the button colour;
  `--midnight-contrast` and `--midnight-dark-contrast` are the text on it.
- **Green, amber, red and blue** are Radix's published scales, light and dark. Light step 11 of green,
  amber and blue is darkened slightly so status text clears 4.5:1 on the cool page.
- **Category colours** (`--hue-*`, `--hue-dark-*`) are one fixed colour per category and theme.
- `--grey-dark-0` is one step below dark step 1, only for the dark modal backdrop.

Each step has a job, as in Radix:

| Steps | Job |
| --- | --- |
| 1–2 | App and surface backgrounds |
| 3–5 | Component fills: rest, hover, pressed |
| 6–8 | Borders and focus |
| 9–10 | Solid fills and their hover |
| 11–12 | Text: muted and default |

The anchors sit at these steps:

| Role | Light | Step | Dark | Step |
| --- | --- | --- | --- | --- |
| Surface (cards, overlays) | `#FFFFFF` | grey 1 | `#1A1D2B` | grey 3 |
| Page | `#F5F6FA` | grey 2 | `#121420` | grey 1 |
| Sunk | `#EEF0F5` | grey 3 | `#161826` | grey 2 |
| Hairline | `#E2E5EE` | grey 5 | `#2A2E40` | grey 5 |
| Faint | `#8A8FA0` | grey 9 | `#767C90` | grey 10 |
| Muted text | `#5D6275` | grey 11 | `#A3A8BA` | grey 11 |
| Ink | `#1D2140` | grey 12 | `#EEF0F7` | grey 12 |
| Buttons | `#232B66`, white text | midnight 9 | `#AEB6F2`, `#14161A` text | midnight 9 |

**2. Roles**, named by job in Primer's style. Light values are on `:root`, dark values under `.dark`;
only this layer reads the scales.

- **Foreground:** `fgColor-default` (ink), `fgColor-muted`, `fgColor-faint`, `fgColor-onEmphasis`
  (text on a Midnight or status fill), `fgColor-accent`, `fgColor-success`, `fgColor-warning`,
  `fgColor-danger`, `fgColor-info`, `fgColor-onPlate`.
- **Background:** `bgColor-default` (page), `bgColor-surface`, `bgColor-sunk`, `bgColor-neutral-muted`
  (quiet fills and hover), `bgColor-accent-muted` (selection and "to check" tints),
  `bgColor-accent-emphasis` (Midnight fills), each status's `-muted` and `-emphasis`,
  `bgColor-backdrop`, `bgColor-plate`.
- **Border:** `borderColor-default` (hairlines), `borderColor-muted`, `borderColor-emphasis` (control
  boundaries and chart outlines, 3:1 on every background), `borderColor-accent`, `borderColor-plate`.
- **Focus:** `focus-outlineColor` (Midnight).
- **Data:** `data-series-primary` (ink), `data-series-secondary`, `data-heat`, and one
  `categoryColor-*` per category.

Status emphasis fills use step 11 in light, because Radix's step 9 is too light for white text at
body size, so a status colour is one strong value for text, marks and fills.

**3. Utilities.** Tailwind exposes only shadcn's names and our additions in the same style; each
points at a role, and Tailwind's own palette is cleared. A part added with the shadcn tool takes on
the Wisp look as installed.

| Utility | Role | Use |
| --- | --- | --- |
| `background`, `foreground` | page, ink | The page and its text |
| `card`, `popover` (+ `-foreground`) | surface, ink | Cards, dialogs, menus, toasts |
| `primary`, `primary-foreground` | Midnight fill, on-emphasis | Primary buttons, active navigation, links, selected values |
| `secondary`, `muted`, `accent` (+ `-foreground`) | neutral-muted | Quiet fills, skeletons, hover |
| `muted-foreground` | muted | Secondary text, placeholders |
| `sunk` | sunk | Recessed areas inside a surface |
| `faint` | faint | Decorative icons beside text on a card; never text |
| `border` | hairline | Card edges, dividers, separators |
| `input` | border emphasis | Control boundaries: inputs, checkboxes, outline buttons |
| `ring` | focus | Focus outlines |
| `destructive`, `success`, `warning`, `info` (+ `-foreground`, `-muted`) | status | Status text and marks; `-foreground` is the label on that fill; `-muted` is the field of an alert or toast |
| `scrim` | backdrop | Modal backdrops: 60% on light, 85% on dark |
| `chart-primary`, `chart-secondary`, `chart-secondary-edge`, `chart-heat` | data | Charts (below) |
| `category-*` | category | Category icons and tiles (below) |
| `transaction-tile` (+ `-foreground`, `-border`) | sunk, muted, hairline | The leading row tile |
| `bank-logo-plate` (+ `-foreground`, `-border`) | plate | The light plate under bank artwork in both themes |

Inline styles and SVG attributes read `var(--color-…)`; a job with no utility gets a role and a
utility first.

**Contrast.** Every pair the app renders clears WCAG AA in both themes, and
`test/unit/theme-contrast.spec.ts` checks these pairs against the shipped theme file:

- Text at 4.5:1: `foreground` and `muted-foreground` on `background`, `card`, `popover`, `muted`,
  `sunk` and `accent`; each `-foreground` on its own fill; `primary` as text on the page, cards and
  popovers; each status colour on the page, cards, popovers and its `-muted` field, with
  `muted-foreground` descriptions on that field; bank initials on the plate; an amount on the
  strongest heat cell (`chart-heat` at 45% on a card).
- Graphics at 3:1: `input` and `ring` on the page, cards, popovers and `sunk`; `chart-primary` and
  `chart-secondary-edge` on cards and the page; `faint` on cards; the transaction tile's icon on its
  field; each category icon on its 10% tile over a card and over the page.

Hairlines (`border`) are decorative separation and are not held to 3:1; anything a person must find
to operate uses `input`. `faint` clears 3:1 only on cards, so it never carries text or meaning.

Status is never colour alone: pair it with text, an icon or another cue. Never communicate
transaction direction, sync state, categorisation state or an error by hue alone.

### Charts and categories

Data series use `chart-primary` (ink) and `chart-secondary` (a quiet grey) whose bars carry a 1px
`chart-secondary-edge` outline at 3:1. Heat-table cells tint 5–45% of `chart-heat` behind their
amount (ink on light, a dimmer grey on dark so light text stays readable). Midnight marks only a
selected period or an action, never a data series.

Each category keeps one colour across the app: the icon in `category-*` on a tile of the same colour
at 10% with a 30% edge (`src/features/banking/utils/bank-transaction-category-meta.ts`). The colours
keep each category's hue in both themes, are distinct from one another, and are tuned light first.
The category label, its source (`Suggested by AI` or `Manual`) and pending or failed status are
always text as well.

### Typography

Inter is the product typeface, self-hosted as a variable font at weights 100–900. UI copy, headings
and money use Inter; the system monospace stack is only for identifiers such as IP addresses and
error codes.

The named styles are utilities in `src/index.css`, so a change there reaches every use; the page is
set in body. Use them rather than size and weight classes, and add no sizes outside this scale.

| Style | Utility | Value | Use |
| --- | --- | --- | --- |
| Page title | `text-page-title` | 700, 22px/1.2, -0.02em | One per page (error and auth pages too), and a dialog that stands in for a page |
| Section title | `text-section-title` | 600, 16px/1.35 | Dialog and drawer titles, detail views |
| Card title | `text-card-title` | 600, 13px/1.4 | Card and group headings, empty and error states |
| Body | `text-body` | 400, 14px/1.5 | Primary copy: row titles and amounts, menu items, navigation, field values |
| Body small | `text-body-small` | 400, 13px/1.5 | Muted descriptions, button and segment labels, tooltips |
| Label | `text-label` | 500, 12px/1.33 | Metadata, field labels, table headings, compact status |
| Caption | `text-caption` | 11px/1 | Fixed-space labels: tabs, axis ticks, flag codes |
| Numeric | `numeric` | Tabular figures | Amounts and rates, so digits line up |

Typed text is 16px below `md` (`text-base md:text-body`), because iOS zooms into smaller fields.
Headline figures (a balance, a transaction's amount) are `numeric` display sizes set where drawn.

### Spacing and layout

Spacing is Tailwind's 4px scale: card padding 16px (`p-4`), cards on a page 12px apart (`gap-3`),
columns inside a card 16px apart (`gap-4`).

The authenticated shell is a sticky `48px` header aligned to the ~`80rem` content column; below `md`,
navigation moves to a fixed bottom tab bar. Settings uses a ~`40rem` reading column. From `md` up,
the page reserves the scrollbar's gutter, so the column stays put between short and long pages and
when a dialog locks scrolling. Every page title starts at the top of that column (Home, which has
none, starts its content there), and an action beside a title overhangs the title's row instead of
making it taller, so titles and the content under them don't move between pages. Responsive
behaviour is structural, not scaled: navigation becomes a tab bar, tables scroll horizontally (or,
when a phone needs only their latest column, become rows that open in place into the rest), rows
stay understandable without hover.

Controls are 32px tall; phone and coarse-pointer targets are at least 44px
(`max-sm:min-h-11 pointer-coarse:min-h-11`, with `min-w-11` where they can be narrow).

The financial record is the subject: no decorative headers, tile mosaics or hero space.

### Shape

Corners are small: `--radius` is `8px`.

| Utility | Radius | Use |
| --- | --- | --- |
| `rounded-lg` | 8px | Cards, grouped lists, dialogs, drawer tops, toasts |
| `rounded-md` | 6px | Controls, menus, popovers, tooltips, alerts |
| `rounded-sm` | 4px | Segments, menu items, checkboxes |
| `rounded-full` | | Badges, avatars, leading tiles |

Borders are 1px hairlines (`border`); a control's boundary uses `input`.

### Elevation

Flat tonal layering: page, surfaces, sunk areas, hairlines. Cards have no shadow; overlays and
chart tips may lift (`shadow-sm` to `shadow-lg`). Modal backdrops use `scrim` (60% light, 85% dark).
No glow, glass, backdrop blur or nested shadows.

### Motion

Motion is brief (about 150–300 ms), subtle and reduced-motion aware; never animate financial values
continuously. Overlays animate with `.overlay-motion`, presses with `.press-feedback`; both switch off
under `prefers-reduced-motion`.

### Icons

Lucide icons, 16px in controls. A meaningful icon has a text equivalent; a decorative one is
`aria-hidden`.

### Enforcement

- **Lint** (`eslint-rules/design.js`): no raw colours, and no px or rem arbitrary values
  (`text-[13px]`), in component source; use a role, a scale step or `--spacing(n)`. Relative values
  (`90dvh`, `8em`), `var(--…)` and 1px pass.
- **Contrast:** `test/unit/theme-contrast.spec.ts`, the pairs under Colour.
- **Layout:** `test/e2e/home/layout.spec.ts`, Home from 1440 to 320px in both themes.

An exception needs a reason:

```ts
// eslint-disable-next-line design/tokens -- a fixed brand colour
```

## Components

Shared parts are shadcn parts in `src/components/ui`, restyled only through the utilities and sizes
above; own components exist only for domain parts. A part has only the variants listed here.

**Focus.** Every interactive control shows the same focus indicator on `:focus-visible`: a solid 2px
outline in `ring`, offset 2px (`outline-2 outline-offset-2 outline-ring`). Where the control fills
its container (nav tabs, rows, joined segments), the outline sits inside instead
(`-outline-offset-2`). Use outlines, not box-shadow rings, for focus; they survive forced-colours
mode. A box-shadow ring in `primary` marks a selected value (the theme picker), never focus.

### Buttons

`Button`: `text-body-small` medium labels, control radius, 16px icons with an 8px gap, specific
labels ("Connect a bank", "Re-authorize"). Every size grows to 44px on phones and coarse pointers.

| Size | Height | Use |
| --- | --- | --- |
| `default` | 32px, 12px sides | Actions in forms, dialogs, cards and page headers |
| `sm` | 28px, 10px sides | Row actions, small actions inside a section, text actions |
| `icon` | 32px square | An icon-only action, always with an `aria-label` |

| Variant | Use |
| --- | --- |
| `default` | The view's one primary action, in Midnight |
| `outline` | Secondary, row and empty-state actions; the `input` edge |
| `secondary` | A quiet filled action beside a primary one |
| `ghost` | Toolbar and dismiss actions; `accent` only on hover, focus and active |
| `link` | An inline action inside text |
| `destructive` | Confirming a destructive action; never override its label colour |

`TextAction` (`src/components/shared/text-action.tsx`) is the `sm` ghost button in `primary` text
for "All", "Show fewer" and "Open in Transactions". Pending states pair motion with text
("Connecting...").

### Toggles and segmented controls

`ToggleGroup` and `Toggle`, `text-body-small` labels; sizes `default` 32px and `sm` 28px (44px on
phones and coarse pointers); variants `default` and `outline`. Separate segments (interval, bills or
income) are `outline` `sm` with segment corners and `secondary` on the chosen one. A joined control
(the span switch) rounds its outer group and clips square segments, the chosen one in `foreground`.

### Cards and grouped surfaces

`Card` gives `rounded-lg`, `bg-card` and a hairline, no shadow and no padding; content uses `p-4`
with a `text-card-title` heading, and a card holding a table insets its header and first column
16px instead. Grouped lists (settings, bank accounts, a day's transactions) are one `rounded-lg`
bordered list of `divide-y` rows. A card is one record; never nest cards or build statistic-tile
collections.

### Inputs and fields

`Input` and `SelectTrigger` match the control height (32px, 44px on phones and coarse pointers):
page background, an `input` edge, control radius, 12px sides. `Label` is `text-label`. Errors pair
the destructive colour with a plain-language message on the field (`FormMessage`). `Checkbox` is
16px with segment corners.

### Tables and transaction rows

Quiet `text-label` headers, dividers only for row scanning, right-aligned `numeric` amounts. Long
descriptions truncate where the row opens a view that shows them in full; a selection row in a
dialog wraps its description instead, so similar names can be told apart. Rows that navigate show a
keyboard-visible focus state.

Every transaction and recurring row starts with a round `36px` leading tile (`transaction-tile`:
the sunk field, a muted icon and a hairline edge): the merchant's monochrome alpha logo when
available, otherwise the category glyph (the activity glyph for own transfers and currency
exchanges). Account rows, import surfaces and empty states lead with the same tile. The row is the
shared `60px` row (`min-h-15`, `px-3 py-2`): a `text-body` title over a muted `text-xs` line, plus
any `1px` divider; a wrapping selection row grows only for its description. The transaction
inspector keeps its `40px` tile. Logo loading, tinting and fallbacks: `docs/frontend-conventions.md`.
There are no per-merchant exceptions. Logos are display only: names, identification and sourcing
stay unchanged.

Bank artwork keeps its original colours on the `bank-logo-plate`, a light plate in both themes.

### Overlays

`ResponsiveDialog` is a `Dialog` on desktop and a bottom `Drawer` on phones: `rounded-lg` on the
page background, a `text-section-title` title over a muted `text-body-small` description.
`DropdownMenu`, `Popover`, `Select` content and `Tooltip` are `popover` surfaces with the control
radius; items are `text-body` with segment corners, tooltips `text-body-small`.

### Badges

`Badge`: a `text-xs` semibold pill beside a name. `secondary` for neutral facts (a price range),
`outline` tinted with a status colour for attention (late), `default` and `destructive` filled.

### Alerts

An inline message about the thing it sits in (a refused import, a bank to re-authorize, a failed
save) is an `Alert` (`src/components/ui/alert.tsx`), never a hand-styled box or bare red text: 1px
border, control radius, `10px 12px` padding, a leading 16px glyph, a `text-body` medium title, a muted
`text-body-small` description, actions under the text on phones and to the right from `sm` up.

- **Variants.** `default` (surface field, muted glyph) explains or offers a next step; `warning`
  (warning edge at 40%, field at 5%, warning glyph) is attention that is not a failure;
  `destructive` (the same in destructive) is a refusal or a failed operation. Text stays foreground
  and muted; the glyph and the edge carry the tone.
- **Glyph.** Names the subject (`FileX` a refused file, `Clock` consent ending, `CloudOff` a failed
  load), not the tone alone.
- **Announcing.** `role='alert'` for a message that appears in answer to the user, `role='status'`
  for a quiet update, none for a notice present from the start.
- A message about one field stays on the field; a failed list or section load is a `StateMessage`.

### Toasts

Sonner, following the in-app theme: a `popover` surface in `text-body` with a medium title, a muted
description and `rounded-lg`; status toasts take that status's `-muted` field and colour. Action and
cancel buttons are `text-body-small` medium, 32px tall (44px on phones), actions outlined in the
toast's colour.

### Skeletons

`Skeleton`: a `muted` block with the control radius, sized as what it stands in for (Patterns).

## Patterns

### Status, loading and feedback

Top loading bar for route and data progress, skeletons for known shapes. A skeleton keeps its section's loaded size and static labels, and each section fills in
when its own data arrives, so nothing on screen moves as a page loads. An inline control whose
result shows where it was edited confirms in place (its own pending state and status line); toasts
carry failures, saves finished after a dialog closed, and outcomes the screen does not show. They
stack collapsed and use the library's default lifetime. Distinct states get distinct copy; never
imply data changed before the server confirms it. Which outcome gets an alert, a toast or neither:
`docs/frontend-conventions.md`.

### Empty and error states

Empty, not-found and failed loads use `StateMessage` (`src/components/shared/state-message.tsx`),
left-aligned like the record it stands in for: a round tile, a title, a muted description, an
optional detail line and the next action. Never centre the state or float a large icon on its own.

- **Tile.** Round, 40px on a page and 36px in a section, with a 20/18px glyph at stroke 2. Empty and
  not-found states use the leading transaction tile, as in the ledger rows. A failed load uses
  `destructive` at 10% for the field, 30% for the edge and full strength for the glyph. The glyph
  names the state (`CloudOff` for a server failure, `WifiOff` offline, `SearchX` no match,
  `FileQuestion` not found, the feature's own glyph for nothing yet), never the action; the rotate
  glyph belongs on Try again.
- **Sizes.** `page` replaces a list or page and is its own card (16px padding), with a
  `text-card-title` heading.
  `section` sits inside a card or dialog without a second frame, with a `text-body` medium title and
  small buttons, and keeps the section's loaded height. A one-line gap inside a list ("No recurring
  bills found yet.") stays plain muted text with no tile.
- **Detail.** A failed load adds one monospace `text-label` line with the status code (or "No
  response") and the time it failed: `503 · 14:02`. The 404 page shows `404 · <path>`.
- **Failed loads.** `LoadErrorState` derives the glyph, description and detail from the error and
  says "You're offline" when the device is. Try again hands back to the skeleton, or shows "Trying
  again…" while it waits for the connection. Extra ways out follow as ghost buttons.
- **Actions.** Outline buttons by default; a ghost button for a second, wider way out (Search all
  dates). The primary button appears only when the state carries the page's only action (Connect a
  bank, Create token).
- **First run.** A list's nothing-yet state may show three static, fading rows in the 60px row shape
  (`previewRows`), hidden from assistive technology and never pulsing.

### Navigation

Navigation is a quiet index with no breadcrumbs; the page title and the active item say where you
are. From `md` up the header carries the logo, Home, Connections and Transactions in `text-body`
with a `primary` underline on the active item, and an initials account menu (name, email, Settings, Log out) on the
right. Below `md` a four-tab bottom bar (Home, Connections, Transactions, Settings) keeps every
destination one tap away: icon over label, active tab in `primary` with a top rule and heavier
label, padded for the safe area. Toasts sit above it.

Settings is one page titled "Settings" with text section tabs (Account, Security, Integrations,
Appearance) on a bottom rule inside the `40rem` column: all four fit narrow phones, sharing the full
width with 48px targets in `text-body` (`text-body-small` below 360px); desktop tabs stay
content-sized. The active section gets the same `primary`
underline as the header; no icons, no side column, no segmented control.

### Settings lists and forms

Under the tabs, settings are grouped rows: a `text-card-title` group heading, then one bordered
list of `divide-y` rows at least 64px tall with 16px sides (a `text-body` medium label over a muted
`text-body-small` value, and a small outline action of a shared minimum width), the same pattern as
bank account lists. Groups sit 12px apart. Row actions stay visible without hover. Edits open a responsive
overlay with an explicit Save: a bottom drawer on phones and a dialog on desktop. Session and
access-token details use the same responsive presentation. Account deletion is its own one-row group
with an outline button; destructive actions use the shared destructive variant. Selected values (the
theme picker) use a `primary` ring, never the navigation underline.

## Writing

Wording follows `docs/product-ui-rules.md` and `docs/frontend-conventions.md`. Empty and error
titles say what failed, in sentence case with no final period ("Couldn't load transactions");
descriptions give the cause in plain words and never reassure about what obviously did not change. A
filtered-empty state quotes the search and points at the filter chips.
