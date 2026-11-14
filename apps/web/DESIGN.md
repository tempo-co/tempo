---
version: alpha
name: Tempo
description: A calm, considered interface for a private personal-finance overview and bank account tracker.
colors:
  # Brand palette (hex) + semantic tokens consumed by the app (HSL, theme-switched in src/index.css)
  ink: "#28252B"
  clay: "#BD654B"
  clay-strong: "#8F4032"
  paper: "#F6F1E8"
  fold-shadow: "#D9D2C6"
  night: "#17161B"
  clay-on-dark: "#E59A7B"
  primary: "hsl(17.5 67.1% 69%)"
  primary-foreground: "hsl(252 10.2% 9.6%)"
  light-primary: "hsl(9 48.2% 37.8%)"
  light-primary-foreground: "hsl(38.6 43.8% 93.7%)"
  background: "hsl(252 10.2% 9.6%)"
  surface: "hsl(260 9.1% 12.9%)"
  foreground: "hsl(38.6 31.8% 91.4%)"
  muted: "hsl(266.7 8.7% 20.2%)"
  muted-foreground: "hsl(36 9.2% 68%)"
  accent: "hsl(262.5 9.1% 17.3%)"
  border: "hsl(270 6.9% 22.7%)"
  secondary: "hsl(265.7 8.2% 16.7%)"
  secondary-foreground: "hsl(17.5 67.1% 69%)"
  success: "hsl(148 40% 55%)"
  success-foreground: "hsl(148 30% 12%)"
  warning: "hsl(36 70% 58%)"
  warning-foreground: "hsl(36 40% 12%)"
  info: "hsl(200 55% 62%)"
  info-foreground: "hsl(200 35% 12%)"
  destructive: "hsl(4 70% 66%)"
  destructive-foreground: "hsl(4 40% 12%)"
  chart-primary: "hsl(38 28% 80%)"
  chart-secondary: "hsl(36 6% 48%)"
  chart-secondary-edge: "hsl(36 6% 48%)"
  transaction-tile-field: "#352A28"
  transaction-tile-ink: "#E59A7B"
  transaction-tile-edge: "#59413A"
  light-transaction-tile-field: "#F1E3D8"
  light-transaction-tile-ink: "#8F4032"
  light-transaction-tile-edge: "#D0B8A9"
  scrim: "hsl(252 12% 3%)"
  light-scrim: "hsl(252 10.2% 9.6%)"
  light-background: "hsl(38.6 43.8% 93.7%)"
  light-surface: "hsl(42 55.6% 96.5%)"
  light-foreground: "hsl(270 7.5% 15.7%)"
  light-muted: "hsl(37.9 20% 81.4%)"
  light-muted-foreground: "hsl(33.7 7.8% 40%)"
  light-accent: "hsl(37.1 36.8% 88.8%)"
  light-border: "hsl(39.1 19.7% 77.1%)"
  light-secondary: "hsl(34.3 38.2% 89.2%)"
  light-secondary-foreground: "hsl(9 48.2% 37.8%)"
  light-success: "hsl(150 50% 27%)"
  light-success-foreground: "hsl(145 40% 95%)"
  light-warning: "hsl(34 80% 30%)"
  light-warning-foreground: "hsl(38 70% 95%)"
  light-info: "hsl(200 60% 33%)"
  light-info-foreground: "hsl(200 50% 96%)"
  light-destructive: "hsl(6 62% 42%)"
  light-destructive-foreground: "hsl(8 60% 96%)"
  light-chart-primary: "hsl(270 7% 30%)"
  light-chart-secondary: "hsl(37 16% 74%)"
  light-chart-secondary-edge: "hsl(37 12% 48%)"
typography:
  page-title:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
    letterSpacing: "-0.025em"
  section-title:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
  card-title:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
  caption:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1
  numeric:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontFeature: "tabular-nums"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "6px"
  surface: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  control: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "40px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
    padding: "20px; 24px from sm"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "1px 10px"
  alert:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  state-message:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
    padding: "20px; 24px from sm"
---

# Design System: Tempo

## Overview

