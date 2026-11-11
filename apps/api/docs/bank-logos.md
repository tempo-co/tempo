# Bank logos

Bank artwork comes from Enable Banking, in its original colours. The picker uses a wide `BankWordmark`; connection cards, their details and transaction movement accounts use `BankLogo`. Both share the same themed renderer. Logos are display only and never affect bank identity, authorization or financial data.

## HTTP contract

`GET /bank-connections/aspsps` and `GET /bank-connections` expose `logo.metadataUrl`, a same-origin path under `/bank-connections/aspsps/logos/:country/:name`. The catalogue also keeps its original `logoUrl` for older clients. Current clients display the themed metadata, not the provider URL.

Metadata returns `light` and `dark`, each with a PNG `url` and a `plate` boolean. Conversion is lazy: opening a catalogue never downloads all its artwork, and clients request metadata only when a logo slot enters the viewport. The country catalogue is cached for a day, so showing connected banks does not repeatedly list every supported bank. Saved connection reads themselves never contact the provider.

The metadata route and `/:algorithm/:hash/:theme` image route require a verified session. Successful metadata has `Cache-Control: private, max-age=86400`; successful PNGs have `Cache-Control: private, max-age=31536000, immutable` and `Cross-Origin-Resource-Policy: same-site`. Errors have no image cache headers. The browser uses initials for missing metadata or failed images; another source version retries the image. Theme-specific wrappers follow the app's light/dark class without client-side pixel analysis or filters.

## Conversion

`bank-logos/bank-logo.ts` owns the versioned `colour-v1` converter:

- Decode a still raster at most 4096×4096 through the merchant image loader policy, or render SVG through the merchant renderer's isolated, time-limited child. Retain the aspect ratio and cap conversion work at 896×288.
- A near-white field has minimum RGB ≥235, channel spread ≤18 and alpha ≥245. Remove only its four-connected edge components, and only when it covers at least 65% of the whole boundary and three corners. Enclosed white and sparse white lettering on transparent edges stay intact.
- The light image otherwise keeps its RGB and alpha. For dark, lift visible near-neutral ink only (saturation ≤0.12, channel spread ≤18, mean RGB ≤145) to `246 - channel × 0.15`, with ties-to-even rounding. Saturated colours and alpha are unchanged.
- Measure the 10th-percentile alpha-composited contrast at 112×36, ignoring alpha below 180, on both the card and canvas colours of each theme. A contrast below 3:1 selects a plate. Dark also uses a plate when retained white backing could hide lifted ink: white occupies more than 2% of opaque pixels and either more than 1% of opaque pixels were lifted or an edge field was removed.
- A plate uses the light image, including in dark mode, so lifted white text cannot disappear on the plate. Its warm field is `bank-logo-plate` (`#FAF8F3`), with a rounded boundary in the Clay tile edge token. A light plate does not guarantee that every pale brand detail reaches 3:1; the converter does not recolour brand ink to force it.

The converter's card/canvas samples match `apps/web/src/index.css`. Pixel-affecting changes, including those samples, require a new converter version and visual comparison of the resulting artwork. No bank-specific exceptions or alternate logo sources exist.

## Fetching and caching

Only catalogue-provided URLs enter the source registry. `MerchantSiteFetcher` supplies the public-address, redirect, timeout and byte-limit checks; source images have a 1 MiB limit, with at most four fetch/conversion operations active per process. SVG uses the existing 256 KiB limit and five-second kill deadline. No browser request goes to Enable Banking for a current logo.

`LogoCache` is shared with merchant masks. It keys successful derivatives by source-byte SHA-256 plus converter version, deduplicates in-flight work, and atomically bounds each family at 256 entries with seven-day TTLs. A bank entry stores both PNGs and the plate decisions. A one-day source-URL index avoids downloading unchanged sources for each metadata read. An evicted image is rebuilt from its registered bank source; a mismatching hash or unknown algorithm returns 404, never different pixels at an immutable URL. No banking or merchant database rows are changed.

## Verification

Pure converter fixtures are synthetic and test connected background removal, retained white, neutral lifting, colour/alpha preservation, plates and empty results. API E2E uses real Redis, PostgreSQL, sessions and HTTP with only the provider/fetch boundary replaced. Picker and connection journey/layout specs cover themed variants, initials and failed images at narrow and desktop widths. Visual acceptance uses a public-logo corpus converted by the compiled API code and rendered by the built shared web component beside the production wordmark.
