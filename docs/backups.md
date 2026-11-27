# Backups and recovery

How production's off-site backups are set up and used. What runs and when is in [`ops/README.md`](../ops/README.md) (Backups, Restore drill). The examples use the synthetic Storage Box `u000000.your-storagebox.de`; the real one is in `/etc/wisp/backup.env` on the server.

## Setting up the repository

As the deploy user on a new server:

```bash
sudo apt install restic
ssh-keygen -t ed25519 -f ~/.ssh/wisp-backup -N ''
printf 'Host u000000.your-storagebox.de\n    User u000000\n    Port 23\n    IdentityFile ~/.ssh/wisp-backup\n' >>~/.ssh/config
ssh u000000.your-storagebox.de install-ssh-key <~/.ssh/wisp-backup.pub   # asks for the Storage Box password once
sudo install -m 600 -o "$USER" /dev/null /etc/wisp/backup.env
read -rsp 'restic password: ' pw && printf 'RESTIC_REPOSITORY=sftp:u000000.your-storagebox.de:wisp\nRESTIC_PASSWORD=%s\n' "$pw" >/etc/wisp/backup.env; unset pw
set -a; . /etc/wisp/backup.env; set +a
restic init                                  # once per repository; skip when rebuilding onto an existing one
sudo systemctl enable --now wisp-backup.timer wisp-restore-drill.timer
sudo systemctl start wisp-backup.service && restic snapshots
```

`journalctl -u wisp-backup.service -n 50` shows the last runs. To list the snapshots: `set -a; . /etc/wisp/backup.env; set +a; restic snapshots --host wisp-production`.

## Restoring by hand

To put production back to a snapshot, as the deploy user (`restic snapshots --host wisp-production` lists them; `latest` is the newest):

```bash
set -a; . /etc/wisp/backup.env; set +a
restic dump --host wisp-production --tag wisp-db <snapshot> /wisp.dump >~/backups/wisp/restore.dump
docker exec wisp-production-postgres-1 pg_dump --format=custom -U wisp wisp >~/backups/wisp/wisp-pre-restore-"$(date +%Y%m%d-%H%M%S)".dump
sudo systemctl stop wisp-deploy-production.timer
docker stop wisp-production-web-1 wisp-production-api-1
docker exec -i wisp-production-postgres-1 pg_restore --clean --if-exists --no-owner --exit-on-error -U wisp -d wisp <~/backups/wisp/restore.dump
docker start wisp-production-api-1 wisp-production-web-1
sudo systemctl start wisp-deploy-production.timer
rm ~/backups/wisp/restore.dump
```

Everything written after the snapshot is lost; the `wisp-pre-restore-*.dump` holds it until it is deleted by hand.

## Rebuilding the server from Helsinki

When the server is lost, a new one is rebuilt from the newest snapshot, losing at most the 6 hours since it:

1. Create a new server of the same type and bring it to the production baseline with `ops/wizard.sh setup` up to its DNS records stage ([`new-host.md`](new-host.md)).
2. Put back the owner's off-server copies: `/etc/wisp/production.env`, the banking key at `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` (ownership and mode as in Container privileges in `ops/README.md`) and the restic password. Set up the Storage Box key and `/etc/wisp/backup.env` as in Setting up the repository, without `restic init` and without enabling the timers yet, and the release token: `sudo install -m 600 -o "$USER" /dev/null /etc/wisp/release-trigger.env`, then `read -rsp 'token: ' t && printf 'RELEASE_TRIGGER_TOKEN=%s\n' "$t" >/etc/wisp/release-trigger.env; unset t` (Production in `ops/README.md`).
3. From a clean `main` checkout, `sudo ops/install.sh production`.
4. Start PostgreSQL alone, create the read-only role (Read-only database access in `ops/README.md`; the dump's grants name it), and restore the newest snapshot into it:

   ```bash
   compose() { WISP_API_IMAGE=unused WISP_WEB_IMAGE=unused docker compose -p wisp-production -f /etc/wisp/compose/production.compose.yml --env-file /etc/wisp/production.env "$@"; }
   compose up -d --wait postgres
   docker exec -i wisp-production-postgres-1 psql -U wisp -d wisp -v ON_ERROR_STOP=1 <<'SQL'
   CREATE ROLE wisp_readonly LOGIN;
   ALTER ROLE wisp_readonly SET default_transaction_read_only = on;
   ALTER ROLE wisp_readonly SET statement_timeout = '30s';
   GRANT CONNECT ON DATABASE wisp TO wisp_readonly;
   GRANT USAGE ON SCHEMA public TO wisp_readonly;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO wisp_readonly;
   ALTER DEFAULT PRIVILEGES FOR ROLE wisp IN SCHEMA public GRANT SELECT ON TABLES TO wisp_readonly;
   SQL
   mkdir -p ~/backups/wisp
   set -a; . /etc/wisp/backup.env; set +a
   restic dump --host wisp-production --tag wisp-db latest /wisp.dump >~/backups/wisp/restore.dump
   docker exec -i wisp-production-postgres-1 pg_restore --no-owner --exit-on-error -U wisp -d wisp <~/backups/wisp/restore.dump
   rm ~/backups/wisp/restore.dump
   ```

5. Start the app on the `:release` images, then hand it to the deploy timer:

   ```bash
   sudo mkdir -p /var/lib/wisp-deploy && sudo chown "$USER" /var/lib/wisp-deploy
   docker pull ghcr.io/wispmoney/api:release && docker pull ghcr.io/wispmoney/web:release
   printf 'WISP_API_IMAGE=%s\nWISP_WEB_IMAGE=%s\n' "$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/wispmoney/api:release)" \
       "$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/wispmoney/web:release)" >/var/lib/wisp-deploy/deployed.env
   docker compose -p wisp-production -f /etc/wisp/compose/production.compose.yml --env-file /etc/wisp/production.env --env-file /var/lib/wisp-deploy/deployed.env up -d --wait
   sudo systemctl enable --now wisp-api-egress wisp-deploy-production.timer wisp-release-trigger.timer wisp-backup.timer wisp-restore-drill.timer
   ```

6. Point the app's DNS records at the new server, check that you can log in, and run the drill once: `sudo systemctl start wisp-restore-drill.service`.
