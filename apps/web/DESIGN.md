---
version: alpha
name: Flair
description: The Quiet Ledger — a private, dependable interface for understanding personal finances.
colors:
  primary: "hsl(240 60% 60%)"
  primary-foreground: "hsl(0 0% 93%)"
  background: "hsl(240 6% 7%)"
  surface: "hsl(220 6% 10%)"
  foreground: "hsl(220 9% 94%)"
  muted: "hsl(214 7% 19%)"
  muted-foreground: "hsl(220 9% 70%)"
  accent: "hsl(225 6% 14%)"
  border: "hsl(213 8% 28%)"
  secondary: "hsl(236 45% 27%)"
  secondary-foreground: "hsl(242 94% 94%)"
  success: "hsl(142 76% 36%)"
  success-foreground: "hsl(138 76% 13%)"
  warning: "hsl(32 95% 44%)"
  warning-foreground: "hsl(48 100% 13%)"
  info: "hsl(200 98% 39%)"
  info-foreground: "hsl(204 100% 13%)"
  destructive: "hsl(2 84% 31%)"
  destructive-foreground: "hsl(0 70% 13%)"
  light-background: "hsl(240 20% 99%)"
  light-surface: "hsl(240 20% 98%)"
  light-foreground: "hsl(210 13% 13%)"
  light-muted: "hsl(230 11% 89%)"
  light-muted-foreground: "hsl(210 13% 13%)"
  light-accent: "hsl(240 11% 95%)"
  light-border: "hsl(233 10% 82%)"
  light-secondary: "hsl(238 100% 95%)"
  light-secondary-foreground: "hsl(238 43% 27%)"
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
  micro: "0.8px"
  control: "2.8px"
  surface: "4.8px"
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

# Design System: Flair

## Overview

**Creative North Star: "The Quiet Ledger"**

Flair should feel like a private record that can be trusted: calm, legible, and deliberate. It is an instrument for understanding real personal finances, not a finance-themed marketing dashboard. The interface should reduce noise around high-stakes data and help someone understand state quickly without feeling surveilled, gamified, or pressured.

Preserve and sharpen the incumbent identity: dark-first with fully supported light and system themes, Lexend typography, indigo as the interaction signal, compact geometry, and shadcn/Radix primitives. Make the product feel distinctive through hierarchy, information architecture, copy, state design, and meaningful whitespace—not through decorative effects.

The authenticated product is primarily an **Operate** experience. A polished screen should make the current financial state, the next useful action, and the path to inspect detail obvious. Transaction tables, bank connections, synchronization feedback, settings, and future financial snapshots should feel like parts of one dependable record.

**Key Characteristics:**

- Quiet, private, and trustworthy.
- Data-forward without being dense for its own sake.
- Indigo signal on a neutral field.
- Mostly flat tonal layers with transient elevation.
- Precise numbers paired with plain-language status.
- Product-specific structure instead of generic SaaS decoration.

**The Quiet Signal Rule.** Flair earns attention with hierarchy and relevance first. Color, motion, and ornament are supporting signals, never the content of the screen.

## Colors

The default implementation is dark (`ThemeProvider` starts with `defaultTheme='dark'`), but light and system themes are first-class. Dark mode should feel like a quiet desk at night: deep, cool, and low-glare rather than black-and-neon. Light mode should retain the same calm indigo identity rather than becoming a separate product.

### Primary

- **Quiet Indigo** (`{colors.primary}`): The signature interaction color. Use for the primary action, active/focused states, the loading bar, selected navigation treatment, and other moments where the interface needs to say “this is live.”
- **Indigo foreground** (`{colors.primary-foreground}`): Text and icons placed directly on Quiet Indigo. Validate contrast whenever the accent or foreground is refined; do not introduce a second competing action color.

### Secondary

- **Night Lilac** (`{colors.secondary}`) and **Night Lilac foreground** (`{colors.secondary-foreground}`): Lower-emphasis action surfaces and supporting controls in the dark theme.
- **Day Lilac** (`{colors.light-secondary}`) and **Day Lilac foreground** (`{colors.light-secondary-foreground}`): The light-theme counterpart. Keep the role, not necessarily the visual weight, consistent across themes.

