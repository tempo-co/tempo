# Staging

Staging is a separate copy of Tempo on this host, deployed with `tempo-deploy staging --api <tag> --web <tag>` (see [`../README.md`](../README.md)).

## Layout

- Rootless Docker daemon: socket `$XDG_RUNTIME_DIR/tempo-staging/docker.sock`
- Compose project `tempo-staging`: its own PostgreSQL, Redis, Mailpit, API, web, volumes and networks
- Config: `staging.compose.yml` and `staging.env` (secrets plus the deployed image digests; template in `staging.env.example`), installed by `ops/install.sh staging`
- URLs: app `http://127.0.0.1:8119/`, Mailpit `http://127.0.0.1:8125/`, both loopback only

## Safety

The Compose file hard-codes `BANKING_INTEGRATION_ENABLED=false`, `AI_CATEGORIZATION_ENABLED=false` and `AI_CATEGORIZATION_WEB_SEARCH_ENABLED=false`, and the env template has no Anthropic or banking keys and no subscription socket, so staging makes no billable AI calls and no bank calls.

## Database refresh

After a deploy changes an image, `tempo-staging-refresh.sh` restores the newest scheduled production backup into a temporary staging database, applies the current schema, clears provider sessions and sync state, swaps it in, flushes staging Redis and health-checks the stack. If staging is unhealthy after the swap, the previous database is put back. It never connects to production. `tempo-staging-refresh.sh seed --confirm-seeded-reset` does the same with seed data instead.

Restored bank connections are marked `EXPIRED` with provider sessions, consent and sync scheduling cleared. Retained accounts, balances and transactions stay visible in Home with a reconnect warning.

The restored data includes production logins, which is why staging must stay on loopback. Production sessions are not copied, so sign in again after a refresh.
