# Merchant logos

How `src/app/modules/banking/merchant-logos/` finds, trusts, stores and serves a merchant's logo. Setup and outbound hosts are in `README.md` and `ops/README.md`; variables in `src/app/core/config/config.schema.ts`.

## Boundaries

- Display only. Categories, `merchantKey`, category history and recurring detection never read `merchants` or `merchant_logos`, and nothing here writes to `bank_transactions`. Recurring responses show the logo of a series' latest payment through `getLogoUrls`, like any listed transaction.
- No per-merchant rules (aliases, domain overrides, exception lists). Fix a miss with a general rule and a synthetic test, or leave the category icon.
- Own transfers and currency exchanges never show a logo, even when they share a key with a purchase: rows with `ownTransferEvidence` or `financialEventType` are skipped in `addMerchants`, the identification input and `getLogoUrls`. Keep an E2E row of that shape.
- The browser loads images only from `GET /merchant-logos/:id/:version`, never from merchant sites or logo services.
- `MERCHANT_LOGOS_ENABLED=true` fails config validation without `ANTHROPIC_API_KEY` or `AI_CATEGORIZATION_SUBSCRIPTION_SOCKET`; merchants would otherwise stay pending forever.

## Data model

- `merchants`: one row per account and key without its direction (`getMerchantKeyName`), so a purchase and its refund share it; `status` (`PENDING`, `IDENTIFIED`, `NONE`), `brand`, `domain`, `domainConfident`, `logoId`. History is joined on the key at read time; nothing is written per transaction.
- `merchant_logos`: one row per domain, shared by every merchant naming it: PNG (`bytea`, `select: false`), `version` (SHA-256 of the image), `siteNames`, `homepageLoaded`, `sourceSize`, `monochrome`, retry fields.
- Find a merchant's transactions by stored key: `"merchantKey" IN (:...keys)` with `getMerchantKeysForName(name)` (one per direction) uses `idx_bank_transactions_account_merchant_key`; `substring(...) = :key` scans every owner row per merchant. Key-format helpers stay in `categorization/bank-transaction-merchant-key.ts`.

## Pipeline

One `merchant-logos` queue, concurrency 1.

1. After a sync persists rows, `enqueueForOwnerSafely` adds new merchants and queues identification without failing the sync. The hourly reconcile repeats that and picks logos with a due `retryAfter`, or `PENDING` with a null one.
2. Before identification, rows recognized by `isTransferDescriptionMerchantKey` are excluded: explicit `Transfer to/from …` text without a separate card merchant or counterparty name. A key with only those rows becomes `NONE` without AI; otherwise use its newest eligible row and up to 20 eligible rows' search hostnames, filtering before sampling so older business evidence is not hidden. Identification sends up to `maxMerchants` (50) per call from `ops/claude-bridge/merchant-contract.json`: sanitized name, location, type, direction, earlier search hostnames; no amounts, dates or references. `toMerchantIdentificationName` keeps hostnames, unlike the web-search sanitizer. `BUSINESS`/`PAYMENT_SERVICE` with a brand become `IDENTIFIED`, the rest `NONE`.
3. Fetch per domain (below). Failures retry after 1 and 3 days, then `MISSING` with a monthly recheck; `READY` refreshes after about six months.

The `/identify-merchants` bridge route has its own contract file and fingerprint so the categorization routes keep working on a bridge not yet reinstalled (`docs/categorization.md` § The bridge contract). It answers 502 once the model produced output, so the failure counts as an attempt. `BankTransactionCategorizationUnavailableError` (both routes refused before the model ran) leaves merchants pending without an attempt.

## Choosing the image

`fetchLogo` keeps the sharpest candidate:

1. logo.dev (only with `LOGO_DEV_SECRET_KEY`; domain only). Rank by the original's size in `source` (vector = 512), never by the download, which is always enlarged. 404 = none; 402 retries in a week; 202, 429 and errors the next day. None blocks the fallbacks.
2. Under 128px: `iconCandidates` — page icons largest first, then manifest icons, then `/favicon.svg`, `/apple-touch-icon.png`, `/apple-touch-icon-precomposed.png`, `/favicon.ico`, max ten. Stop at the first ≥128px; declared sizes lie, so smaller ones are all tried.
3. Still under 128px: the favicon service (domain only). Largest wins.

Handled traps; keep them tested:

