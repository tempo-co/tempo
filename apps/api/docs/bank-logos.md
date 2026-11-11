# Bank logos

Bank artwork comes from Enable Banking, in its original colours. The picker uses a wide `BankWordmark`; connection cards, their details and transaction movement accounts use `BankLogo`. Both share one renderer and a uniform rounded plate with a subtle Fold shadow border. The plate is white in light mode and muted Paper (`#F6F1E8`) in dark mode, including initials and failed-image fallbacks. Logos are display only and never affect bank identity, authorization or financial data.

## HTTP contract

`GET /bank-connections/aspsps` and `GET /bank-connections` expose `logo.metadataUrl`, a same-origin path under `/bank-connections/aspsps/logos/:country/:name`. The name segment is UTF-8 encoded as base64url so punctuation and slashes survive reverse-proxy path normalization. The catalogue also keeps its original `logoUrl` for older clients. Current clients display the converted artwork, not the provider URL.

Metadata returns one PNG `url`, used in both themes. Conversion is lazy: opening a catalogue never downloads all its artwork, and clients request metadata only when a logo slot enters the viewport. The country catalogue is cached for a day, so showing connected banks does not repeatedly list every supported bank. Saved connection reads themselves never contact the provider.

The metadata route and `/:algorithm/:hash` image route require a verified session. Successful metadata has `Cache-Control: private, max-age=86400`; successful PNGs have `Cache-Control: private, max-age=31536000, immutable` and `Cross-Origin-Resource-Policy: same-site`. Errors have no image cache headers. The browser uses initials for missing metadata or failed images; another source version retries the image. Theme changes affect only the plate, reusing the same loaded PNG without pixel analysis or filters.

## Conversion

`bank-logos/bank-logo.ts` owns the versioned `colour-v2` converter:

- Decode a still raster at most 4096×4096 through the merchant image loader policy, or render SVG through the merchant renderer's isolated, time-limited child. Retain the aspect ratio and cap conversion work at 896×288.
- A near-white field has minimum RGB ≥235, channel spread ≤18 and alpha ≥245. Remove only its four-connected edge components, and only when it covers at least 65% of the whole boundary and three corners. Enclosed white and sparse white lettering on transparent edges stay intact.
- Otherwise preserve RGB and alpha. Neutral ink and brand colours remain unchanged in both themes. Empty results are rejected.

Pixel-affecting changes require a new converter version and visual comparison of the resulting artwork. No bank-specific exceptions or alternate logo sources exist.

## Fetching and caching

Only catalogue-provided URLs enter the source registry. `MerchantSiteFetcher` supplies the public-address, redirect, timeout and byte-limit checks; source images have a 1 MiB limit, with at most four fetch/conversion operations active per process. SVG uses the existing 256 KiB limit and five-second kill deadline. No browser request goes to Enable Banking for a current logo.

`LogoCache` is shared with merchant masks. It keys successful derivatives by source-byte SHA-256 plus converter version, deduplicates in-flight work, and atomically bounds each family at 256 entries with seven-day TTLs. A bank entry stores one PNG. A one-day source-URL index avoids downloading unchanged sources for each metadata read. An evicted image is rebuilt from its registered bank source; a mismatching hash or unknown algorithm returns 404, never different pixels at an immutable URL. No banking or merchant database rows are changed.

## Verification

Pure converter fixtures are synthetic and test connected background removal, retained white, colour/alpha preservation and empty results. API E2E uses real Redis, PostgreSQL, sessions and HTTP with only the provider/fetch boundary replaced. Picker and connection journey/layout specs cover uniform bordered plates in both themes, centring, initials and failed images at narrow and desktop widths. Visual acceptance uses a public-logo corpus converted by the compiled API code and rendered by the built shared web component beside the production wordmark.
