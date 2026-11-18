# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tempo is for anyone with accounts at a bank Enable Banking covers, in any country; sign-up is open. Each user owns their account and its data and may use several bank accounts and devices. Success means being able to pull up current banking information whenever needed and use it to understand spending and financial habits.

## Product Purpose

Tempo is a personal finance application for tracking real financial data across connected bank accounts. It should make current account information, balances, and transactions easy to retrieve and inspect, then support richer understanding through transaction categorization with owner-controlled manual correction, spending and habit statistics, and future predictions.

The product is useful when it gives each owner a dependable, always-available view of their finances.

## Positioning

Tempo is a read-only financial record for each owner, always running and reachable from their own devices. It takes real bank data two ways. Live sync through Enable Banking is the main path where it is available, because it stays current by itself. Statement files the owner imports are the other path: for history that sync does not reach, and for banks or accounts without live sync. An account can have either or both.

## Operating Context

- Production is one continuously running deployment, and every merge to `main` ships to it without a separate approval (`docs/adr/`).
- The app is reachable from phones and other devices, so banking information is available on demand.
- Enable Banking is the live-sync integration. UK support is currently understood to be weak or unavailable and must not be assumed.

## Capabilities and Constraints

- The current frontend supports email/password authentication, email verification, password recovery, account details, security/session controls, and appearance settings.
- The current banking flow connects real bank accounts through Enable Banking, retrieves accounts and balances, synchronizes them automatically in the background (right after authorization, then on a recurring schedule), and provides searchable, filterable, sortable, read-only transaction lists that load more in place, grouped by day, and detail views with automatic category suggestions and manual correction.
- Opening the verified, signed-in app in the foreground refreshes eligible bank connections while saved data remains visible. Returning from a hidden app starts a fresh opening; route changes, ordinary focus, polling and reconnect do not trigger bank refreshes. The refresh runs quietly: there is no Refresh button and no inline progress or result text, and its outcome raises no toast of its own, since failed, incomplete and rate-limited syncs retry on their own; only shared problems such as a lost connection or an expired session do. The connection card shows expired consent at once, and a failing sync only once the bank has gone 24 hours without a fully successful sync, the same point at which the owner is emailed. Foreground work stops when the app hides or the session changes; requests are never queued or automatically replayed. A completed refresh updates saved banking and derived financial views, including partial or failed ingestion.
- The application is read-only toward banks. Transaction categories are Tempo metadata and may be suggested automatically or corrected manually; Tempo must not initiate payments or mutate bank-account data.
- Statement file import sits behind a deployment switch (`FILE_IMPORT_ENABLED` on the API); with it off, Connections shows nothing of it. With it on, Connections imports the statement files the owner chooses or drops. A drop is all or nothing; rows already in Tempo are skipped, rows that may be duplicates wait for the owner to check them, the owner says which account a statement goes to when the file does not name one and the match is unsure, and an import can be undone. Accounts that files create sit under one imported-files connection, which has no consent or sync. Such an account takes its balance from the newest balance its files state, else from one the owner enters. With a second switch (`FILE_IMPORT_MAPPER_ENABLED`), a table in a layout Tempo does not know can have its columns worked out once by Tempo's AI service from masked samples; the owner confirms the result on their own rows and the layout is kept for that owner only. See `apps/api/docs/file-import.md`.
- Home answers where the owner stands over the years: the total balance and its change over a chosen span, the balance and what was kept each month, recurring bills and income, a year-by-year table, and spending by category and income by source as a month on average in each year. A month opens in a dialog over Home with its money in and out, where it went against the category's usual, its transactions, sources and biggest merchants. The navigation counts transactions that need review and flags banks that need attention. Recurring-payment details link to their underlying transaction history. These are history-based views, not a general prediction engine.
- Merchant details total what was paid to a merchant or person all time and per week, month or year, grouping merchant names that share an identified brand. They open in a dialog over Home (a drawer on phones) from a transaction's details, a month's biggest merchants or the searchable merchants list in the same dialog.
- Integrations provides expiring, revocable, read-only access tokens and a hosted Streamable HTTP MCP endpoint; clients connect with the server URL and a bearer token.
- Privacy, security, and financial-data correctness take priority over growth.
- Long-term hosting, currency scope, and the accessibility target remain open decisions.

## Brand Commitments

- The product is named **Tempo**.
- The brand identity (name, logo, palette, typography) is defined in `DESIGN.md`, which is the binding reference for visual work.
- Tempo has no legal, testimonial, customer, benchmark, or other proof assets. Never fabricate them.

## Evidence on Hand

- Frontend features are under `src/features`, routes under `src/routes`; backend modules are under `apps/api/src/app/modules`.

## Product Principles

- Automatic features use general, tested rules over stored transaction evidence, never exceptions for one person, merchant or account. Owner actions (category corrections, confirm or dismiss choices) are legitimate inputs.
- Bank sync is authoritative and never asks the owner about what it fetched; questions to the owner concern only rows from imported files.
- Recurring payments keep merchant identity apart from payment-stream continuity: no fuzzy name matching, alias registry, merchant-specific code or manual combine control.
- Notifications interrupt only for what the owner must act on now: push covers bank re-authorization and stopped sync. Tempo sends no spending, large-transaction, low-balance, budget or digest alerts.
- Settings and Profile have no data-cleanup controls.
- Public copy outside the app addresses the whole EU, leads with product value rather than privacy, and never names a specific bank.
- Read-only behavior and accurate financial state are non-negotiable.
- Current multi-bank information should be quick to retrieve and straightforward to inspect.
- Keep financial data under the user's control wherever practical, while treating remote access as a security-sensitive capability.
- Never imply bank coverage, financial insight, or prediction quality that the integration and data can support.

## Accessibility & Inclusion

No product-specific accessibility standard or user need is set; the target standard is an open decision. Interface work preserves standard web accessibility and usable access across personal devices.
