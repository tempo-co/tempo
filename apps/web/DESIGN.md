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
  success: "hsl(142 76% 36%)"
  success-foreground: "hsl(138 76% 13%)"
  warning: "hsl(32 95% 44%)"
  warning-foreground: "hsl(48 100% 13%)"
  info: "hsl(200 98% 39%)"
  info-foreground: "hsl(204 100% 13%)"
  destructive: "hsl(2 84% 31%)"
  destructive-foreground: "hsl(0 70% 13%)"
  light-background: "hsl(38.6 43.8% 93.7%)"
  light-surface: "hsl(42 55.6% 96.5%)"
  light-foreground: "hsl(270 7.5% 15.7%)"
  light-muted: "hsl(37.9 20% 81.4%)"
  light-muted-foreground: "hsl(33.7 7.8% 40%)"
  light-accent: "hsl(37.1 36.8% 88.8%)"
  light-border: "hsl(39.1 19.7% 77.1%)"
  light-secondary: "hsl(34.3 38.2% 89.2%)"
  light-secondary-foreground: "hsl(9 48.2% 37.8%)"
typography:
  page-title:
    fontFamily: "Lexend, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
  section-title:
    fontFamily: "Lexend, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Lexend, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Lexend, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Lexend, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
  numeric:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "10px"
  surface: "14px"
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
    padding: "24px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
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

Dark, light, and system themes are first-class (`ThemeProvider` defaults to dark). Dark is a
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
another non-color cue. Never communicate transaction direction, synchronization state, or
error state by hue alone.

**The One Accent Rule.** Clay is scarce enough to remain meaningful. A screen has a clear
primary action or active state, not a clay wash.

## Typography

Lexend is the product typeface, loaded locally at weights 100–900. UI copy uses Lexend; the
system monospace stack covers identifiers and currency amounts.

- **Page title** (`600`, `1.5rem`, ~`1.25`): major authenticated surfaces.
- **Section title** (`600`, `1.125rem`, ~`1.35`): meaningful subsections.
- **Body** (`400`, `1rem`, `1.5`): primary copy.
- **Body small** (`400`, `0.875rem`, `1.5`): supporting descriptions, table content.
- **Label** (`500`, `0.75rem`, ~`1.333`): metadata, field labels, compact status.
- **Numeric** (system mono, `1rem`): currency amounts, IDs, rates; tabular figures in columns.

**The Plain Number Rule.** Monetary values and dates stay easy to scan, compare, and copy.

## Layout

The authenticated shell is a collapsible ~`14rem` left rail plus a sticky low header; mobile
navigation is a ~`18rem` sheet. Content centers at ~`80rem`; settings uses a ~`40rem` reading
column. Spacing follows a 4px rhythm: `8px` compact controls, `12px` control padding, `16px`
related content, `24px` between groups, `32–48px` section breaks. Responsive behavior is
structural, not scaled: navigation becomes a sheet, tables scroll horizontally, rows stay
understandable without hover.

Empty, loading, error, syncing, and filtered-empty states belong to the layout with a clear
next step.

**The Record Before Ornament Rule.** The financial record is the visual subject. No
decorative headers, metric-tile mosaics, or hero space before the data.

## Elevation & Depth

Mostly flat tonal layering: page field, surfaces, accent washes, borders, whitespace. Cards
keep `shadow-sm`; overlays (dialogs, popovers, sheets) may lift. Focus rings are functional
emphasis. No glow, glass, backdrop blur, or nested shadows. Resting content stays quiet.

## Shapes

Two radius families: controls `10px` (`--radius`), cards `14px` (`rounded-card`). Pills are
reserved for badges, compact statuses, and avatars. Use 1px borders where a boundary improves
scanning. Keep corners consistent within a component family.

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
gap, specific labels ("Sync now", "Connect bank"). Primary uses Clay strong on light and Clay
on dark on dark with Paper foreground. Ghost uses the accent wash only on hover/focus/active.
Every interactive control has a visible `:focus-visible` ring using the ring token. Disabled
and pending states preserve the label's meaning and pair motion with text ("Syncing...").

### Cards and grouped surfaces

Cards group information that belongs together — a bank connection or a transaction detail
reads as one record. `rounded-card`, surface color, quiet rule, ~24px padding. Avoid
statistic-tile collections.

### Inputs and fields

~40px high, page-field background, 1px rule, control radius, `8px 12px` padding. Focus uses
the clay ring; errors pair the destructive color with a plain-language message on the field.

### Tables and transaction rows

Quiet headers, dividers only for row scanning, right-aligned monospace/tabular amounts, long
descriptions truncated but inspectable. Rows that navigate show a keyboard-visible focus
state. Status text stays understandable without color.

### Status, loading, and feedback

Top loading bar for route/data progress, skeletons for known shapes, toasts for background
outcomes. Distinct states get distinct copy; never imply data changed before the server
confirms it. Motion is brief (0.2–0.3s), subtle, reduced-motion aware; never animate
financial values continuously.

### Navigation

The sidebar is a quiet index: visible labels expanded, tooltips collapsed, modest active
wash, account menu at the bottom, mobile sheet with the same route labels and order.

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
