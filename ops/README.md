# Tempo operations

CI builds an image of each app a commit changes and publishes `ghcr.io/tempo-co/{api,web}` tags for same-repo PRs and `main` (`docs/ci-and-images.md`). `ops/deploy.sh` deploys those images to both targets: it resolves tags to digests, recreates API and web (plus any pinned service whose pin changed, see below), waits for health, and restores the previous images if the new ones are unhealthy. Database migrations are not rolled back.

| File | Purpose |
|---|---|
| `deploy.sh` | Deploy script for both targets |
| `targets/production.env`, `targets/staging.env` | Non-secret per-target settings |
| `backup.sh` | Validated `pg_dump`, scheduled and pre-deploy |
| `install.sh` | Copies the above to the production server; `--check` lists installed files that differ from the checkout |
| `sync-pins.sh` | Applies image-pin-only Compose changes from `main` before each production deploy |
| `wisp-api-egress.sh` | Egress firewall for the API uid and production's container networks (see Egress firewall) |
| `test-deploy.sh`, `test-sync-pins.sh` | Offline tests of `deploy.sh` and `sync-pins.sh`, run by CI's `Ops checks`: stub `docker` and `curl` in a temporary sandbox, never a Docker daemon, registry or installed file |
| `production.compose.yml` | Production stack: PostgreSQL, Redis, API and web |
| `tailscale.compose.yml` | Tailscale sidecar giving production its own tailnet device |
| `ghcr-retention.sh` | Weekly GHCR cleanup of both packages (`.github/workflows/ghcr-retention.yml`): keeps `main`, `release`, open PRs' `pr-<n>` and anything newer than 30 days. Also keeps the images of the last 5 `main` commits that changed the app as rollback targets. Dry run until the repo variable `GHCR_RETENTION_DELETE=true`; GitHub pauses scheduled workflows after 60 days without repo activity |
| `systemd/` | Production deploy and backup timers and the egress firewall (installed by `install.sh`); staging Docker daemon (user unit, installed once by hand) |
| `staging/` | Staging Compose files (stack and Tailscale sidecar), env template, database refresh |

## Production

The production host uses wisp names: Compose project `wisp-production` (containers such as `wisp-production-postgres-1`), database and database user `wisp`, units `wisp-*`, deploy tooling in `/usr/local/lib/wisp-deploy`, state in `/var/lib/wisp-deploy`, Compose files and secrets in `/etc/wisp`. Never run `sudo ops/install.sh production` on a host whose stack runs under another Compose project: the next deploy would start an empty stack beside the existing volumes.

`wisp-deploy-production.timer` runs `deploy.sh production` every 5 minutes and deploys `:release`. A failed image pull is retried twice, 15 and 30 seconds apart, before the run fails. Before any API image change it takes a validated database backup; a failed backup cancels the deploy. Images that fail to deploy are skipped until `:release` moves.

CI moves `:release` to the newest green `:main` every night at 02:23 UTC, and the next deploy run picks it up (`docs/ci-and-images.md`, Release). To release now, run the `Release` workflow on `main` (Actions → Release → Run workflow, or `gh workflow run release.yml --ref main`); it ships everything merged since the last release, and its summary lists those commits. A deploy with an unchanged `:release` changes nothing.

PostgreSQL, Redis, Mailpit and Tailscale are pinned by `tag@digest` in the Compose files, and Dependabot proposes weekly bumps (no PostgreSQL or Redis majors). Before every deploy run, `wisp-sync-pins.service` (root, `sync-pins.sh`) copies a merged bump from `main` into the installed Compose files when the only change is a tag@digest `image:` line for the same image, major version and variant that moves forward (a higher version, or the same tag at the digest Docker Hub currently serves); downgrades and anything else still need `sudo ops/install.sh production`. The deploy run then recreates the services whose pin changed, taking the same backup first when PostgreSQL changes, and waits for health. There is no automatic rollback for these. After a failed pin update, deploys stop until a pin changes or the `failed-pins-*` file in the state directory is removed.