Tempo is a private personal-finance overview and account tracker: balances,
transactions, categories, and cash movement in one calm view. The interface is quiet and
trustworthy, data-forward without density for its own sake, and distinctive through
proportion, spacing, and a small number of deliberate forms — never through effects.

The authenticated product is primarily an **Operate** experience: a screen should make the
current financial state, the next useful action, and the path to inspect detail obvious.
Make state, task, and next action clear before adding visual personality.

**The Quiet Signal Rule.** Tempo earns attention with hierarchy and relevance first. Color,
motion, and ornament are supporting signals, never the content of the screen.

## Colors

Dark, light, and system themes are first-class (`ThemeProvider` follows the system by default). Dark is a
warm Night canvas; light is warm Paper — the same clay identity in both, never a separate
product per theme.

### Brand palette

| Token | Hex | Role |
|---|---|---|
| Ink | `#28252B` | High-emphasis text and logo tile (light theme foreground) |
| Clay | `#BD654B` | Logo shadowed facets, large accent areas |
| Clay strong | `#8F4032` | Small accent text, controls, focus ring on light (`--primary` in light), logo deep facets |
| Paper | `#F6F1E8` | Light canvas, logo gem highlight |
| Fold shadow | `#D9D2C6` | Quiet supporting planes and borders only — never a drop shadow |
| Night | `#17161B` | Dark canvas |
| Clay on dark | `#E59A7B` | Accent plane, links, controls on dark (`--primary` in dark), logo lit facets |

Clay (mid tone) is for planes and large accents, never the default small-text color on light;
use Clay strong there. Clay strong on Paper and Clay on dark on Night both clear WCAG AA for
the uses listed above.

### Semantic status colors

- **Success** (`{colors.success}`): confirmed positive outcomes and positive monetary values.
- **Warning** (`{colors.warning}`): partial synchronization, expiring consent, non-failure attention.
- **Info** (`{colors.info}`): neutral progress or explanatory status.
- **Destructive** (`{colors.destructive}`): failed operations and irreversible actions.

Semantic colors are separate from the brand palette and must be paired with text, an icon, or
another non-color cue. They are tuned like the category palette, earthy and moderately
saturated, with separate light and dark values: brick red, ochre, slate blue and forest green.
The `*-foreground` tokens are the pale (light) or deep (dark) grounds of status toasts, and the
label on a destructive fill; never put a fixed white on a status fill. Never communicate
transaction direction, synchronization state, or error state by hue alone.

Every color pair the app renders clears WCAG AA in both themes: 4.5:1 for text, 3:1 for focus
rings, chart marks and category chip icons.

### Charts

Data series use `chart-primary` (Ink on light, warm Paper on dark) and `chart-secondary` (a
light warm tint on light, warm grey on dark), never Clay. The light tint stays quiet next to the
lead series, so its bars carry a 1px `chart-secondary-edge` outline that keeps them at 3:1 on the
card. Clay marks only the selected period or an action, so it keeps its
meaning on the dashboard. Chart colors come from tokens, never literals in components.

For transaction categorization, the category label, source (`Suggested by AI` or `Manual`), and
pending/failed status are secondary text signals. Always render those cues as
understandable text; never communicate a category or categorization state through color alone.

**The One Accent Rule.** Clay is scarce enough to remain meaningful. A screen has a clear
primary action or active state, not a clay wash.

## Typography

Inter is the product typeface, self-hosted as a variable font at weights 100–900. UI copy,
headings and money use Inter; the system monospace stack is only for identifiers such as IP
addresses and error codes.

The named styles are Tailwind utilities defined in `src/index.css` (`text-page-title`,
`text-section-title`, `text-card-title`, `text-label`, `text-caption`, `numeric`), so a change
there reaches every use. Use them instead of rebuilding a style from size and weight classes,
and don't introduce sizes outside this scale.

- **Page title** (`text-page-title`: `600`, `1.5rem`, `2rem`, `-0.025em`): one per page,
  including error and auth pages.
- **Section title** (`text-section-title`: `600`, `1.125rem`, `1.35`): dialog and drawer
  titles, detail views.
- **Card title** (`text-card-title`: `600`, `1rem`, `1.5`): card and settings-group headings,
  empty and error states.
