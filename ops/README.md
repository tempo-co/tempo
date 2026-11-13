# Tempo operations

CI builds an image of each app a commit changes, publishes `ghcr.io/tempo-co/{api,web}:pr-<n>` for same-repo PRs, and tags `:main` after tests pass on `main` (`docs/ci-and-images.md`). `ops/deploy.sh` deploys those images to both targets: it resolves tags to digests, recreates API and web (plus any pinned service whose pin changed, see below), waits for health, and restores the previous images if the new ones are unhealthy. Database migrations are not rolled back.

| File | Purpose |
|---|---|
| `deploy.sh` | Deploy script for both targets |
| `targets/{production,staging}.env` | Non-secret per-target settings |
| `backup.sh` | Validated `pg_dump`, scheduled and pre-deploy |
| `install.sh` | Copies the above to the host; `install.sh claude-bridge` installs the bridge from `apps/api/claude-bridge` |
| `sync-pins.sh` | Applies image-pin-only Compose changes from `main` before each production deploy |
| `production.compose.yml` | Production stack: PostgreSQL, Redis, API and web |
| `tailscale.compose.yml` | Tailscale sidecar giving production its own tailnet device |
| `ghcr-retention.sh` | Weekly GHCR cleanup of both packages (`.github/workflows/ghcr-retention.yml`): keeps `main`, open PRs' `pr-<n>` and anything newer than 30 days. Also keeps the images of the last 5 `main` commits that changed the app as rollback targets. Dry run until the repo variable `GHCR_RETENTION_DELETE=true`; GitHub pauses scheduled workflows after 60 days without repo activity |
| `systemd/` | Production deploy and backup timers (installed by `install.sh`); staging Docker daemon (user unit, installed once by hand) |
| `staging/` | Staging Compose files (stack and Tailscale sidecar), env template, database refresh |

## Production

`tempo-deploy-production.timer` runs `deploy.sh production` every 5 minutes and deploys `:main`. A failed image pull is retried twice, 15 and 30 seconds apart, before the run fails. Before any API image change it takes a validated database backup; a failed backup cancels the deploy. Images that fail to deploy are skipped until `:main` moves.

PostgreSQL, Redis, Mailpit and Tailscale are pinned by `tag@digest` in the Compose files, and Dependabot proposes weekly bumps (no PostgreSQL or Redis majors). Before every deploy run, `tempo-sync-pins.service` (root, `sync-pins.sh`) copies a merged bump from `main` into the installed Compose files when the only change is a tag@digest `image:` line for the same image, major version and variant that moves forward (a higher version, or the same tag at the digest Docker Hub currently serves); downgrades and anything else still need `sudo ops/install.sh production`. The deploy run then recreates the services whose pin changed, taking the same backup first when PostgreSQL changes, and waits for health. There is no automatic rollback for these. After a failed pin update, deploys stop until a pin changes or the `failed-pins-*` file in the state directory is removed.

```bash
journalctl -u tempo-deploy-production.service -n 50   # what happened
cat /var/lib/tempo-deploy/deployed.env                # what is deployed
```

`tempo-backup.timer` runs `backup.sh` on a schedule and keeps a fixed number of timestamped archives; manual `tempo-pre-*.dump` files are never pruned. Schedule, directory and retention are set by the units `install.sh` installs. Staging refreshes from these archives.

After changing anything else in `ops/`, install from a clean `main` checkout:

```bash
git fetch && git checkout --detach origin/main
sudo ops/install.sh production
```

Production secrets live in the production env file (path set by `install.sh`, mode 600), outside the repository. Email goes through authenticated SMTP with STARTTLS required.

### Claude categorization

The API calls the Anthropic API with `ANTHROPIC_API_KEY` and falls back to `tempo-claude-bridge.service`, a user unit that runs `claude -p` under the host user's Claude subscription login and listens on a private Unix socket. Both routes run the same prompts and the same one-search follow-up for unresolved transactions; on the bridge, a hook allows only that one search with the supplied query. Compose mounts the socket directory from `TEMPO_CLAUDE_BRIDGE_DIR` and refuses to start without it. Before deploying a release with this provider, as the subscription user:

```bash
ops/install.sh claude-bridge
systemctl --user enable --now tempo-claude-bridge.service
```

