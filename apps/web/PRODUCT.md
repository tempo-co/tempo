# Product

## Users

Tempo is for anyone with accounts at a bank Enable Banking covers, in any country; sign-up is open. Each user owns their account and its data and may use several bank accounts and devices. Success means being able to pull up current banking information whenever needed and use it to understand spending and financial habits.

## Product Purpose

Tempo is a personal finance application for tracking real financial data across connected bank accounts. It should make current account information, balances, and transactions easy to retrieve and inspect, then support richer understanding through transaction categorization with user-controlled manual correction, and spending and habit statistics.

The product is useful when it gives each user a dependable, always-available view of their finances.

## Positioning

Tempo is a read-only financial record for each user, on any of their devices. It takes real bank data two ways. Live sync through Enable Banking is the main path where it is available, because it stays current by itself. Statement files the user imports are the other path: for history that sync does not reach, and for banks or accounts without live sync. An account can have either or both.

## Operating Context

- Enable Banking is the live-sync integration. Its UK coverage is weak; don't assume it.

## Capabilities and Constraints

- Banking connects real bank accounts through Enable Banking, syncs them in the background and shows read-only transaction lists and details with automatic category suggestions and manual correction.
- Opening the verified, signed-in app in the foreground refreshes eligible bank connections while saved data remains visible. Returning from a hidden app starts a fresh opening; route changes, ordinary focus, polling and reconnect do not trigger bank refreshes. The refresh runs quietly: there is no Refresh button and no inline progress or result text, and its outcome raises no toast of its own, since failed, incomplete and rate-limited syncs retry on their own; only shared problems such as a lost connection or an expired session do. The connection card shows expired consent at once, and a failing sync only once the bank has gone 24 hours without a fully successful sync, the same point at which the user is emailed. Foreground work stops when the app hides or the session changes; requests are never queued or automatically replayed. A completed refresh updates saved banking and derived financial views, including partial or failed ingestion.
- The application is read-only toward banks. Transaction categories are Tempo metadata and may be suggested automatically or corrected manually; Tempo must not initiate payments or mutate bank-account data.
- Statement file import sits behind `FILE_IMPORT_ENABLED` on the API (with it off, Connections shows nothing of it) and its column mapper behind `FILE_IMPORT_MAPPER_ENABLED`. Behavior: `apps/api/docs/file-import.md` and `docs/file-import.md`.
- Home answers where the user stands over the years from their history; it is not a general prediction engine.
- Merchant details total what was paid to a merchant or person, grouping merchant names that share an identified brand.
- Integrations provides expiring, revocable, read-only access tokens and a hosted Streamable HTTP MCP endpoint; clients connect with the server URL and a bearer token.
- Privacy, security, and financial-data correctness take priority over growth.
- Currency scope and the accessibility target are open decisions.

## Brand Commitments

- The product is named **Tempo**.
- The brand identity (name, logo, palette, typography) is defined in `DESIGN.md`, which is the binding reference for visual work.
- Tempo has no legal, testimonial, customer, benchmark, or other proof assets. Never fabricate them.

## Product Principles

- Bank sync is authoritative and never asks the user about what it fetched; questions to the user concern only rows from imported files.
- Recurring payments keep merchant identity apart from payment-stream continuity: no fuzzy name matching, alias registry, merchant-specific code or manual combine control.
- Notifications interrupt only for what the user must act on now: push covers bank re-authorization and stopped sync. Tempo sends no spending, large-transaction, low-balance, budget or digest alerts.
- Settings and Profile have no data-cleanup controls.
- Public copy outside the app addresses the whole EU, leads with product value rather than privacy, and never names a specific bank.
- Never imply bank coverage, financial insight, or prediction quality that the integration and data cannot support.

## Accessibility & Inclusion

No product-specific accessibility standard or user need is set; the target standard is an open decision. Interface work preserves standard web accessibility and usable access across personal devices.