- **Body** (`400`, `1rem`, `1.5`): primary copy.
- **Body small** (`text-sm`: `400`, `0.875rem`, `1.5`): supporting descriptions, table content,
  status rows.
- **Label** (`text-label`: `500`, `0.75rem`, `1.333`): metadata, field labels, compact status.
- **Caption** (`text-caption`: `0.6875rem`, `1`): bottom tab labels and chart axis ticks only,
  where space is fixed.
- **Numeric** (`numeric`: Inter with tabular figures): currency amounts and rates, so digits
  line up in columns and look the same on every device.

**The Plain Number Rule.** Monetary values and dates stay easy to scan, compare, and copy.

## Layout

The authenticated shell is a sticky `48px` header aligned to the ~`80rem` content column;
below `md`, navigation moves to a fixed bottom tab bar. Settings uses a ~`40rem` reading
column. From `md` up, the page reserves the scrollbar's gutter, so the column stays put
between short and long pages and when a dialog locks scrolling. Every page title starts at
the top of that column (Home, which has none, starts its content there), and an action
beside a title overhangs the title's row instead of making it taller, so titles and the
content under them don't move between pages. Spacing follows a 4px rhythm: `8px` compact
controls, `12px` control padding, `16px` related content, `24px` between groups, `32–48px`
section breaks. Responsive behavior is structural, not scaled: navigation becomes a tab bar,
tables scroll horizontally (or, when a phone needs only their latest column, become rows
that open in place into the rest), rows stay understandable without hover.

Empty, loading, error, syncing, and filtered-empty states belong to the layout with a clear
next step.

**The Record Before Ornament Rule.** The financial record is the visual subject. No
decorative headers, metric-tile mosaics, or hero space before the data.

## Elevation & Depth

Mostly flat tonal layering: page field, surfaces, accent washes, borders, whitespace. Cards
keep `shadow-xs`; overlays (dialogs, popovers, drawers) may lift. Modal backdrops are the Night
`scrim` at 60% on light (Night) and 85% on dark (a deeper Night, since the dark page is
already Night), never pure black. Focus rings are functional emphasis. No glow,
glass, backdrop blur, or nested shadows. Resting content stays quiet.

## Shapes

Corners are soft: `--radius` is `8px` and `--card-radius` is `12px`. Controls (buttons, inputs,
selects, toggles, menus, tooltips) use `rounded-md` (6px), items inside a menu or popover
`rounded-sm` (4px), and surfaces (cards, dialogs, the top of phone drawers) `rounded-card` (12px).
A joined segmented control rounds its outer group and clips square segments inside it. Pills
remain reserved for badges, compact statuses, and avatars. Use 1px borders where a boundary
improves scanning. Keep corners consistent within a component family.

## Logo

The logo is the icon-only Tempo mark in `src/assets/logo.tsx`: a faceted crown with three points
over a band, a small cut gem set in an Ink diamond at its centre, on an Ink tile. The crown is
straight-edged flat planes lit from the upper left: Clay on dark (`#E59A7B`) on lit faces, Clay on
shadowed faces, Clay strong (`#8F4032`) on the deepest faces and the band's underside, and one
Paper facet on the gem. On a 24-unit grid the tile is 19×19 with radius 4.16. The layers paint over
a Clay strong underlay so facet joins never show the tile. It is flat: no gradients, shadows or outlines,
and the tile is the same in light and dark themes. Do not add text to the mark, recolor it per
theme, or decorate it. Every icon uses the same drawing: the PWA icons on the inset tile;
`favicon.svg` and the 16–48 px favicons on a larger 23-unit tab tile so the crown still reads at
16 px; `apple-touch-icon` and the maskable icons full-bleed, with the maskable glyph kept inside
the 40% safe circle. All icons live under `public/` with
`manifest.webmanifest`; see `index.html` for the wiring.

## Components

### Buttons

