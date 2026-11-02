# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the individual owner of the instance. Tempo is used for personal finances across multiple bank accounts and multiple devices. Success means being able to pull up current banking information whenever needed and use it to understand spending and financial habits.

## Product Purpose

Tempo is a personal finance application for tracking real financial data across connected bank accounts. It should make current account information, balances, and transactions easy to retrieve and inspect, then support richer understanding through transaction categorization with owner-controlled manual correction, spending and habit statistics, and future predictions.

The product is useful when it gives the owner a dependable, always-available view of their finances without requiring manual statement files or a broad-market financial product workflow.

## Positioning

Tempo is intended to be a private, read-only financial record for one person: real bank data is synchronized through Enable Banking rather than uploaded as statements, and the app is intended to run continuously under the owner's control and remain accessible from their own devices.

## Operating Context

- The intended deployment is a self-hosted, continuously running instance on a machine controlled by the owner, if that remains viable long term.
- The app should be reachable from multiple personal devices, including a phone, so banking information is available on demand.
- If the machine is not a viable long-term host, moving to cloud hosting remains an open fallback with additional security implications.
- Enable Banking is the intended bank-data integration. European bank coverage is relevant; UK support is currently understood to be weak or unavailable and must not be assumed.

## Capabilities and Constraints

- The current frontend supports email/password authentication, email verification, password recovery, account details, security/session controls, and appearance settings.
- The current banking flow connects real bank accounts through Enable Banking, retrieves accounts and balances, synchronizes them automatically in the background (right after authorization, then on a recurring schedule), and provides searchable, filterable, sortable, paginated, read-only transaction lists and detail views with automatic category suggestions and manual correction.
- Opening the verified, signed-in app in the foreground refreshes eligible bank connections while saved data remains visible. Returning from a hidden app starts a fresh opening; route changes, ordinary focus, polling and reconnect do not trigger bank refreshes. The refresh runs quietly: there is no Refresh button and no inline progress or result text; failed, incomplete or rate-limited refreshes and lost connections raise a toast, and the connection card shows expired consent and problem sync states. Foreground work stops when the app hides or the session changes; requests are never queued or automatically replayed. A completed refresh updates saved banking and derived financial views, including partial or failed ingestion.
- The application is read-only toward banks. Transaction categories are Tempo metadata and may be suggested automatically or corrected manually; Tempo must not initiate payments or mutate bank-account data.
- Bank-statement upload is outside the current product; Enable Banking synchronization supplies bank data.
- Home provides weekly/monthly/yearly cash flow, balance history, category spending, top merchants against their usual, recurring bills and income, account balances, recent transactions and review counts. Recurring-payment details link to their underlying transaction history. These are history-based views, not a general prediction engine.
- Merchant pages total what was paid to a merchant or person all time and per week, month or year, grouping merchant names that share an identified brand; they open from a transaction's details, the Home card or the searchable merchants list.
- Integrations provides expiring, revocable, read-only access tokens and a hosted Streamable HTTP MCP endpoint; clients connect with the server URL and a bearer token. The stdio MCP package is an alternative for local clients.
- Privacy, security, and financial-data correctness take priority over growth or multi-tenant SaaS concerns.
- Exact long-term hosting, supported bank/country coverage, currency scope, and the accessibility target remain open decisions where the provider or product has not yet established them.

## Brand Commitments

- The product is named **Tempo**.
- The brand identity (name, logo, palette, typography) is defined in `DESIGN.md`, which is the binding reference for visual work.
- No legal, testimonial, customer, benchmark, or other proof assets were confirmed. Future work must not fabricate them.

## Evidence on Hand

- The implemented frontend feature areas are under `src/features/auth`, `src/features/banking`, and `src/features/settings`, with routes under `src/routes`.
- The backend in `apps/api` contains the Enable Banking integration and bank connection, account, balance, synchronization, and transaction services under `apps/api/src/app/modules`.
- The current repository contains authentication, bank connection, synchronization, balance history, cash-flow and category-spending views, recurring-payment discovery and review, transaction inspection and categorization, and hosted read-only MCP access. Dashboard components live under `src/features/dashboard`, and recurring-payment components live under `src/features/banking/components`.

## Product Principles

- Personal utility comes before broad-market product scope.
- Read-only behavior and accurate financial state are non-negotiable.
- Current multi-bank information should be quick to retrieve and straightforward to inspect.
- Keep financial data under the user's control wherever practical, while treating remote access as a security-sensitive capability.
- Never imply bank coverage, financial insight, or prediction quality that the integration and data can support.

## Accessibility & Inclusion

No product-specific accessibility standard or user need was confirmed during init. The target standard remains an open decision; future interface work should still preserve standard web accessibility and usable access across personal devices.
