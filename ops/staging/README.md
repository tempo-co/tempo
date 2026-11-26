# Staging

Staging is a separate copy of Tempo on the production server, deployed with `tempo-deploy staging --api <tag> --web <tag>` (see [`../README.md`](../README.md)).

## Layout

- Rootless Docker daemon: socket `$XDG_RUNTIME_DIR/tempo-staging/docker.sock`
- Compose project `tempo-staging`: its own PostgreSQL, Redis, Mailpit, API, web, volumes and networks
- Compose project `tempo-staging-tailscale`: the Tailscale sidecar giving staging its own tailnet device, `tempo-staging`, on the same daemon. Staging deploys recreate it only when its pinned image changes.
- Config: `staging.compose.yml`, `tailscale.compose.yml`, `tailscale-serve.json` and `staging.env` (secrets, the tailnet origin and the deployed image digests; template in `staging.env.example`), installed to `~/.config/tempo-staging/` by `ops/install.sh staging`, plus `feed.env` and its keys, made by hand (Database feed)
- URLs: app `http://127.0.0.1:8119/` and `https://tempo-staging.<tailnet>.ts.net/`; Mailpit `http://127.0.0.1:8125/`, loopback only

## Deploying

- `tempo-deploy staging --api <tag> --web <tag>` exits 0 when the stack is healthy, 1 when the deploy failed, and 75 when another deploy holds the lock. A head that changed only the web app has no API image of its own, so pass `--api main` with it.
- `tempo-deploy` and the refresh script run from the installed copy, not the checkout. `ops/install.sh staging` installs whatever the checkout's `HEAD` is (production's install refuses anything but the fetched main) and records that commit in `$HOME/.local/lib/tempo-deploy/VERSION`. Compare it with the fetched main before deploying, and reinstall from a main checkout when `ops/` has moved; an older installed copy lacks the fixes merged since.
- The API container gets only the variables listed under its `environment:` in `ops/staging/docker-compose.yml`; there is no `env_file`. A new API setting reaches staging only through a line there.
- What is deployed: the containers' `org.opencontainers.image.revision` labels (the deploy log prints them) and `http://127.0.0.1:8119/api/health`. The staging API is limited to one CPU.

## Signing in

Sign in with a synthetic account, never a restored login: `POST /api/auth/signup` with a random `@example.test` address, read the code from Mailpit (`http://127.0.0.1:8125/api/v1/messages`), then `POST /api/auth/signup/verify`. Send `Origin` set to the configured web origin on every write. The session cookie is `Secure` (staging runs with `NODE_ENV=production`), so over loopback HTTP send it back by hand in a `Cookie` header. The next database refresh deletes the account.

## Safety

The Compose file hard-codes `BANKING_INTEGRATION_ENABLED=false`, `AI_CATEGORIZATION_ENABLED=false` and `AI_CATEGORIZATION_WEB_SEARCH_ENABLED=false`, and the env template has no Anthropic or banking keys, so staging makes no billable AI calls and no bank calls. It sets `FILE_IMPORT_ENABLED=true`, so statement file import can be tried there, and `FILE_IMPORT_MAPPER_ENABLED=false`, so a file in no known layout is refused there rather than sent to a model; production leaves both off unless its env file turns them on.

## Database refresh

After a deploy changes an image, `tempo-staging-refresh.sh` restores production data from the feed (below) into a temporary staging database, applies the current schema, clears provider sessions and sync state, swaps it in, flushes staging Redis and health-checks the stack. If staging is unhealthy after the swap, the previous database is put back. It never connects to production's database. `tempo-staging-refresh.sh seed --confirm-seeded-reset` does the same with seed data instead.

Restored bank connections are marked `EXPIRED` with provider sessions, consent and sync scheduling cleared. Retained accounts, balances and transactions stay visible in Home with a reconnect warning.

The restored data includes production logins, which is why staging is reachable only on loopback and from the tailnet, through its own device. Never enable Funnel on it. Production sessions are not copied, so sign in again after a refresh.

## Database feed

A refresh takes production data from the production server's nightly owner-only copy (`../README.md`, Staging copy). It fetches the newest over SSH as `STAGING_FEED_SSH` from `~/.config/tempo-staging/feed.env` (template `feed.env.example`; the server's `wisp-staging-feed` account), with the key and pinned host key in `~/.config/tempo-staging/feed-ssh/` (`id_ed25519`, `known_hosts`). It decrypts the copy with the secret key in `~/.config/tempo-staging/feed-gnupg/` into a private work directory under `~/.local/state/tempo-staging/`, deleted when the run ends, and fails unless the restored copy holds exactly one account.

Setting it up on both machines: [`docs/staging-feed.md`](../../docs/staging-feed.md).

## Tailnet device

The sidecar uses userspace networking and no capabilities. It serves HTTPS on 443 proxied to web over the `tempo-staging-tailscale` network, where it has the fixed address `10.213.47.2` that web's Nginx trusts for `X-Forwarded-For`, the address Caddy holds in production (`../README.md`, Network boundary). That network lives on the staging daemon, so the address does not collide with production's.

`STAGING_WEB_BASE_URL` in `staging.env` holds the tailnet origin (`https://tempo-staging.<tailnet>.ts.net`, no trailing slash). The API accepts one origin, so with it set, CORS, CSRF-checked requests and emailed links use the tailnet origin; the loopback URL still serves the app and health checks. Unset, the origin is `http://127.0.0.1:8119`. A changed value reaches the API when it is recreated: any deploy that changes an image does that through the database refresh, and `compose up -d --force-recreate api web` on the staging project does it without a deploy (web too, since its Nginx resolves the API address at startup).

The node is logged in once with a one-off auth key and keeps its identity in the `tempo-staging-tailscale_tempo_staging_tailscale_state` volume. Until it is, its health check fails and so does `tempo-deploy staging`, which brings up the sidecar before deploying. Log in before the first deploy after installing: create the network by recreating web, start the sidecar with the key passed once as `TS_AUTHKEY` (for example through a temporary override file), then recreate the sidecar without it. If a deploy ran first, delete `~/.local/state/tempo-staging/failed-pins-tailscale` after logging in.
