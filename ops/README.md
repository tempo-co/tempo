# Tempo operations

CI builds an image of each app a commit changes and publishes `ghcr.io/tempo-co/{api,web}` tags for same-repo PRs and `main` (`docs/ci-and-images.md`). `ops/deploy.sh` deploys those images to both targets: it resolves tags to digests, recreates API and web (plus any pinned service whose pin changed, see below), waits for health, and restores the previous images if the new ones are unhealthy. Database migrations are not rolled back. A new host gets the whole stack started, retried by the next run.

| File | Purpose |
|---|---|
| `deploy.sh` | Deploy script for both targets |
| `targets/production.env`, `targets/staging.env` | Non-secret per-target settings |
| `backup.sh` | Validated `pg_dump`, scheduled (uploaded off-site with restic) and pre-deploy (local only) |
| `restore-drill.sh` | Monthly restore of the newest off-site backup into a throwaway database, checked table by table |
| `failure-email.sh` | Emails the operator when a server unit fails (see Failure emails) |
| `release-trigger.sh` | Starts the nightly `Release` workflow |
| `install.sh` | Copies the above to the production server; `--check` lists installed files that differ from the checkout |
| `sync-pins.sh` | Applies image-pin-only Compose changes from `main` before each production deploy |
| `wisp-api-egress.sh` | Egress firewall for the API uid and production's container networks (see Egress firewall) |
| `wizard.sh` | A new server's setup and its env file (see New host) |
| `test-deploy.sh`, `test-sync-pins.sh`, `test-release-trigger.sh` | Offline tests of `deploy.sh`, `sync-pins.sh` and `release-trigger.sh`, run by CI's `Ops checks`: stub `docker` or `curl` in a temporary sandbox, never a Docker daemon, registry, GitHub or installed file |
| `test-backup.sh` | Offline tests of `backup.sh`, `restore-drill.sh` and `failure-email.sh`, run by CI's `Ops checks`: stub `docker` and `restic` and use a local fake mail server |
| `production.compose.yml` | Production stack: PostgreSQL, Redis, API, web and Caddy |
| `Caddyfile` | Caddy's site config: HTTPS for `app.wispmoney.com`, HSTS, the bare domain's redirect (see Public entry) |
| `ghcr-retention.sh` | Weekly GHCR cleanup of both packages (`.github/workflows/ghcr-retention.yml`): keeps `main`, `release`, open PRs' `pr-<n>` and anything newer than 30 days. Also keeps the images of the last 5 `main` commits that changed the app as rollback targets. Dry run until the repo variable `GHCR_RETENTION_DELETE=true`; GitHub pauses scheduled workflows after 60 days without repo activity |
| `systemd/` | Production timers, the egress firewall and the failure-email hook (installed by `install.sh`); staging Docker daemon (user unit, installed once by hand) |
| `staging/` | Staging Compose files (stack and Tailscale sidecar), env templates, database refresh |

## Production

The production host uses wisp names: Compose project `wisp-production` (containers such as `wisp-production-postgres-1`), database and database user `wisp`, units `wisp-*`, deploy tooling in `/usr/local/lib/wisp-deploy`, state in `/var/lib/wisp-deploy`, Compose files and secrets in `/etc/wisp`. Never run `sudo ops/install.sh production` on a host whose stack runs under another Compose project: the next deploy would start an empty stack beside the existing volumes.

`wisp-deploy-production.timer` runs `deploy.sh production` every 5 minutes and deploys `:release`. A failed image pull is retried twice, 15 and 30 seconds apart, before the run fails. Before any API image change it takes a validated database backup into `/var/lib/wisp-deploy/pre-deploy-backups`, keeping the newest 3 there; a failed backup cancels the deploy. Images that fail to deploy are skipped until `:release` moves.

`wisp-release-trigger.timer` starts the `Release` workflow on `main` at 02:23 UTC, as GitHub's own schedule is best-effort; the next deploy picks up the new `:release`, and releasing by hand is in `docs/ci-and-images.md` (Release). Its token, `RELEASE_TRIGGER_TOKEN` in `/etc/wisp/release-trigger.env` can only start this repository's workflows; a refused request (an expired token) fails the unit and sends the failure email.