Compact and action-oriented; default ~40px tall (36 small / 44 large), 16px icons with 8px
gap, specific labels ("Connect a bank", "Re-authorize"). Phone and coarse-pointer targets
are at least 44px. Primary uses Clay strong with a Paper label on light, and Clay on dark
with a Night label on dark. Ghost uses the accent wash
only on hover/focus/active. Destructive buttons carry a `destructive-foreground` label.
Disabled and pending states preserve the label's meaning and pair motion with text
("Connecting...").

**Focus.** Every interactive control shows the same focus indicator on `:focus-visible`: a
solid 2px outline in the ring token, offset 2px (`outline-2 outline-offset-2 outline-ring`).
Where the control fills its container (nav tabs, rows), the outline sits inside instead
(`-outline-offset-2`). Use outlines, not box-shadow rings, for focus; they survive forced-colors
mode. A box-shadow ring marks a selected value (the theme picker's clay ring), never focus.

### Cards and grouped surfaces

Cards group information that belongs together — a bank connection or a transaction detail
reads as one record. `rounded-card`, surface color, quiet rule, `shadow-xs`, 20px padding
(24px from `sm`), with a `text-card-title` heading. Avoid statistic-tile collections.

### Inputs and fields

~40px high, page-field background, 1px rule, control radius, `8px 12px` padding. Focus uses
the shared outline; errors pair the destructive color with a plain-language message on the
field.

### Tables and transaction rows

Quiet headers, dividers only for row scanning, right-aligned `numeric` amounts, long
descriptions truncated but inspectable. Rows that navigate show a keyboard-visible focus
state. Status text stays understandable without color.

Every transaction and recurring row starts with a round `36px` Clay tile: the merchant's
monochrome alpha logo when available, otherwise the category glyph (the activity glyph for own
transfers and currency exchanges). Rows stay `60px` tall, plus any `1px` divider; the transaction
inspector keeps its `40px` tile. All leading tiles share these theme tokens:

| Token | Light | Dark |
|---|---|---|
| `transaction-tile-field` | `#F1E3D8` | `#352A28` |
| `transaction-tile-ink` | `#8F4032` | `#E59A7B` |
| `transaction-tile-edge` | `#D0B8A9` | `#59413A` |

The API's `mask-v2` derivative supplies a centred mark of at most `104px` on a `128px` canvas.
The shared `MerchantLogoTile` tints its continuous alpha with the ink token; theme changes reuse
the loaded image. Missing or failed derivatives fall back to the matching Clay glyph, including
when an older API does not expose the derivative. A changed source version retries the image.
Small text or fine detail can be lost in monochrome at tile size; there are no per-merchant
exceptions. Logos are display only: names, identification and sourcing stay unchanged.
Ordinary category metadata, labels and filters keep their category colors; financial-status
colors keep their semantics.

### Status, loading, and feedback

Top loading bar for route/data progress, skeletons for known shapes, toasts for background
outcomes. A skeleton keeps its section's loaded size and static labels, and each section fills in
when its own data arrives, so nothing on screen moves as a page loads. An inline control whose
result shows where it was edited confirms in place (its own pending state and status line);
toasts carry failures, saves finished after a dialog closed, and outcomes the screen does not show.
They stack collapsed and use the library's default lifetime. Distinct states get distinct copy;
never imply data changed before the server confirms it. Motion is brief (0.2–0.3s), subtle,
reduced-motion aware; never animate financial values continuously.

### Alerts

An inline message about the thing it sits in, such as a refused import, a bank that needs
re-authorizing or a save that failed, is an `Alert` (`src/components/ui/alert.tsx`), never a
hand-styled box or a bare line of red text. It is a 1px bordered block at control radius,
`10px 12px` padding: a leading 16px glyph, a `text-sm` medium title, a muted `text-sm`
description, and its actions under the text on phones and to the right from `sm` up.

- **Variants.** `default` (surface field, muted glyph) explains or offers a next step;
  `warning` (warning edge at 40%, field at 5%, warning glyph) is attention that is not a
  failure; `destructive` (the same in destructive) is a refusal or a failed operation. Text
  stays in the foreground and muted colours, so the glyph and the edge carry the tone.
- **Glyph.** Names the subject (`FileX` a refused file, `Clock` consent ending, `CloudOff` a
  failed load), not the tone alone.
- **Announcing.** It has no live-region role by default: `role='alert'` for a message that
  appears in answer to the owner, `role='status'` for a quiet update, none for a notice present
  from the start.
- A message about a single field stays on the field; toasts carry outcomes the screen does not
  show; a list or section that failed to load is a `StateMessage` (below).

### Empty and error states

Empty, not-found and failed loads use `StateMessage` (`src/components/shared/state-message.tsx`),
left-aligned like the record it stands in for: a round tile, a title, a muted description, an
optional detail line and the next action. Never centre the state or float a large icon on its own.

- **Tile.** Round, 40px on a page and 36px in a section, with a 20/18px glyph at stroke 2. Empty and
  not-found states use the transaction tile tokens, the same Clay tile as the ledger rows. A failed
  load uses `destructive` at 10% for the field, 30% for the edge and full strength for the glyph.
  The glyph names the state (`CloudOff` for a server failure, `WifiOff` offline, `SearchX` no match,
  `FileQuestion` not found, the feature's own glyph for nothing yet), never the action; the rotate
  glyph belongs on Try again.
- **Sizes.** `page` replaces a list or page and is its own card, with a `text-card-title` heading.
  `section` sits inside a card or dialog without a second frame, with a `text-sm` medium title and
  small buttons, and keeps the section's loaded height. A one-line gap inside a list ("No recurring
  bills found yet.") stays plain muted text with no tile.
- **Copy.** The title says what is missing or failed, in sentence case with no final period:
  "Couldn't load transactions". The description gives the cause in plain words, or what fills the
  space ("They appear here once your banks finish their first sync."); never reassure about what
  obviously did not change. A filtered-empty state quotes the search and points at the filter chips above it.
- **Detail.** A failed load adds one monospace `text-label` line with the status code (or "No
  response") and the time it failed: `503 · 14:02`. The 404 page shows `404 · <path>`.
- **Failed loads.** `LoadErrorState` derives the glyph, description and detail from the query's
  error and says "You're offline" when the device is. Try again usually hands back to the section's
  loading skeleton; while a retry waits for the connection, the button itself shows "Trying again…"
  with a spinner. Extra ways out, such as Clear filters, follow it as ghost buttons.
- **Actions.** Outline buttons by default; a ghost button for a second, wider way out (Search all
  dates). The primary Clay button appears only when the state carries the page's only action
  (Connect a bank, Create token).
- **First run.** A list's nothing-yet state may show three static rows in the 60px row shape under
  the message (`previewRows`), fading out. They never pulse, so they cannot read as loading, and
  they are hidden from assistive technology. Only lists get them.

### Navigation

Navigation is a quiet index with no breadcrumbs; the page title and the active item say
where you are. From `md` up the header carries the logo, Home, Connections and Transactions
with a clay underline on the active item, and an initials account menu (name, email,
Settings, Log out) on the right. Below `md` a four-tab bottom bar (Home, Connections,
Transactions, Settings) keeps every destination one tap away: icon over label, active tab in
clay with a top rule and heavier label, padded for the safe area. Toasts sit above it.

Settings is one page titled "Settings" with a row of text section tabs (Account, Security,
Integrations, Appearance) on a bottom rule inside the `40rem` column, at every width. Compact
spacing and labels keep all four tabs visible on narrow phones, sharing the full width with
48px targets and centered labels; desktop tabs stay content-sized. The active section
gets the same clay underline as the header; no icons, no side column, no segmented control.
Under the tabs, settings are grouped rows: a small group heading, then one bordered list of
`divide-y` rows (label, muted value, small outline action of a shared minimum width), the
same pattern as bank account lists. Row actions stay visible without hover. Edits open a
responsive overlay with an explicit Save: a bottom drawer on phones and a dialog on desktop.
Session and access-token details use the same responsive presentation. Account deletion is its
own one-row group with an outline button; destructive actions use the shared destructive
variant. Selected values (the theme picker) use a clay ring, never the navigation underline.

### File import

Statement file import lives on Connections, and only while the deployment has it on: the import
list answering is the switch, and until it does the page shows nothing of it. Bank sync stays
the page's primary action. **Import a file** is the outline button beside **Connect a bank**
(the two share the row under the title on phones, equal width), and the empty page offers both.
No copy calls import a fallback or assumes a bank is connected.

- **Drop area.** On fine pointers: a 160px area with a dashed 1px rule at control radius, the
  `FileUp` Clay tile, "Drop statement files here", a muted "or" and an outline **Choose files**.
  Drag-over turns the rule to the ring token and the field to the accent wash. Phones and touch
  screens get the button alone, full width. The picker accepts any extension, since banks name
  their exports oddly. Files dragged anywhere over Connections show a full-column overlay (dashed
  2px ring rule, page-field wash, "Drop to import"); it is the only drop target outside the dialog.
- **One dialog.** Choosing, importing, the summary, the account question, the rows to check and
  the undo confirmation are steps of one `ResponsiveDialog`, with a scrolling body and a footer
  that stays in reach. It never closes by itself. Closing it does not cancel an upload; the
  outcome then arrives as a toast (View reopens the summary). Focus returns to Import a file.
- **Refusals.** A drop is all or nothing, so a refusal is a `destructive` `Alert` whose
  description ends with "Nothing was imported." It sits at the end of the choose step, under
  Supported files, and names the refused file when the drop held several. An offer to work out
  a file's columns is a `default` Alert, and every answer from working them out is shown the
  same way; the footer carries the action. A choice over a drop's limits (20 files, 10 MB each,
  25 MB together) is refused the same way before anything is uploaded. A failed request is a
  `destructive` Alert in the same place with the cause, the status line and Try again.
- **Summary.** Counts as a bordered `divide-y` list with `numeric` values (the count that needs a
  look in `warning`), the date range, and the accounts the import went to. A drop that added
  nothing shows the `CheckCheck` state instead of the counts.
- **Account question.** Native radio rows, so arrow keys move between them; nothing is
  preselected, and Import stays disabled until every question has an answer. Each row starts
  with its bank's logo as on its Connections card (imported files: the `Files` Clay tile) and a
  small round account-type tile on its corner as on its Connections row; a new account gets the
  `Plus` Clay tile in the same square.
- **Balances.** The amount field shows its currency inside at the far right, over padding the
  value scrolls short of. Save sits under the field: in the summary on its own row, in the
  Add/Edit balance dialog in its footer with Cancel.
- **Rows to check.** Each file row (the `FileQuestion` tile) and the stored rows it could be form one
  bordered block: one radio choice between those rows and "It's a new transaction", nothing
  preselected. Radios take the tile's lead column and amounts share one right-aligned column, with
  nothing after them; each stored row says how its day sits against the file row's ("2 days
  later"). Choices change freely until Save, which stays in reach under the list and sends only the
  rows with one. A saved answer is final and collapses its block to one muted line; a failed one
  stays open with its choice and an error line.
- **Imports list.** Under the connection cards once an import exists: a small heading, then one
  bordered `divide-y` list, newest first, five rows before Show all. A row reads "3 files · 212
  new" over the day, the accounts and any rows still to check (attention tone), with an
  always-visible outline Undo named with its date. An undone import stays listed, muted, without
  the button. Undo confirms with the destructive variant and says what goes and what stays.
- **Imported files.** The imported-files connection uses the bank card with the `Files` Clay tile
  and "From statement files". It never shows consent, sync or re-authorization states, and its
  Details hold the accounts and Remove only.

## Do's and Don'ts

### Do:

- Make state, task, and next action clear before visual personality.
- Treat Clay as a scarce, meaningful signal on a paper/ink field.
- Verify dark, light, and system themes, keyboard focus, reduced motion, and narrow widths
  before calling a surface finished.
- Use real product terminology and honest data states; label synthetic data as synthetic.

### Don't:

- Don't use blue/violet gradients, glassmorphism, glowing borders, or metric-tile rows.
- Don't make every section a card or every action a pill.
- Don't introduce a second accent color or decorative gradients without a product reason.
- Don't fabricate balances, transactions, financial claims, or synchronization outcomes.
- Don't change typography, the radius vocabulary, or theme behavior as a side effect.