### Neutral

- **Night field** (`{colors.background}`): The default dark page and input background.
- **Night surface** (`{colors.surface}`): Grouped content surfaces such as cards and table headers.
- **Night ink** (`{colors.foreground}`): Primary text and high-emphasis icons.
- **Night quiet** (`{colors.muted}`) and **Night quiet ink** (`{colors.muted-foreground}`): Skeletons, secondary fills, metadata, and supporting copy.
- **Night accent wash** (`{colors.accent}`): Hover, selected, and open-state surfaces that should be visible without becoming a new focal point.
- **Night rule** (`{colors.border}`): Dividers and control borders. Lines should organize; they should not become a decorative grid.
- **Day field** (`{colors.light-background}`), **Day surface** (`{colors.light-surface}`), **Day ink** (`{colors.light-foreground}`), **Day quiet** (`{colors.light-muted}`), **Day quiet ink** (`{colors.light-muted-foreground}`), **Day accent wash** (`{colors.light-accent}`), and **Day rule** (`{colors.light-border}`): The light-theme semantic counterparts.

### Semantic status colors

- **Success** (`{colors.success}`): Confirmed positive outcomes and positive monetary values. The existing `CurrencyAmount` component uses it for positive amounts.
- **Warning** (`{colors.warning}`): Partial synchronization, expiring consent, and attention that is not a failure.
- **Info** (`{colors.info}`): Neutral progress or explanatory status.
- **Destructive** (`{colors.destructive}`): Failed operations and irreversible actions.

Semantic colors must be paired with text, an icon, or another non-color cue. Never communicate transaction direction, synchronization state, or error state by hue alone.

**The One Accent Rule.** Quiet Indigo is scarce enough to remain meaningful. Do not tint every card, icon, badge, link, and chart with it. A screen should have a clear primary action or active state, not an indigo wash.

## Typography

Lexend is the product typeface and is loaded locally at weights 100–900. Its rounded geometry gives Flair a human voice while remaining clear in dense financial data. Keep Lexend as the default unless a deliberate, user-approved identity change replaces it across the system.

Use weight and scale to establish hierarchy before introducing additional typefaces. The current interface uses Lexend for UI copy and the system monospace stack for identifiers and currency amounts (`font-mono`).

### Hierarchy

- **Page title** (`600`, `1.5rem`, approximately `1.25` line-height): The title of a major authenticated surface, such as Bank connections or Appearance.
- **Section title** (`600`, `1.125rem`, approximately `1.35` line-height): A meaningful subsection or grouped task.
- **Body** (`400`, `1rem`, `1.5` line-height): Primary explanatory copy and comfortable reading text.
- **Body small** (`400`, `0.875rem`, `1.5` line-height): Supporting descriptions, table content, and secondary controls.
- **Label** (`500`, `0.75rem`, approximately `1.333` line-height): Metadata, field labels, compact status context, and short uppercase balance labels. Use uppercase sparingly and never for full-sentence instructions.
- **Numeric / technical** (system monospace, `1rem`): Currency amounts, transaction IDs, rates, and other values where alignment or exact transcription matters. Prefer tabular figures for columns of numbers.

Use a little more space above a heading than below it. Avoid oversized “hero” typography in the authenticated app; the product is helping someone operate, not selling them an aspiration.

**The Plain Number Rule.** Monetary values and dates should be easy to scan, compare, and copy. Do not sacrifice legibility for a fashionable display treatment.

## Layout

Flair uses a two-part authenticated shell: a collapsible left navigation rail and a sticky, low-height page header. The expanded sidebar is approximately `14rem`; the collapsed icon rail is `3rem`; mobile navigation becomes a sheet approximately `18rem` wide. Preserve the sidebar's keyboard toggle and its mobile equivalent.