PostgreSQL, Redis, Caddy, Mailpit and Tailscale (staging) are pinned by `tag@digest` in the Compose files, and Dependabot proposes weekly bumps (no PostgreSQL or Redis majors). Before every deploy run, `wisp-sync-pins.service` (root, `sync-pins.sh`) copies a merged bump from `main` into the installed Compose file when the only change is a tag@digest `image:` line for the same image, major version and variant that moves forward (a higher version, or the same tag at the digest Docker Hub currently serves); anything else needs `sudo ops/install.sh production`. The deploy run then recreates the services whose pin changed, taking the same backup first when PostgreSQL changes, and waits for health. No automatic rollback; after a failed pin update, deploys stop until a pin changes or the state directory's `failed-pins-*` file is removed.

```bash
journalctl -u wisp-deploy-production.service -n 50    # what happened
cat /var/lib/wisp-deploy/deployed.env                 # what is deployed
```

After changing anything else in `ops/`, install from a clean `main` checkout:

```bash
git fetch && git checkout --detach origin/main
sudo ops/install.sh production
```

To see whether the server runs what a checkout holds, run `sudo ops/install.sh production --check` (`ops/install.sh staging --check` for staging). It renders the same files the install would, prints a diff for each installed file that differs, is missing or has another mode, and exits 1 if any does. It writes nothing. The installed version it prints is informational: `main` moves on without ops changes.

Production secrets live in `/etc/wisp/production.env` (mode 600), outside the repository. Its Redis key prefixes (`SESSION_REDIS_KEY`, `EMAIL_VERIFICATION_REDIS_KEY`, `PASSWORD_RESET_REDIS_KEY`) take `wisp-` values. Email goes through Scaleway Transactional Email (`smtp.tem.scaleway.com`), authenticated, with STARTTLS required.

### Claude categorization

The API calls the Anthropic API with `ANTHROPIC_API_KEY` from the production env file, and, with `AI_CATEGORIZATION_WEB_SEARCH_ENABLED=true`, the Brave Search API with `BRAVE_SEARCH_API_KEY` (the API refuses to start without it). A failed or out-of-credit search only means the model decides without web results. While the API is unavailable (rate limit, overload, an exhausted credit balance, a refused key, no connection), transactions stay pending and queue retries, then hourly reconciliation, retry them.

### Merchant logos

`MERCHANT_LOGOS_ENABLED=true` in `/etc/wisp/production.env` turns merchant logos on. The first start identifies every existing merchant key in batches of 50 and then fetches each confirmed site's icon, so expect a few minutes of model calls and outbound HTTPS requests to merchant sites, `icons.duckduckgo.com` and, with `LOGO_DEV_SECRET_KEY` set, `api.logo.dev`. logo.dev's free plan has a monthly credit allowance; when it runs out, logos come from the merchants' sites and logo.dev is asked again the next day.

### Statement file import

`FILE_IMPORT_ENABLED=true` in `/etc/wisp/production.env` turns statement file import on, and `FILE_IMPORT_MAPPER_ENABLED=true` lets a file in no known layout have its columns worked out by one model call on a masked sample; the mapper needs `ANTHROPIC_API_KEY`.

### Push notifications

`WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT` (a `mailto:` contact) in `/etc/wisp/production.env` turn push alerts on; generate the pair once with `npx web-push generate-vapid-keys`. Without them, Settings says the server sends no notifications. Changing the pair ends every device's subscription: on each device, turn notifications off and allow them again in Settings → Account. Pushes go out to Apple's, Google's, Mozilla's and Microsoft's push services.

### Operator alerts

`OPERATOR_ALERT_EMAIL` in `/etc/wisp/production.env` is where the API emails failures no user sees through the app's SMTP settings: a scheduled bank sync run that fails as a whole or can't start, at most once a day per kind of failure. Unset, nothing is sent.

### Backups

`wisp-backup.timer` runs `backup.sh` every 6 hours (00:30, 06:30, 12:30 and 18:30) and catches up after downtime. Each run takes a validated `pg_dump` into `~/backups/wisp` (newest 4 `wisp-<YYYYMMDD-HHMMSS>.dump` kept; manual `wisp-pre-*.dump` files are never pruned) and uploads it with restic over SFTP to the Hetzner Storage Box in Helsinki, encrypted, as `/wisp.dump` of host `wisp-production`, tag `wisp-db`. Retention keeps every snapshot of the last 7 days, then the newest of each week up to 30 days, and prunes the rest. A failed dump, upload or prune fails the unit; a failed upload keeps the local dump. The Storage Box's automatic snapshots (Hetzner console) keep copies the server cannot delete.

