# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is the individual owner of the instance. Flair is used for personal finances across multiple bank accounts and multiple devices. Success means being able to pull up current banking information whenever needed and use it to understand spending and financial habits.

## Product Purpose

Flair is a personal finance application for tracking real financial data across connected bank accounts. It should make current account information, balances, and transactions easy to retrieve and inspect, then support richer understanding through transaction categorization, spending and habit statistics, and future predictions.

The product is useful when it gives the owner a dependable, always-available view of their finances without requiring manual statement files or a broad-market financial product workflow.

## Positioning

Flair is intended to be a private, read-only financial record for one person: real bank data is synchronized through Enable Banking rather than uploaded as statements, and the app is intended to run continuously under the owner's control and remain accessible from their own devices.

## Operating Context

- The intended deployment is a self-hosted, continuously running instance on a machine controlled by the owner, if that remains viable long term.
- The app should be reachable from multiple personal devices, including a phone, so banking information is available on demand.
- If the machine is not a viable long-term host, moving to cloud hosting remains an open fallback with additional security implications.
- Enable Banking is the intended bank-data integration. European bank coverage is relevant; UK support is currently understood to be weak or unavailable and must not be assumed.

## Capabilities and Constraints

- The current frontend supports email/password authentication, email verification, password recovery, account details, security/session controls, and appearance settings.
- The current banking flow connects real bank accounts through Enable Banking, retrieves accounts and balances, allows manual synchronization, and provides searchable, filterable, sortable, paginated, read-only transaction lists and detail views.
- The application is read-only. It must not initiate payments or mutate bank-account data.
- Bank-statement upload was removed because Enable Banking synchronization replaces that workflow. Do not reintroduce statement upload as a default solution.
- AI transaction categorization, spending insights, statistics about habits, and future predictions are future direction rather than current implemented capability.
- Privacy, security, and financial-data correctness take priority over growth or multi-tenant SaaS concerns.
- Exact long-term hosting, supported bank/country coverage, currency scope, and the accessibility target remain open decisions where the provider or product has not yet established them.

## Brand Commitments

- Flair is the current working name.
- The existing product identity is not yet binding; the name and identity may change soon.
- No legal, testimonial, customer, benchmark, or other proof assets were confirmed. Future work must not fabricate them.

## Evidence on Hand

- The implemented frontend feature areas are under `src/features/auth`, `src/features/banking`, and `src/features/settings`, with routes under `src/routes`.
- The adjacent backend contains the Enable Banking integration and bank connection, account, balance, synchronization, and transaction services under `../flair-api/src/app/modules`.
- The current repository contains working authentication, bank connection, synchronization, balance, transaction review, and settings flows; planned categorization, insights, and prediction features are not yet evidence of shipped functionality.

## Product Principles

- Personal utility comes before broad-market product scope.
- Read-only behavior and accurate financial state are non-negotiable.
- Current multi-bank information should be quick to retrieve and straightforward to inspect.
- Keep financial data under the user's control wherever practical, while treating remote access as a security-sensitive capability.
- Never imply bank coverage, financial insight, or prediction quality that the integration and data can support.

## Accessibility & Inclusion

No product-specific accessibility standard or user need was confirmed during init. The target standard remains an open decision; future interface work should still preserve standard web accessibility and usable access across personal devices.