- A manifest counts only if `name`/`short_name` spells a hostname label ("App", "Webshop" belong to the hosting software and their 512px icon would beat the brand). Manifest icons rank after page icons; `monochrome`-purpose icons are skipped.
- `isPlatformDefaultIcon` rejects CMS stand-ins (`/wp-includes/images/`).
- A walled homepage still gets the conventional paths tried; many serve large icons anyway.
- Icon URLs that return HTML with 200 fail to decode and the next candidate runs. Blank results (white mark on transparency), animations and sources under 32px are rejected.
- BMP-only ICOs use the encoder's own decoder (1/4/8-bit paletted, 24/32-bit, AND mask); sharp reads none.
- A parked or for-sale homepage ends as `MISSING` (hiding any stored logo) and skips logo.dev.

## Trust rules

The model can name a plausible domain that belongs to someone else, so only the site's own words confirm it (`chooseMerchantLogos`, `siteMatchesBrand`):

- Names (title, `og:site_name`, `application-name`, `apple-mobile-web-app-title`) come from the same homepage fetch as the image.
- If the site states names, one must spell the brand in whole tokens: a run of consecutive tokens, joined, equals the brand's joined tokens ("Example Shop" matches "ExampleShop Online", "Example Mart" not "Example Martin Plumbing"). Brands of six+ letters also accept a trailing `s`. Never prefix or substring matching.
- Sub-brand on a parent's site: confident domain and a site name spelling the domain's **first** label, joined or as initials. Later labels can be a public suffix (`co` in `.co.uk`) any two-word name's initials spell.
- Loaded, no names: hostname spelling or a confident domain. Homepage not loaded: confident domain only. A site naming itself something else never confirms, however confident the domain (a lapsed domain serving spam).
- Token-run scans stop as soon as no spelling starts with the run; otherwise a long title costs quadratic time on the event loop.
- A refresh without the homepage keeps the stored logo and its confirming names, replacing it only with one at least as sharp. Never overwrite them with an error page's names.
- Merchants of one brand (joined tokens) show its best trusted logo: colour before `monochrome`, then larger source; on a tie a merchant keeps its own.

## Fetching and rendering safety

- All outbound site requests go through `MerchantSiteFetcher`: https:443 with a DNS hostname, every hop resolved to public unicast and connected to that checked address, ≤3 redirects (http upgraded to https), per-resource byte limits, 8 s deadline, no cookies.
- Every hop races a deadline promise and truncated reads return at the limit: `stream.pipeline` can fail to settle (oversized compressed page then a reset) and abort cannot end it. Reproduce with a response whose `_destroy` never calls back.
- In process only PNG/JPEG/WebP/GIF buffer loaders are unblocked. SVG renders in a child (`merchant-svg.ts`): empty env, only `VipsForeignLoadSvgBuffer`, 256 KB cap, SIGKILL after 5 s. Some SVGs render for minutes and sharp's `.timeout()` cannot stop librsvg, so in-process rendering would wedge the queue.
- Output: square PNG on white, capped at 128px (a ceiling, not a quality guarantee).

## Serving

- 404 unless the logo is `READY`, the version matches and one of the caller's `IDENTIFIED` merchants references it. The route is in `test/e2e/auth/auth-guard.e2e.spec.ts`.
- Set `Cache-Control: private, max-age=31536000, immutable` inside the handler after the lookup (`@Res({passthrough: true})`, return a typed `StreamableFile`). `@Header()` runs before the handler and would cache a 404 as immutable; the E2E asserts a refusal has no `cache-control`.
- The version is the image hash, so a new image gets a new URL.

## Tests

- E2E: `enableMerchantLogosE2e()` at module scope (sets the placeholder key); spy on `ClaudeBankTransactionCategorizationProvider.identifyMerchants`, `LogoDevClient.findLogo` and `MerchantSiteFetcher.fetch`; real queue, worker, database, HTTP; `waitFor` from `test/utils/wait-utils.ts`.
- Failure branches: per-test `Set`s of unreachable or walled hostnames checked by the fetch spy and cleared in `afterEach`, not a second mock setup.
- Units: `merchant-site.spec.ts`, `merchant-site-fetcher.spec.ts`, `logo-dev.client.spec.ts`.
- Fixtures are synthetic (`Example Shop`, `shop.example.test`).