```bash
journalctl -u wisp-deploy-production.service -n 50    # what happened
cat /var/lib/wisp-deploy/deployed.env                 # what is deployed
```

`wisp-backup.timer` runs `backup.sh` on a schedule and keeps a fixed number of timestamped `wisp-<YYYYMMDD-HHMMSS>.dump` archives in `~/backups/wisp`; manual `wisp-pre-*.dump` files are never pruned. Schedule, directory and retention are set by the units `install.sh` installs.

After changing anything else in `ops/`, install from a clean `main` checkout:

```bash
git fetch && git checkout --detach origin/main
sudo ops/install.sh production
```

To see whether the server runs what a checkout holds, run `sudo ops/install.sh production --check` (`ops/install.sh staging --check` for staging). It renders the same files the install would, prints a diff for each installed file that differs, is missing or has another mode, and exits 1 if any does. It writes nothing. The installed version it prints is informational: `main` moves on without ops changes.

Production secrets live in `/etc/wisp/production.env` (mode 600), outside the repository. Its Redis key prefixes (`SESSION_REDIS_KEY`, `EMAIL_VERIFICATION_REDIS_KEY`, `PASSWORD_RESET_REDIS_KEY`) take `wisp-` values. Email goes through authenticated SMTP with STARTTLS required.

### Claude categorization

The API calls the Anthropic API with `ANTHROPIC_API_KEY` from the production env file, and, with `AI_CATEGORIZATION_WEB_SEARCH_ENABLED=true`, the Brave Search API with `BRAVE_SEARCH_API_KEY` (the API refuses to start without it). A failed or out-of-credit search only means the model decides without web results. While the API is unavailable (rate limit, overload, an exhausted credit balance, a refused key, no connection), transactions stay pending and queue retries, then hourly reconciliation, retry them.

### Merchant logos

`MERCHANT_LOGOS_ENABLED=true` in `/etc/wisp/production.env` turns merchant logos on. The first start identifies every existing merchant key in batches of 50 and then fetches each confirmed site's icon, so expect a few minutes of model calls and outbound HTTPS requests to merchant sites, `icons.duckduckgo.com` and, with `LOGO_DEV_SECRET_KEY` set, `api.logo.dev`. logo.dev's free plan has a monthly credit allowance; when it runs out, logos come from the merchants' sites and logo.dev is asked again the next day.

### Statement file import

`FILE_IMPORT_ENABLED=true` in `/etc/wisp/production.env` turns statement file import on, and `FILE_IMPORT_MAPPER_ENABLED=true` lets a file in no known layout have its columns worked out by one model call on a masked sample; the mapper needs `ANTHROPIC_API_KEY`.

### Push notifications

`WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` (a `mailto:` contact) in `/etc/wisp/production.env` turn push alerts on; generate the pair once with `npx web-push generate-vapid-keys`. Without them, Settings says the server sends no notifications. Changing the pair ends every device's subscription: on each device, turn notifications off and allow them again in Settings → Account. Pushes go out to Apple's, Google's, Mozilla's and Microsoft's push services.

### Network boundary

PostgreSQL, Redis and the API share the `default` network. The API also joins the internal `frontend` network; web joins `frontend`, the web-only `ingress` network that publishes its loopback port, and the `tailscale` network it shares with the Tailscale sidecar. Web therefore has no network path to the database or cache. Do not mark `default` internal: the API needs outbound access.

The `tailscale` network has a fixed subnet so the sidecar gets the static address `10.213.47.2`, outside the range Docker assigns to web. Web's Nginx takes the client address from `X-Forwarded-For` only on requests from that address, so the API sees tailnet clients' `100.x` addresses while local processes and other containers cannot set their own. Staging's sidecar uses the same address on its own daemon (`staging/README.md`). Changing the address needs the matching change in `apps/web/nginx/tempo.conf` and in both environments' Compose files. Compose changes to either network reach running containers only when they are recreated: after `sudo ops/install.sh production`, recreate web (`deploy.sh` only does that when an image changes) and then the sidecar.

