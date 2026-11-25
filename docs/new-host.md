# New host

How a fresh server becomes production and how production moves onto it, with `ops/wizard.sh`. What runs on the finished server is in [`ops/README.md`](../ops/README.md); backups and rebuilding from Helsinki are in [`backups.md`](backups.md).

The wizard shows every root command exactly and runs it with `sudo` only when the owner answers yes; a no leaves it for the owner to run by hand. Secrets are typed by the owner at hidden prompts or generated in place, and the wizard prints neither them nor any row of data, and writes no log. Its settings on the laptop (the server's SSH address and checkout) are in `~/.local/state/wisp-move/settings.env`.

## Before setup

The owner creates the server (Hetzner Cloud CX23, Ubuntu 26.04 LTS, the owner's SSH key) with a firewall that admits TCP 22, 80 and 443; port 22 closes during setup. Then, as root over SSH:

```bash
adduser admin                      # any name; its password is for sudo and the Hetzner web console
usermod -aG sudo admin
install -d -m 700 -o admin -g admin ~admin/.ssh
install -m 600 -o admin -g admin ~/.ssh/authorized_keys ~admin/.ssh/
```

As the admin user: `git clone https://github.com/tempo-co/tempo.git ~/tempo && ~/tempo/ops/wizard.sh setup`. The `Release` workflow must have run once, so `:release` exists. The admin user becomes the deploy user: the units run as it, it owns the env files, and it is uid 1000 (see Container privileges in the ops README).

## Setup

`ops/wizard.sh setup` runs on the server from a clean checkout of main. A re-run skips what is done; it stops once for a new login after joining groups.

| Stage | What it does |
|---|---|
| Packages | `docker.io`, `docker-compose-v2`, `git`, `curl`, `jq`, `nftables`, `restic`, `python3`, `unattended-upgrades` from Ubuntu's archive; the admin user joins `docker` and `systemd-journal` |
| Automatic security updates | Daily security updates; a reboot they need happens at 04:00 server time (UTC), clear of the 02:23 UTC release and the backups |
| Tailscale | Tailscale's apt repository, `tailscale up`, its own auto-update; the owner turns off the server's key expiry in the admin console |
| SSH on the tailnet only | OpenSSH listens on the server's Tailscale addresses only (`ListenAddress` in `/etc/ssh/sshd_config.d/10-wisp-tailnet.conf`), keys only, no root login. sshd runs as `ssh.service` rather than from Ubuntu's socket, and `ip_nonlocal_bind` lets it bind those addresses before `tailscale0` is up at boot. The Hetzner web console is the way in when the tailnet is down |
| Hetzner firewall | Printed for the owner to apply with the write token: inbound TCP 80 and 443 from anywhere, nothing else, no outbound rules |
| DNS records | Printed with the server's addresses: A (and AAAA) for `app` and the bare domain, Scaleway's SPF and DKIM records as Scaleway's console shows them |
| Directories, env file, banking key | `/etc/wisp` and `/var/lib/wisp-deploy`; `/etc/wisp/production.env` filled by the env part below; the Enable Banking key copied from the laptop to `/etc/wisp/enable-banking-private.key` (admin user, group 10001, mode 0440) |
| Off-site backups | The Storage Box SSH key and `/etc/wisp/backup.env` (repository, and the restic password at a hidden prompt), then `restic init`, as in `backups.md` |
| Install and start | `sudo ops/install.sh production`, the deploy timer and a first deploy, the egress firewall, the backup and drill timers with one backup and one drill, and a test failure email |

Staging's feed ([`staging-feed.md`](staging-feed.md), Setting it up) needs the owner's account id, so it is set up after move night.

## The env file

`ops/wizard.sh env` fills `/etc/wisp/production.env` on the server and can run again at any time; Enter keeps a value already there.

- Fixed: the wisp database name and user, the `wisp-` Redis key prefixes, `WEB_BASE_URL=https://app.wispmoney.com` and the Enable Banking redirect at `https://app.wispmoney.com/bank-connections/callback`. Defaults the owner may change: session and token lifetimes, rate limits.
- Generated once, never shown: `DB_PASSWORD` (PostgreSQL keeps the first one) and `SESSION_SECRET`, so every device logs in again after the move; a new VAPID key pair for push, made with the API image.
- Typed by the owner: `ENABLE_BANKING_APPLICATION_ID` and `BANKING_SESSION_ENCRYPTION_KEY_B64`, both the laptop's (stored bank sessions are encrypted with that key); Scaleway's SMTP user (the project ID) and password (an API secret key), `EMAIL_FROM` at `wispmoney.com`, `OPERATOR_ALERT_EMAIL`; the feature flags and the API keys they need.

## Move gate

`ops/wizard.sh gate`, from the laptop, checks: HTTPS at the app with HSTS, the bare domain's redirect, no answer on the public address for ports 22, 3000, 5432, 6379 and 8080, sshd listening on tailnet addresses only, the egress firewall loaded, the backup timer running, an off-site snapshot less than 7 hours old, and a passed restore drill in the journal. An agent checks the Hetzner firewall's rule list with the read-only token. `rehearse` and `move` run the gate first and stop if it fails.

## Move night

`ops/wizard.sh move`, on the laptop, as the user that runs the laptop's production. The laptop keeps its tempo names (`tempo-api-production` containers, `tempo` database, `tempo-*` units); the server uses wisp names. In order:

1. The gate, and the redirect URL added to the Enable Banking application (the laptop's stays until switch-off).
2. The server's env file compared with the laptop's: the two data-bound values by hash, the address, prefixes and email settings by name. The env part runs on the server until they match. The banking key is compared the same way and copied over the tailnet if it differs.
3. Freeze: the laptop's deploy timer is disabled and its API and web stopped. The API image the laptop runs must be the server's too, since the restored schema must fit the server's code; the wizard waits for a release otherwise.
4. The server's timers, API and web stop, and its own database is saved in `~/backups/wisp/wisp-pre-move-*.dump`.
5. A validated dump of the laptop's database, copied to the server over the tailnet and checked by sha256, restored into a fresh `wisp` database; Redis is emptied.
6. The per-table check (`ops/table-check.sh`): every table's row count and a hash of its sorted row hashes, read in one read-only snapshot with fixed output settings on both sides, printing differing tables by name only. It runs before the API starts, because the API writes on start. A difference keeps the server's app stopped and offers to restart the laptop.
7. The server's app starts, its timers restart, and the first backup of the moved data runs.
8. Manual steps: log in again on each device (and replace home-screen apps with the new address), turn notifications on again, change MCP clients to `https://app.wispmoney.com/api/mcp` (tokens moved with the data).

After the night: the next scheduled sync must succeed, and the laptop stays as the way back until the switch-off checks pass (row counts and hashes, that sync, a test restore of one Helsinki backup), a separate step with the owner's go.

## Rehearsal

`ops/wizard.sh rehearse` runs the same steps against the real server, then puts the server back as it was. It differs in that:

- the laptop's deploy timer is stopped, not disabled, and starts again at the end;
- before changing anything, it saves the server's env file, banking key, running timers and database (with its per-table fingerprints) in `~/wisp-move` on the server and `~/.local/state/wisp-move` on the laptop;
- the restored copy gets no scheduled bank syncs and sends no bank alerts (`BANK_CONNECTION_ALERTS_ENABLED=false` until the reset), and the server's timers stay stopped, so no backup or staging copy of it is made. A sync started by hand in the app still reaches the bank.

The reset restores the server's database, compares its fingerprints with the saved ones, empties Redis, restores the env file and key, starts the app and the timers that ran before, and deletes the saved files. Then the laptop's API, web and deploy timer start again. If a rehearsal stops part way, `ops/wizard.sh reset` finishes the reset; `rehearse` and `move` refuse to start while one is pending.