The main content is centered within an approximately `80rem` maximum width with compact horizontal padding and a generous vertical breathing rhythm (`32px` around the current body layout). Settings intentionally uses a narrower reading column of approximately `40rem`; dense transaction work may use the available width and should not be forced into a narrow card.

Use the existing spacing vocabulary as a 4px-based rhythm: `8px` inside compact controls, `12px` for control padding, `16px` for related content, `24px` between grouped components, and `32–48px` for meaningful section breaks. Prefer a small number of deliberate regions over a grid of equal cards.

Responsive behavior is structural, not merely scaled. At smaller widths, navigation becomes a sheet, settings navigation moves above the content, transaction tables may scroll horizontally, and rows must remain understandable without relying on hover. Never allow a desktop arrangement to become a cramped mobile collage.

For operational screens, establish the reading order before choosing containers: page title and purpose, primary action, filters or controls, the main data surface, then secondary detail. Empty, loading, error, syncing, and filtered-empty states belong to the layout and need a clear next step.

**The Record Before Ornament Rule.** The user's financial record is the visual subject. Do not spend the first viewport on decorative headers, generic statistic-card mosaics, or empty hero space when the task is to inspect or act on data.

## Elevation & Depth

The intended material is mostly flat tonal layering. Depth comes from the difference between the page field, grouped surfaces, accent washes, borders, and whitespace. Existing cards use a restrained `shadow-sm`; preserve it where the shared primitive currently supplies it, but do not compound it with additional glow, glass, backdrop blur, or nested shadows. New surfaces should prefer tonal separation first.

Transient elements may lift: dialogs, popovers, dropdowns, sheets, and other overlays can use stronger separation because they temporarily sit above the record. Focus rings are functional emphasis, not decoration. A shadow should answer “what is floating or needs separation?”; if the answer is nothing, omit it.

**The Flat-at-Rest Rule.** Resting content stays quiet. Elevation is reserved for interaction, containment that genuinely needs separation, and temporary surfaces.

## Shapes

The shape language is compact and lightly technical. The shared radius is `0.3rem` (`4.8px`), controls use the smaller derived control radius (`calc(0.3rem - 2px)`), and cards use the shared surface radius. Full pills are reserved for badges, compact statuses, and avatars—not for every button or container.

Use 1px borders where a boundary improves scanning. Keep corners consistent within a component family. Do not make Flair friendlier by rounding everything heavily; calm geometry and spacing should do that work.

Avoid glass panels, floating tiles, oversized rounded rectangles, ornamental outlines, and arbitrary corner variation. A new radius requires a component-level reason and should be added to the shared vocabulary rather than introduced as a one-off class.

## Components

### Buttons

Buttons are compact, direct, and action-oriented. The default control is approximately `40px` tall, with a `36px` small variant and an `44px` large variant where needed. Use 16px icons with an 8px gap. Keep labels specific: “Sync now,” “Clear filters,” and “Connect bank” are better than vague decorative actions.

- **Primary:** Quiet Indigo fill, light foreground, compact control radius. Use for the single most important action in a local surface.
- **Secondary:** Lower-contrast secondary fill for supporting actions.
- **Outline:** Page-field background with a 1px rule; use when the action needs a boundary but should not compete with primary.
- **Ghost:** No resting fill; use the accent wash only on hover, focus, active, or open states.
- **Hover / focus / active:** Prefer a restrained color shift or accent wash. Every interactive control must have a visible `:focus-visible` ring using the indigo ring token and a small offset. Do not use scale, glow, or bouncing as the default button response.
- **Disabled / pending:** Preserve the label's meaning while showing unavailable state. Pair loading motion with text such as “Syncing...” or “Connecting...”; do not leave a silent spinner.

### Cards and grouped surfaces

Cards group information that belongs together; they are not the default wrapper for every section. Use the surface color, a quiet rule, compact radius, and approximately `24px` internal padding. Keep related content in one clear hierarchy rather than splitting it into a collection of statistic tiles.