### Container privileges

Every production container runs with `no-new-privileges` and drops all Linux capabilities. The API runs as uid and gid 10001, set by number in the host-owned Compose file so an image cannot switch itself to root. Production uses the root Docker daemon without user namespaces, so a container uid is the same host uid: 10001 belongs to no host account, while the image's own `node` user (1000) would be the production server's admin user, who can use sudo. The API reads the banking key as that uid, so the key file at `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` belongs to that admin user and group 10001, mode 0440, which also keeps it readable for uid 1000 during a switch or rollback. A uid change goes into the Compose file and the key's group together. The official PostgreSQL, Redis and Nginx images start as root to fix ownership and switch to their service user, so they keep only `CHOWN`, `SETUID` and `SETGID` (PostgreSQL also `DAC_OVERRIDE` and `FOWNER`). The Tailscale sidecar uses userspace networking and needs none. Like network changes, these settings reach running containers only when they are recreated: after `sudo ops/install.sh production`, recreate PostgreSQL, Redis, API and web, then the sidecar. Set the key's group before the API moves to a new uid; it also works for the old one, so a rollback only reinstalls the previous Compose file.

### Read-only Redis access

Redis's default user has no password and full rights; the API uses it from the `default` network. For inspection, Redis also defines `wisp_readonly` (`production.compose.yml`): it reads `banking:*` keys and runs `SCAN` and `DBSIZE`, and Redis refuses it writes, scripts, `KEYS`, `CONFIG`, `ACL` and reads of any other key, so session values stay out of reach. Key names it lists include session ids, which are useless without the session secret that signs the cookie. Connect with `docker exec wisp-production-redis-1 redis-cli --user wisp_readonly --pass unused <command>`. Redis enforces these limits only on a connection logged in as `wisp_readonly`: without `--user` and `--pass`, or with a later `--user`, `AUTH` or `-a`, `redis-cli` gets the default user's full rights. Whoever runs `docker exec` chooses the user. The user takes effect when Redis is recreated after `sudo ops/install.sh production` (`docker compose up -d redis`); the data in its `/data` volume carries over.

### Egress firewall

`wisp-api-egress.service` runs `wisp-api-egress.sh` (installed as `/usr/local/sbin/wisp-api-egress`) at boot, after Docker. It loads the nftables table `wisp_api_egress`, which keeps the API reaching only DNS and the internet even if code escapes the container. Processes running as uid 10001 on the host may use the local DNS resolver and public addresses, but nothing on loopback, private or link-local ranges, or the tailnet. New connections from the `default` and `ingress` networks to private, link-local and tailnet addresses or to the host itself are refused; traffic within one network is untouched, and the `tailscale` network is left alone because the sidecar needs its peers. The script finds the networks' bridges each run and fails if one is missing, so after `sudo ops/install.sh production` changes the script or its unit, or after either network is recreated, run `sudo systemctl reload wisp-api-egress`. A new server enables it once with `sudo systemctl enable --now wisp-api-egress`.

## Staging

An isolated rootless Docker daemon (`tempo-staging-docker.service`) runs a separate copy of the stack on `http://127.0.0.1:8119/` and, through its own Tailscale sidecar, at `https://tempo-staging.<tailnet>.ts.net/` for testing on mobile devices. Deploy any API/web pair with one command; an omitted component keeps its current image:

```bash
ops/install.sh staging                         # after changing ops/
tempo-deploy staging --api pr-115 --web main
```

A successful deploy refreshes the staging database from the newest production backup, so staging stays on loopback and the tailnet: no Funnel, port forward or other route. See [`staging/README.md`](staging/README.md).