Then set `ANTHROPIC_API_KEY` and `TEMPO_CLAUDE_BRIDGE_DIR` (the bridge unit's socket directory) in the production env file, and remove `OPENAI_API_KEY`. When neither route is available, transactions stay pending and hourly reconciliation retries them.

### Merchant logos

`MERCHANT_LOGOS_ENABLED=true` in `/etc/tempo/production.env` turns merchant logos on. The first start identifies every existing merchant key in batches of 50 and then fetches each confirmed site's icon, so expect a few minutes of model calls and outbound HTTPS requests to merchant sites, `icons.duckduckgo.com` and, with `LOGO_DEV_SECRET_KEY` set, `api.logo.dev`. logo.dev's free plan has a monthly credit allowance; when it runs out, logos come from the merchants' sites and logo.dev is asked again the next day. Identification uses the subscription bridge's `/identify-merchants` route as its fallback, which needs the bridge reinstalled and restarted after the API release that adds it (see below).

### Push notifications

`WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` (a `mailto:` contact) in `/etc/tempo/production.env` turn push alerts on; generate the pair once with `npx web-push generate-vapid-keys`. Without them, Settings says the server sends no notifications. Changing the pair ends every device's subscription: on each device, turn notifications off and allow them again in Settings → Account. Pushes go out to Apple's, Google's, Mozilla's and Microsoft's push services.

### Contract compatibility

The API fingerprints `contract.json` (categorization) and `merchant-contract.json` (merchant identification) and sends the matching fingerprint as `X-Tempo-Contract` on each subscription route. The bridge refuses a missing or different fingerprint with `409 contract_mismatch` before starting Claude; the API logs an actionable warning. Reinstall **and restart** the bridge when either contract changes. The initial rollout needs the new API deployed before restarting the stricter bridge, since older APIs do not send the header.

`GET /contract` on the private socket returns the bridge's loaded fingerprints without calling Claude. The host check compares it with the running API container, rather than with an installed file that may not have been reloaded:

```bash
"$HOME/.local/bin/node" "$HOME/.local/lib/tempo-claude-bridge/check-contract.mjs"
```

The check is silent on success and prints a safe failure reason with exit status 1 otherwise. It uses `tempo-api-production-api-1` by default (`TEMPO_API_CONTAINER` overrides it), and `TEMPO_CLAUDE_BRIDGE_SOCKET` overrides the socket. Add it as the final check in the host uptime probe's `probe()` function so its existing consecutive-failure threshold, Discord delivery queue and recovery notification also cover contract drift. The host-specific probe and its notification configuration are not managed by this repository.

### Network boundary

PostgreSQL, Redis and the API share the `default` network. The API also joins the internal `frontend` network; web joins `frontend`, the web-only `ingress` network that publishes its loopback port, and the `tailscale` network it shares with the Tailscale sidecar. Web therefore has no network path to the database or cache. Do not mark `default` internal: the API needs outbound access.

The `tailscale` network has a fixed subnet so the sidecar gets the static address `10.213.47.2`, outside the range Docker assigns to web. Web's Nginx takes the client address from `X-Forwarded-For` only on requests from that address, so the API sees tailnet clients' `100.x` addresses while local processes and other containers cannot set their own. Staging's sidecar uses the same address on its own daemon (`staging/README.md`). Changing the address needs the matching change in `apps/web/nginx/tempo.conf` and in both environments' Compose files. Compose changes to either network reach running containers only when they are recreated: after `sudo ops/install.sh production`, recreate web (`deploy.sh` only does that when an image changes) and then the sidecar.

### Container privileges

Every production container runs with `no-new-privileges` and drops all Linux capabilities. The API runs as uid and gid 10001, set by number in the host-owned Compose file so an image cannot switch itself to root. Production uses the root Docker daemon without user namespaces, so a container uid is the same host uid: 10001 belongs to no host account, while the image's own `node` user (1000) would be the host user, who can use sudo. The API reads the banking key as that uid, so the key file at `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` belongs to the host user and group 10001, mode 0440, which also keeps it readable for uid 1000 during a switch or rollback. The Claude bridge grants the same uid access to its socket by ACL (`TEMPO_CLAUDE_BRIDGE_CLIENT_UID` in its unit; needs the `acl` package), so a uid change goes into the Compose file, the bridge unit and the key's group together; the ops check in CI compares the first two. The official PostgreSQL, Redis and Nginx images start as root to fix ownership and switch to their service user, so they keep only `CHOWN`, `SETUID` and `SETGID` (PostgreSQL also `DAC_OVERRIDE` and `FOWNER`). The Tailscale sidecar uses userspace networking and needs none. Like network changes, these settings reach running containers only when they are recreated: after `sudo ops/install.sh production`, recreate PostgreSQL, Redis, API and web, then the sidecar. Install the bridge and set the key's group before the API moves to a new uid; both also work for the old one, so a rollback only reinstalls the previous Compose file.

## Staging

An isolated rootless Docker daemon (`tempo-staging-docker.service`) runs a separate copy of the stack on `http://127.0.0.1:8119/` and, through its own Tailscale sidecar, at `https://tempo-staging.<tailnet>.ts.net/` for testing from a phone. Deploy any API/web pair with one command; an omitted component keeps its current image:

```bash
ops/install.sh staging                         # after changing ops/
tempo-deploy staging --api pr-115 --web main
```

A successful deploy refreshes the staging database from the newest production backup, so staging stays on loopback and the tailnet: no Funnel, port forward or other route. See [`staging/README.md`](staging/README.md).