For bank connections, a connection is the meaningful unit: institution identity, authorization state, synchronization action, accounts, balances, and recent activity should read as one record. For transaction details, put the amount and state first, then organize supporting fields into a scannable detail grid.

### Inputs and fields

Inputs are approximately `40px` high, use the page field as their background, a 1px input rule, compact radius, and `8px 12px` internal padding. Placeholder text is quieter than entered text. Focus uses a visible indigo ring without changing the layout. Errors use the destructive semantic plus a plain-language message attached to the relevant field; disabled fields retain structure and show reduced emphasis.

Search, date, and account filters should sit close to the data they control. Preserve entered filters in the URL where the route already does so. Do not hide essential filtering behind an icon-only control on desktop.

### Tables and transaction rows

Tables are for comparison and review. Keep the header quiet, use dividers only to support row scanning, align amounts to the right, use monospace/tabular figures for comparable values, and let long descriptions truncate without hiding a way to inspect the full transaction. A table may scroll horizontally on small screens; it must not reduce financial values to unreadable fragments.

Rows that navigate must have an obvious interactive affordance and a keyboard-visible focus state, not only a hover tint. Badges are useful for transaction type and status, but status text must remain understandable without color. Filtered-empty states explain that the filters—not the bank connection—produced no results.

### Status, loading, and feedback

Use the existing top loading bar for route/data progress where it provides continuity, skeletons for content whose shape is known, and toasts for completed background outcomes. Loading, partial synchronization, failure, and cancellation are distinct states and should use distinct copy. Never imply that bank data changed before the server confirms it.

Motion should be brief and purposeful. Existing Framer Motion transitions around authentication and the logo can remain subtle. Prefer opacity, position, and size transitions in the `0.2–0.3s` range; respect `prefers-reduced-motion`. Do not animate financial values, table rows, or navigation continuously.

### Navigation

The sidebar is a quiet index, not a branded billboard. Keep labels visible when expanded, tooltips available when collapsed, and active state legible through a modest accent wash plus text/icon emphasis. The account menu belongs at the bottom and should expose settings and sign-out without visual drama. Mobile navigation uses the sheet pattern and preserves the same route labels and order.

## Do's and Don'ts

### Do:

- **Do** design for the Operate mode: make state, task, and next action clear before adding visual personality.
- **Do** use Quiet Indigo as a scarce, meaningful signal rather than a decorative palette wash.
- **Do** preserve Lexend, the compact radius vocabulary, and the dark/light/system theme model unless a deliberate identity change is approved.
- **Do** use tonal layering, whitespace, typography, and content structure to create distinction.
- **Do** make real financial data feel calm and inspectable: clear dates, aligned amounts, explicit status, and useful detail.
- **Do** design loading, empty, filtered-empty, error, unauthorized, syncing, partial, and success states as part of the feature.
- **Do** verify dark, light, and system themes, keyboard focus, reduced motion, and narrow mobile widths before considering a surface finished.
- **Do** use real product terminology and honest data states. If demonstration data is synthetic, label it rather than inventing financial claims.
- **Do** run a screenshot-based critique and a technical audit after implementation; fix the highest-impact findings in a bounded pass.

### Don't:

- **Don't** produce the recognizable AI-finance starter kit: purple/blue gradients, glassmorphism, oversized rounded cards, glowing borders, and a row of interchangeable metric tiles.
- **Don't** make every section a card or every action a pill. Containers must earn their boundaries.
- **Don't** introduce a second accent color, ornamental gradient, or decorative illustration without a product-specific reason.
- **Don't** use huge marketing-style hero sections inside authenticated workflows.
- **Don't** use color alone to communicate positive/negative amounts, transaction direction, bank status, errors, or warnings.
- **Don't** hide important information behind hover-only behavior, especially on transaction rows and mobile layouts.
- **Don't** fabricate balances, transactions, financial claims, customers, benchmarks, or synchronization outcomes.
- **Don't** change the product's typography, indigo identity, radius language, or theme behavior as a side effect of making one screen “more interesting.”
- **Don't** add motion, charts, gamification, or decorative density unless it improves a real user task.
