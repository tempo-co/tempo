# Staging

Staging is a separate copy of Tempo on this host, deployed with `tempo-deploy staging --api <tag> --web <tag>` (see [`../README.md`](../README.md)).

## Layout

- Rootless Docker daemon: socket `$XDG_RUNTIME_DIR/tempo-staging/docker.sock`
- Compose project `tempo-staging`: its own PostgreSQL, Redis, Mailpit, API, web, volumes and networks
- Compose project `tempo-staging-tailscale`: the Tailscale sidecar giving staging its own tailnet device, `tempo-staging`, on the same daemon. Staging deploys recreate it only when its pinned image changes.
- Config: `staging.compose.yml`, `tailscale.compose.yml`, `tailscale-serve.json` and `staging.env` (secrets, the tailnet origin and the deployed image digests; template in `staging.env.example`), installed to `~/.config/tempo-staging/` by `ops/install.sh staging`
- URLs: app `http://127.0.0.1:8119/` and `https://tempo-staging.<tailnet>.ts.net/`; Mailpit `http://127.0.0.1:8125/`, loopback only

## Safety

The Compose file hard-codes `BANKING_INTEGRATION_ENABLED=false`, `AI_CATEGORIZATION_ENABLED=false` and `AI_CATEGORIZATION_WEB_SEARCH_ENABLED=false`, and the env template has no Anthropic or banking keys and no subscription socket, so staging makes no billable AI calls and no bank calls.

## Database refresh

After a deploy changes an image, `tempo-staging-refresh.sh` restores the newest scheduled production backup into a temporary staging database, applies the current schema, clears provider sessions and sync state, swaps it in, flushes staging Redis and health-checks the stack. If staging is unhealthy after the swap, the previous database is put back. It never connects to production. `tempo-staging-refresh.sh seed --confirm-seeded-reset` does the same with seed data instead.

Restored bank connections are marked `EXPIRED` with provider sessions, consent and sync scheduling cleared. Retained accounts, balances and transactions stay visible in Home with a reconnect warning.

The restored data includes production logins, which is why staging is reachable only on loopback and from the tailnet, through its own device. Never enable Funnel on it. Production sessions are not copied, so sign in again after a refresh.

## Tailnet device

The sidecar works like production's (`../README.md`): userspace networking, no capabilities, HTTPS on 443 proxied to web over the `tempo-staging-tailscale` network, where it has the fixed address `10.213.47.2` that web's Nginx trusts for `X-Forwarded-For`. That network lives on the staging daemon, so the address does not collide with production's.

`STAGING_WEB_BASE_URL` in `staging.env` holds the tailnet origin (`https://tempo-staging.<tailnet>.ts.net`, no trailing slash). The API accepts one origin, so with it set, CORS, CSRF-checked requests and emailed links use the tailnet origin; the loopback URL still serves the app and health checks. Unset, the origin is `http://127.0.0.1:8119`. A changed value reaches the API when it is recreated: any deploy that changes an image does that through the database refresh, and `compose up -d --force-recreate api web` on the staging project does it without a deploy (web too, since its Nginx resolves the API address at startup).

The node is logged in once with a one-off auth key and keeps its identity in the `tempo-staging-tailscale_tempo_staging_tailscale_state` volume. Until it is, its health check fails and so does `tempo-deploy staging`, which brings up the sidecar before deploying. Log in before the first deploy after installing: create the network by recreating web, start the sidecar with the key passed once as `TS_AUTHKEY` (for example through a temporary override file), then recreate the sidecar without it. If a deploy ran first, delete `~/.local/state/tempo-staging/failed-pins-tailscale` after logging in.
