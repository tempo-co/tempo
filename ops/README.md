# Tempo operations

CI builds one image per commit, publishes `ghcr.io/tempo-co/tempo-{api,web}:pr-<n>` for every same-repo PR, and tags `:main` after tests pass on `main`. `ops/deploy.sh` deploys those images to both targets: it resolves tags to digests, recreates API and web (plus any pinned service whose pin changed, see below), waits for health, and restores the previous images if the new ones are unhealthy. Database migrations are not rolled back.

| File | Purpose |
|---|---|
| `deploy.sh` | Deploy script for both targets |
| `targets/{production,staging}.env` | Non-secret per-target settings |
| `backup.sh` | Validated `pg_dump`, scheduled and pre-deploy |
| `install.sh` | Copies the above to the host |
| `tailscale.compose.yml` | Tailscale sidecar giving production its own tailnet device |
| `runtime-image-smoke.js` | Runtime image check run by the `Dockerfile` |
| `ghcr-retention.sh` | Weekly GHCR cleanup (`.github/workflows/ghcr-retention.yml`, also used by tempo-web): keeps `main`, open PRs' `pr-<n>` and anything newer than 30 days. Also keeps the last 5 `main` images as rollback targets. Dry run until the repo variable `GHCR_RETENTION_DELETE=true`; GitHub pauses scheduled workflows after 60 days without repo activity |
| `systemd/` | Production deploy and backup timers (installed by `install.sh`); staging Docker daemon (user unit, installed once by hand) |
| `staging/` | Staging Compose file, env template, database refresh |

## Production

`tempo-deploy-production.timer` runs `deploy.sh production` every 5 minutes and deploys `:main`. Before any API image change it takes a validated backup into `/var/lib/tempo-deploy/pre-deploy-backups` (newest 5 kept); a failed backup cancels the deploy. Images that fail to deploy are skipped until `:main` moves.

PostgreSQL, Redis, Mailpit and Tailscale are pinned by `tag@digest` in the Compose files, and Dependabot proposes weekly bumps (no PostgreSQL or Redis majors). After a bump is installed, the next deploy run recreates the services whose pin changed, taking the same backup first when PostgreSQL changes, and waits for health. There is no automatic rollback for these. After a failed pin update, deploys stop until a pin changes or the `failed-pins-*` file in the state directory is removed.

```bash
journalctl -u tempo-deploy-production.service -n 50   # what happened
cat /var/lib/tempo-deploy/deployed.env                # what is deployed
```

`tempo-backup.timer` runs `backup.sh` nightly at 03:30 into `~/backups/tempo` (newest 14 timestamped archives kept; manual `tempo-pre-*.dump` files are never pruned). Staging refreshes from these archives.

After changing anything in `ops/` or `docker-compose.production.yml` (including a Dependabot image bump), install from a clean `main` checkout:

```bash
git fetch && git checkout --detach origin/main
sudo ops/install.sh production
```

Production secrets live in `/etc/tempo/production.env` (mode 600), outside the repository. Email goes through authenticated Gmail SMTP (`smtp.gmail.com:587`, STARTTLS required).

### Claude categorization

The API calls the Anthropic API with `ANTHROPIC_API_KEY` and falls back to `tempo-claude-bridge.service`, a user unit that runs `claude -p` under the host user's Claude subscription login and listens on a private Unix socket. Compose mounts the socket directory from `TEMPO_CLAUDE_BRIDGE_DIR` and refuses to start without it. Before deploying a release with this provider, as the subscription user:

```bash
ops/install.sh claude-bridge
systemctl --user enable --now tempo-claude-bridge.service
```

Then set `AI_CATEGORIZATION_PROVIDER=claude`, `AI_CATEGORIZATION_MODEL=claude-opus-5-5`, `ANTHROPIC_API_KEY` and `TEMPO_CLAUDE_BRIDGE_DIR` (the unit's `~/.local/state/tempo-claude`) in `/etc/tempo/production.env`, and remove `OPENAI_API_KEY`. When neither route is available, transactions stay pending and hourly reconciliation retries them.

### Network boundary

PostgreSQL, Redis and the API share the `default` network. The API also joins the internal `frontend` network; web joins `frontend` and the web-only `ingress` network that publishes its loopback port. Web therefore has no network path to the database or cache. Do not mark `default` internal: the API needs outbound access.

## Staging

An isolated rootless Docker daemon (`tempo-staging-docker.service`) runs a separate copy of the stack on `http://127.0.0.1:8119/`. Deploy any API/web pair with one command; an omitted component keeps its current image:

```bash
ops/install.sh staging                         # after changing ops/
tempo-deploy staging --api pr-115 --web main
```

A successful deploy refreshes the staging database from the newest production backup, so staging holds production data: keep it on loopback. See [`staging/README.md`](staging/README.md).
