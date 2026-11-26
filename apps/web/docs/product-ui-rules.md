# Product UI rules

Standing rules for what Tempo's screens show and how they behave, for new and changed screens. Anything visual (colours, type, sizes, components and patterns) is in `DESIGN.md`, which wins where this file seems to disagree; shared code rules are in `docs/frontend-conventions.md`.

## Pages

- Each page answers one question. Home is for status: this month's spending against the usual pace, how far the imported data runs, and what to do next. Reports (cash flow, categories, year tables) belong in Insights, bills in Recurring, account management and imports in Accounts. Until Home and Insights get their own pages, both show the reports.

## Density and copy

- A lean dashboard: each number is shown once, with no repeated or decorative content. A new summary widget needs the decision it helps the user make.
- Glanceable headers use horizontal space: the headline on the left, a two-line comparison beside it.
- No explanatory sentences under charts and cards.
- An info icon only for a definition the screen cannot show (a formula, a computed rule such as "usual"), never to restate labels or the legend.
- Hide an empty-state card that has nothing to act on. On phones, also hide all-clear status lines; problems and expiring-consent warnings still show.
- Words over signed percentages: "€X now · €Y less than on <d Mon>", and nothing more. No caveats, not even conditional ones.
- Before rewording a headline figure, read how it is computed and make the words match what the chart shows.
- The offline indicator never covers UI: a small inline label with detail in a tooltip, never a floating or undismissable banner. No toast that blocks the screen or cannot be closed.

## Charts and periods

- Absolute, comparable views over relative ones: a fixed scale with even round ticks and headroom over the tallest bar.
- Every incomplete period (the running one, and one cut short by where history starts) is marked apart from complete ones and labelled "so far". Averages count complete periods only.
- Weekly comparisons use the median of earlier full weeks, since one rent week inflates the mean.
- Hide a header average while fewer than two full periods exist. Word it as the exact span plus money per period: "Per month, <Mon YYYY> – <Mon YYYY>: €X spent · €Y earned · €Z kept". Round each figure to the displayed unit before deriving "kept".
- Summary cards lead with figures that compare month to month ("Monthly bills", "Monthly income"), not countdowns that shrink to zero. Income is green with a +, costs stay neutral, and amber is only for problems.
- Wide tables do not just scroll sideways at 320 to 430 px: give them a phone form (one row per item with the latest value and change, older periods on tap). Desktop keeps the table.

## Lists and detail views

- One row spec per entity: anything standing for transactions uses the transaction row's height and tile size on every surface. Layout specs measure rows and tiles at 1440 and 390 px on each surface.
- A category keeps its own small icon beside its label, even when the row's tile shows a merchant logo.
- Fact grids are two lines: a label over one value. Fold secondary detail into the label ("Next · in 29 days"). A value that can grow without bound moves to a wrapping badge. Estimates are whole amounts.
- Detail views list their items inline, newest first, with Load more and the shared row, and keep the open entity in the URL (with `replace`).
- A row to check shows "To check" in the warning colour in place of a category: there is no guess to show.
- A page's rail shows the view's own cards while nothing is open (Transactions: the view's totals and the To check count). A step started in the details, such as updating other transactions, replaces them until it is saved or cancelled.
- Optional columns keep their grid track: render an empty cell so the next column starts at the same x in every state.

## Filters and pickers

- Parent and child checkboxes: the parent selects or clears all children and shows a mixed state when some are selected.
- Filters are removable chips with "+ Add filter" and Clear, kept in the address. An option list opened from a chip has exactly one scroll area; on phones it is one stepped bottom sheet at a fixed height, rows at least 44 px.
- A view of the rows that wait for the owner (To check) is a tab with its count beside All, not a filter chip.
- Long-list pickers (country, bank) on phones are one stepped bottom sheet with the likely value preselected and 56 px rows. Never auto-focus search, on any device.
- Restyle, don't replace: flags stay flags (small 4:3, small radius) and badges keep the pill radius.

## Loading

First load shows skeleton rows shaped like the real list. A refetch keeps the old rows and fades them after about 150 ms. Changing figures fade in as a whole line, never rolling digit by digit.

## Setup and settings pages

- A managed list comes first and one-time setup steps below it; setup copy never refers to where the list sits.
- Setup steps are terse, with only key terms in medium weight.
- Settings sections each have one address (`/settings/<section>`), listed on the left on desktop and as a tap-in list with a way back on phones. Sections whose feature has not shipped are not listed; announced ones show as disabled "later" rows.
- Settings › Categories lists every category with how many transactions it holds over the whole history, in either direction, as the Transactions category filter counts them; rows without a category follow while there are any.
