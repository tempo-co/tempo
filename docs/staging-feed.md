# Staging feed

Staging runs on real data from one account only: the owner's. The production server builds that copy each night and encrypts it so only staging can read it; staging fetches it over the tailnet on each refresh. No other account's data leaves the server. Staging's side of the refresh is in [`ops/staging/README.md`](../ops/staging/README.md) (Database refresh, Database feed).

## The nightly copy

`wisp-staging-copy.timer` runs `ops/wisp-staging-copy.sh` at 01:15, after the 00:30 backup, and catches up after downtime. It fails the unit on any problem, which emails the operator (`ops/README.md`, Failure emails). Each run:

1. Copies the filter `apps/api/wisp-staging-copy.sql` out of the running API container, so the rules always come from the release whose migrations shaped the database.
2. Takes the newest local `wisp-<YYYYMMDD-HHMMSS>.dump` in `~/backups/wisp`, which `ops/backup.sh` publishes only after validating it.
3. Restores it into a throwaway PostgreSQL container: the live image, no network, a random password, removed afterwards.
4. Runs the filter there with the account `STAGING_COPY_OWNER_ACCOUNT_ID` from `/etc/wisp/staging-copy.env`.
5. Dumps the result, checks the archive reads back, and encrypts it with `gpg` to staging's public key at `/etc/wisp/staging-copy.pub.asc`.
6. Keeps the newest 3 `wisp-staging-copy-<YYYYMMDD-HHMMSS>.dump.gpg` in `/var/lib/wisp-staging-copy`.

The job refuses a key file that holds a secret key, so nothing on the server can decrypt a copy. The decryption key exists only on the laptop.

## The filter

`apps/api/wisp-staging-copy.sql` lists every table with one rule. It ships in the API image, so a rule reaches the server with the release that adds its table:

- `owned`: each row belongs to one account; rows that are not the owner's are deleted. A row owned through a parent (a bank account through its connection) is checked through that parent.
- `shared`: no account owns the row; only rows the owner's rows use are kept. Merchant logos, keyed by domain, are kept only when one of the owner's merchants uses them.
- `global`: reference data no account owns, kept whole, such as FX rates and the migration history.

A table in the restored database without a rule fails the run before anything changes, so a migration that adds a table needs a rule in the same PR. After deleting, the run fails unless exactly the owner's account remains and every owned and shared row passes its rule; any failure rolls the whole filter back. A rule for a table the restored schema does not have yet is skipped, since the newest backup can predate the running API's migrations. After a rollback to an API older than the database's schema, the run fails until a release with the rule is back.

`apps/api/test/e2e/database/staging-copy.e2e.spec.ts` builds a database at the current schema with two accounts, each with rows in every table, and checks that the filter keeps exactly the owner's rows, the logos the owner's merchants use and all reference data, and that a table without a rule or a missing owner account fails without changing anything. CI runs it in `API E2E tests` whenever the API or the filter changes.

## The feed account

Staging fetches over SSH as `wisp-staging-feed`, a system account whose only access beyond its own home is reading `/var/lib/wisp-staging-copy` (through its group). Its `authorized_keys` forces `ops/wisp-staging-copy-serve.sh`, which writes the newest copy to stdout whatever command the client asks for, and `restrict` turns off forwarding and terminals. The forced command needs OpenSSH to serve the tailnet login; Tailscale SSH ignores `authorized_keys`, so its ACLs must not admit `wisp-staging-feed`.

## Setting it up

On the laptop, as the staging user (the secret key stays there):

```bash
cd ~/.config/tempo-staging
install -d -m 700 feed-gnupg feed-ssh
gpg --homedir feed-gnupg --batch --passphrase '' --quick-gen-key 'Wisp staging feed <staging-feed@example.invalid>' future-default default never
gpg --homedir feed-gnupg --armor --export staging-feed@example.invalid >staging-feed.pub.asc
ssh-keygen -t ed25519 -N '' -C wisp-staging-feed -f feed-ssh/id_ed25519
```

Copy `staging-feed.pub.asc` and the SSH public key (feed-ssh/id_ed25519.pub, as staging-feed-ssh.pub) to the server. There, as the deploy user, after `sudo ops/install.sh production`:

```bash
sudo install -m 644 staging-feed.pub.asc /etc/wisp/staging-copy.pub.asc
printf 'STAGING_COPY_OWNER_ACCOUNT_ID=%s\n' '<owner account uuid>' | sudo tee /etc/wisp/staging-copy.env >/dev/null
sudo useradd --system --create-home --shell /bin/sh wisp-staging-feed
sudo install -d -m 2750 -o "$USER" -g wisp-staging-feed /var/lib/wisp-staging-copy
sudo install -d -m 700 -o wisp-staging-feed -g wisp-staging-feed ~wisp-staging-feed/.ssh
printf 'restrict,command="/usr/local/lib/wisp-deploy/wisp-staging-copy-serve.sh" %s\n' "$(cat staging-feed-ssh.pub)" |
    sudo tee ~wisp-staging-feed/.ssh/authorized_keys >/dev/null
sudo chown wisp-staging-feed: ~wisp-staging-feed/.ssh/authorized_keys && sudo chmod 600 ~wisp-staging-feed/.ssh/authorized_keys
sudo systemctl enable --now wisp-staging-copy.timer && sudo systemctl start wisp-staging-copy.service
```

Back on the laptop, pin the server's host key (check its fingerprint against the server's) and name the feed account:

```bash
cd ~/.config/tempo-staging
ssh-keyscan -t ed25519 <server tailnet name> >feed-ssh/known_hosts
printf 'STAGING_FEED_SSH=wisp-staging-feed@<server tailnet name>\n' >feed.env
```

The next `tempo-deploy staging` that changes an image restores from the server's copy.