Restic reads `RESTIC_REPOSITORY` (such as `sftp:u000000.your-storagebox.de:wisp`) and `RESTIC_PASSWORD` (letters and digits, typed by the owner, who keeps a copy off the server) from `/etc/wisp/backup.env` (mode 600, owned by the deploy user). Setting up the repository, restoring by hand and rebuilding a lost server from Helsinki are in [`docs/backups.md`](../docs/backups.md).

### Restore drill

`wisp-restore-drill.timer` runs `restore-drill.sh` on the 2nd of each month at 09:15 and catches up after downtime. It restores the newest snapshot into a throwaway PostgreSQL container (the live image, no network, a random password, removed afterwards) and fails unless every live table exists there, answers a row count, and is within 10% or 100 rows of live, whichever is larger (the unit's `DRILL_ROW_TOLERANCE_*`). A table a migration added since the snapshot fails it until the next backup; rerun with `sudo systemctl start wisp-restore-drill.service`.

### Failure emails

Every production unit has `OnFailure=wisp-failure-email@%n.service`, which runs `failure-email.sh`: it emails `OPERATOR_ALERT_EMAIL` the unit's name and its last 40 journal lines through the API's own SMTP settings (installed Compose file and `/etc/wisp/production.env`). Without `OPERATOR_ALERT_EMAIL` or `EMAIL_FROM` the hook fails and the alert stays in the journal (`journalctl -u 'wisp-failure-email@*'`). A new unit takes the same line; `test-backup.sh` fails for a `wisp-*.service` without it.

### Staging copy

`wisp-staging-copy.timer` (`wisp-staging-copy.sh`, `wisp-staging-copy-serve.sh`) builds staging's encrypted owner-only copy nightly: see [`docs/staging-feed.md`](../docs/staging-feed.md).

### Public entry

Caddy (`caddy` in `production.compose.yml`, configured by `Caddyfile`) publishes ports 80 and 443 on every host address and is the only way in from the internet. It gets Let's Encrypt certificates for `app.wispmoney.com` and `wispmoney.com` and renews them in the `wisp_production_caddy_data` volume. `app.wispmoney.com` proxies to web, including the public health page `/api/health` (database and Redis). `wispmoney.com` redirects (302, path kept) to `https://app.wispmoney.com` until the public site takes the bare domain. Port 80 redirects to HTTPS. Caddy sends `Strict-Transport-Security` (one year); web's Nginx sends every other security header. HTTP/3 is off, so the host firewall needs TCP 80 and 443 only. Web's loopback port `127.0.0.1:8080` stays for the deploy's health checks. Until launch, Caddy answers `403` to `/api/auth/signup` and below; deleting that rule opens sign-up.

Certificates are issued once both names resolve to the host; until then Caddy retries. A `Caddyfile` change reaches Caddy after `sudo ops/install.sh production` and `docker compose -p wisp-production exec caddy caddy reload --config /etc/caddy/Caddyfile`.

### New host

`ops/wizard.sh setup` brings a fresh Ubuntu 26.04 LTS server to this baseline and `ops/wizard.sh env` fills its env file, each root command approved by the owner: [`docs/new-host.md`](../docs/new-host.md).

### Network boundary

PostgreSQL, Redis and the API share the `default` network. The API also joins the internal `frontend` network; web joins `frontend`, the web-only `ingress` network that publishes its loopback port, and the `proxy` network it shares with Caddy. Web therefore has no network path to the database or cache, and Caddy reaches only web. Do not mark `default` internal: the API needs outbound access.

The `proxy` network has a fixed subnet so Caddy gets the static address `10.213.47.2`, outside the range Docker assigns to web. Caddy replaces any `X-Forwarded-For` a client sends with the client's address, and web's Nginx takes the client address from `X-Forwarded-For` only on requests from Caddy's address, so the API sees real client addresses while local processes and other containers cannot set their own. Staging's Tailscale sidecar uses the same address on its own daemon (`staging/README.md`), since both run the same web image. Changing the address needs the matching change in `apps/web/nginx/tempo.conf` and in both environments' Compose files; the web security-headers probe reads Caddy's address from `production.compose.yml`. Network changes in the Compose file reach running containers only when they are recreated: after `sudo ops/install.sh production`, recreate web (`deploy.sh` only does that when an image changes) and then Caddy.

### Container privileges

Every production container runs with `no-new-privileges` and drops all Linux capabilities. The API runs as uid and gid 10001, set by number in the host-owned Compose file so an image cannot switch itself to root. Production uses the root Docker daemon without user namespaces, so a container uid is the same host uid: 10001 belongs to no host account, while the image's own `node` user (1000) would be the production server's admin user, who can use sudo. The API reads the banking key as that uid, so the key file at `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` belongs to that admin user and group 10001, mode 0440, which also keeps it readable for uid 1000 during a switch or rollback. A uid change goes into the Compose file and the key's group together. The official PostgreSQL, Redis and Nginx images start as root to fix ownership and switch to their service user, so they keep only `CHOWN`, `SETUID` and `SETGID` (PostgreSQL also `DAC_OVERRIDE` and `FOWNER`). Caddy keeps only `NET_BIND_SERVICE`, which its binary needs to bind ports 80 and 443. Like network changes, these reach running containers only when recreated: after `sudo ops/install.sh production`, recreate PostgreSQL, Redis, API and web, then Caddy. Set the key's group before the API moves to a new uid; it also works for the old one, so a rollback only reinstalls the previous Compose file.

### Read-only database access

`wisp_readonly` reads every `public` table, read-only, 30-second timeout. Dumps omit roles; a rebuilt server recreates it (`docs/backups.md`).

### Read-only Redis access

Redis's default user has no password and full rights; the API uses it from the `default` network. For inspection, Redis also defines `wisp_readonly` (`production.compose.yml`): it reads `banking:*` keys and runs `SCAN` and `DBSIZE`, and Redis refuses it writes, scripts, `KEYS`, `CONFIG`, `ACL` and reads of any other key, so session values stay out of reach. Key names it lists include session ids, which are useless without the session secret that signs the cookie. Connect with `docker exec wisp-production-redis-1 redis-cli --user wisp_readonly --pass unused <command>`. Redis enforces these limits only on a connection logged in as `wisp_readonly`: without `--user` and `--pass`, or with a later `--user`, `AUTH` or `-a`, `redis-cli` gets the default user's full rights. Whoever runs `docker exec` chooses the user. The user takes effect when Redis is recreated after `sudo ops/install.sh production` (`docker compose up -d redis`); the data in its `/data` volume carries over.

### Egress firewall

`wisp-api-egress.service` runs `wisp-api-egress.sh` (installed as `/usr/local/sbin/wisp-api-egress`) at boot, after Docker. It loads the nftables table `wisp_api_egress`, which keeps the API reaching only DNS and the internet even if code escapes the container. Processes running as uid 10001 on the host may use the local DNS resolver and public addresses, but nothing on loopback, private or link-local ranges, or the tailnet. New connections from the `default`, `ingress` and `proxy` networks to private, link-local and tailnet addresses or to the host itself are refused; traffic within one network is untouched. The script finds the networks' bridges each run and fails if one is missing, so after `sudo ops/install.sh production` changes the script or its unit, or after one of those networks is recreated, run `sudo systemctl reload wisp-api-egress`. A new server enables it once with `sudo systemctl enable --now wisp-api-egress`.

## Staging

An isolated rootless Docker daemon (`tempo-staging-docker.service`) runs a separate copy of the stack on `http://127.0.0.1:8119/` and, through its own Tailscale sidecar, at `https://tempo-staging.<tailnet>.ts.net/` for testing on mobile devices. Deploy any API/web pair with one command; an omitted component keeps its current image:

```bash
ops/install.sh staging                         # after changing ops/
tempo-deploy staging --api pr-115 --web main
```

A successful deploy refreshes the staging database from production data, so staging stays on loopback and the tailnet: no Funnel, port forward or other route. See [`staging/README.md`](staging/README.md).
