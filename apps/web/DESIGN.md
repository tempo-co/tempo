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
  primary: "hsl(9 48.2% 37.8%)"
  primary-foreground: "hsl(38.6 43.8% 93.7%)"
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
  control: "0px"
  surface: "0px"
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
  empty-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
    padding: "64px 24px"
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
| Ink | `#28252B` | High-emphasis text and mark face (light theme foreground) |
| Clay | `#BD654B` | Offset plane, large accent areas |
| Clay strong | `#8F4032` | Small accent text, controls, focus ring on light (`--primary` in light) |
| Paper | `#F6F1E8` | Light canvas, inverse logo field |
| Fold shadow | `#D9D2C6` | Quiet supporting planes and borders only — never a drop shadow |
| Night | `#17161B` | Dark canvas |
| Clay on dark | `#E59A7B` | Accent plane, links, controls on dark (`--primary` in dark) |

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
  titles, detail views, empty states.
- **Card title** (`text-card-title`: `600`, `1rem`, `1.5`): card and settings-group headings.
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
column. Spacing follows a 4px rhythm: `8px` compact controls, `12px` control padding, `16px`
related content, `24px` between groups, `32–48px` section breaks. Responsive behavior is
structural, not scaled: navigation becomes a tab bar, tables scroll horizontally, rows stay
understandable without hover.

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

Controls and surfaces use the theme's square `0px` radius. Pills remain reserved for badges,
compact statuses, and avatars. Use 1px borders where a boundary improves scanning. Keep corners
consistent within a component family.

## Logo

The logo is the icon-only Tempo mark in `src/assets/logo.tsx`: two flat offset planes with an
upper-right seam, built on a 24-unit grid (face 19×19, corner radii 2.6/1.6; offset plane
7.3×7.2; seam 2.1 wide). The face uses `currentColor` and the seam the background token, so
the mark adapts to light and dark automatically. Do not add text to the mark, redraw it per
surface, or decorate it. Favicon and installed-app icons live under `public/` with
`manifest.webmanifest`; see `index.html` for the wiring.

## Components

### Buttons

Compact and action-oriented; default ~40px tall (36 small / 44 large), 16px icons with 8px
gap, specific labels ("Connect a bank", "Re-authorize"). Primary uses Clay strong with a
Paper label on light, and Clay on dark with a Night label on dark. Ghost uses the accent wash
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

### Status, loading, and feedback

Top loading bar for route/data progress, skeletons for known shapes, toasts for background
outcomes. An inline control whose result shows where it was edited confirms in place (its own
pending state and status line); toasts carry failures, saves finished after a dialog closed,
and outcomes the screen does not show. They stack collapsed and use the library's default
lifetime. Empty and failed loads use the one `EmptyState` component: a framed card with a 48px
icon, a `text-section-title` heading, a muted description and the next action. `tone='error'`
marks a failed load with a destructive icon; inside a dialog it drops its frame. Distinct states get distinct copy; never imply data changed before the server
confirms it. Motion is brief (0.2–0.3s), subtle, reduced-motion aware; never animate
financial values continuously.

### Navigation

Navigation is a quiet index with no breadcrumbs; the page title and the active item say
where you are. From `md` up the header carries the logo, Home, Connections, Transactions and
Recurring with a clay underline on the active item, and an initials account menu (name, email,
Settings, Log out) on the right. Below `md` a five-tab bottom bar (Home, Connections,
Transactions, Recurring, Settings) keeps every destination one tap away: icon over label, active tab in
clay with a top rule and heavier label, padded for the safe area. Toasts sit above it.

Settings is one page titled "Settings" with a row of text section tabs (Account, Security,
Integrations, Appearance) on a bottom rule inside the `40rem` column, at every width. Compact
spacing and labels keep all four tabs visible on narrow phones. The active section
gets the same clay underline as the header; no icons, no side column, no segmented control.
Under the tabs, settings are grouped rows: a small group heading, then one bordered list of
`divide-y` rows (label, muted value, small outline action of a shared minimum width), the
same pattern as bank account lists. Row actions stay visible without hover. Edits open a
dialog with an explicit Save. Account deletion is its own one-row group with an outline
button; destructive red appears only in the confirmation dialog. Selected values (the theme
picker) use a clay ring, never the navigation underline.

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
