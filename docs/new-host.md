# New host

How a fresh server becomes production with `ops/wizard.sh`. What runs on the finished server is in [`ops/README.md`](../ops/README.md); backups and rebuilding from Helsinki are in [`backups.md`](backups.md).

The wizard shows every root command exactly and runs it with `sudo` only when the owner answers yes; a no leaves it for the owner to run by hand. Secrets are typed by the owner at hidden prompts or generated in place, and the wizard prints none of them and writes no log.

## Before setup

The owner creates the server (Hetzner Cloud CX23, Ubuntu 26.04 LTS, the owner's SSH key) with a firewall that admits TCP 22, 80 and 443; port 22 closes during setup. Then, as root over SSH:

```bash
adduser admin                      # any name; its password is for sudo and the Hetzner web console
usermod -aG sudo admin
install -d -m 700 -o admin -g admin ~admin/.ssh
install -m 600 -o admin -g admin ~/.ssh/authorized_keys ~admin/.ssh/
```

As the admin user: `git clone https://github.com/wispmoney/wisp.git ~/wisp && ~/wisp/ops/wizard.sh setup`. The `Release` workflow must have run once, so `:release` exists. The admin user becomes the deploy user: the units run as it, it owns the env files, and it is uid 1000 (see Container privileges in the ops README).

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
| Directories, env file, banking key | `/etc/wisp` and `/var/lib/wisp-deploy`; `/etc/wisp/production.env` filled by the env part below; the Enable Banking key copied from the owner's off-server copy to `/etc/wisp/enable-banking-private.key` (admin user, group 10001, mode 0440) |
| Off-site backups | The Storage Box SSH key and `/etc/wisp/backup.env` (repository, and the restic password at a hidden prompt), then `restic init`, as in `backups.md` |
| Release trigger | `/etc/wisp/release-trigger.env`: a fine-grained GitHub token for this repository with Actions write only, typed at a hidden prompt (Production in the ops README) |
| Install and start | `sudo ops/install.sh production`, the deploy and release-trigger timers and a first deploy, the egress firewall, the backup and drill timers with one backup and one drill, and a test failure email |

Production data comes back from Helsinki ([`backups.md`](backups.md), Rebuilding the server from Helsinki). Staging's feed ([`staging-feed.md`](staging-feed.md), Setting it up) needs the owner's account id, so it is set up after that restore.

## The env file

`ops/wizard.sh env` fills `/etc/wisp/production.env` on the server and can run again at any time; Enter keeps a value already there.

- Fixed: the wisp database name and user, the `wisp-` Redis key prefixes, `WEB_BASE_URL=https://app.wispmoney.com` and the Enable Banking redirect at `https://app.wispmoney.com/bank-connections/callback`. Defaults the owner may change: session and token lifetimes, rate limits.
- Generated once, never shown: `DB_PASSWORD` (PostgreSQL keeps the first one) and `SESSION_SECRET`, so every device logs in again; a new VAPID key pair for push, made with the API image.
- Typed by the owner: `ENABLE_BANKING_APPLICATION_ID` and `BANKING_SESSION_ENCRYPTION_KEY_B64`, both production's (stored bank sessions are encrypted with that key); Scaleway's SMTP user (the project ID) and password (an API secret key), `EMAIL_FROM` at `wispmoney.com`, `OPERATOR_ALERT_EMAIL`; the feature flags and the API keys they need.
