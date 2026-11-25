#!/usr/bin/env bash
# Replace the staging database with production data, or with seed data.
#
#   tempo-staging-refresh.sh refresh --confirm-production-backup-refresh   # run by `tempo-deploy staging`
#   tempo-staging-refresh.sh seed --confirm-seeded-reset
#
# A refresh takes its data from the feed set in feed.env (see feed.env.example): the production
# server's encrypted owner-only copy, fetched over the tailnet and decrypted here, or the newest
# local production backup. Restores into a temporary database, applies the current schema, clears
# bank provider sessions and sync state, then swaps it in. If staging is unhealthy after the swap,
# the previous database is restored. Never connects to production's database or copies its Redis.
set -Eeuo pipefail
shopt -s inherit_errexit

CONFIG_DIR=$HOME/.config/tempo-staging
BACKUP_DIR=$HOME/backups/tempo
STATE_DIR=$HOME/.local/state/tempo-staging
FEED_ENV=$CONFIG_DIR/feed.env
FEED_SSH_DIR=$CONFIG_DIR/feed-ssh
FEED_GNUPG=$CONFIG_DIR/feed-gnupg
# Always the staging daemon, whatever the caller's environment points at.
unset DOCKER_CONTEXT TEMPO_API_IMAGE TEMPO_WEB_IMAGE STAGING_DB_NAME STAGING_DB_USERNAME STAGING_DB_PASSWORD
export DOCKER_HOST=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/tempo-staging/docker.sock
export DOCKER_CONFIG=$CONFIG_DIR/docker-config
TEMP_DB=tempo_staging_refresh
PREVIOUS_DB=tempo_staging_previous
DUMP_PATH=/tmp/tempo-staging-refresh.dump
HEALTH_URLS=(http://127.0.0.1:8119/api/health http://127.0.0.1:8119/)

log() { echo "tempo-staging-refresh: $*"; }
die() {
    log "ERROR: $*" >&2
    exit 1
}

case "${1:-} ${2:-}" in
    'refresh --confirm-production-backup-refresh') MODE=refresh ;;
    'seed --confirm-seeded-reset') MODE=seed ;;
    *)
        echo "usage: $(basename "$0") refresh --confirm-production-backup-refresh | seed --confirm-seeded-reset" >&2
        exit 2
        ;;
esac

compose() { docker compose -p tempo-staging -f "$CONFIG_DIR/staging.compose.yml" --env-file "$CONFIG_DIR/staging.env" "$@"; }
psql_in() {
    local database=$1
    shift
    compose exec -T postgres psql --no-psqlrc -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$database" "$@"
}
sql() { psql_in postgres -Atc "$1" </dev/null; }
# 0 = exists, 1 = missing, 2 = could not ask postgres.
db_exists() {
    local found
    found=$(sql "SELECT 1 FROM pg_database WHERE datname = '$1'") || return 2
    [[ $found == 1 ]]
}
drop_db() { sql "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" >/dev/null; }
run_api() { compose run --rm --no-deps -T -e "DB_NAME=$TEMP_DB" -e DB_SYNCHRONIZE=false api "$@"; }
healthy() {
    local url
    for url in "${HEALTH_URLS[@]}"; do
        curl --fail --silent --show-error --max-time 10 --retry 5 --retry-delay 2 --retry-all-errors \
            --output /dev/null "$url" || return 1
    done
}

mkdir -p "$STATE_DIR"
exec 8>"$STATE_DIR/refresh.lock"
flock -n 8 || die 'another refresh is running'
# Fetched and decrypted copies live here, private to the staging user, until the run ends.
WORK=$(mktemp -d "$STATE_DIR/refresh.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT

if [[ $MODE == refresh ]]; then
    # Only these two settings are read; the file is not sourced.
    feed_setting() { if [[ -f $FEED_ENV ]]; then sed -n "s/^$1=//p" "$FEED_ENV" | tail -n 1; fi; }
    FEED=$(feed_setting STAGING_FEED)
    FEED=${FEED:-local-backups}
    STAGING_FEED_SSH=$(feed_setting STAGING_FEED_SSH)
    case $FEED in
        server-copy)
            [[ ${STAGING_FEED_SSH:-} =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]] || die "STAGING_FEED_SSH in $FEED_ENV must be user@host"
            [[ -f $FEED_SSH_DIR/id_ed25519 && -f $FEED_SSH_DIR/known_hosts ]] || die "missing $FEED_SSH_DIR/id_ed25519 or known_hosts"
            log "fetching the owner-only copy from $STAGING_FEED_SSH"
            # The server's feed account has one forced command that sends the newest copy.
            timeout 15m ssh -n -T -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20 \
                -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$FEED_SSH_DIR/known_hosts" \
                -i "$FEED_SSH_DIR/id_ed25519" "$STAGING_FEED_SSH" >"$WORK/copy.dump.gpg" || die 'could not fetch the owner-only copy'
            [[ -s $WORK/copy.dump.gpg ]] || die 'the fetched copy is empty'
            gpg --homedir "$FEED_GNUPG" --batch --no-tty --quiet --decrypt --output "$WORK/copy.dump" "$WORK/copy.dump.gpg" ||
                die 'could not decrypt the owner-only copy'
            DUMP=$WORK/copy.dump
            ;;
        local-backups)
            # Timestamped scheduled backups only; the newest sorts last.
            shopt -s nullglob
            dumps=("$BACKUP_DIR"/tempo-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump)
            ((${#dumps[@]})) || die "no tempo-YYYYMMDD-HHMMSS.dump in $BACKUP_DIR"
            DUMP=${dumps[-1]}
            ;;
        *) die "unknown STAGING_FEED '$FEED' in $FEED_ENV (server-copy or local-backups)" ;;
    esac
    [[ -f $DUMP && ! -L $DUMP && -s $DUMP ]] || die "$DUMP is not a non-empty regular file"
fi

compose up -d --wait postgres redis mailpit
DB_USER=$(compose exec -T postgres printenv POSTGRES_USER </dev/null)
DB_NAME=$(compose exec -T postgres printenv POSTGRES_DB </dev/null)
[[ $DB_USER =~ ^[A-Za-z0-9_]+$ && $DB_NAME =~ ^[A-Za-z0-9_]+$ ]] || die 'unexpected staging database user or name'
[[ $DB_NAME != "$TEMP_DB" && $DB_NAME != "$PREVIOUS_DB" && $DB_NAME != postgres ]] || die "reserved staging database name: $DB_NAME"

# After the swap has started, a failure puts the previous database back.
SWAPPING=0
restore_previous() {
    log 'the swap failed; restoring the previous database' >&2
    compose stop api web || true
    local previous=0
    db_exists "$PREVIOUS_DB" || previous=$?
    if ((previous == 2)); then
        log "ROLLBACK FAILED: could not query postgres; API and web stay stopped, old data may be in $PREVIOUS_DB" >&2
        return
    fi
    if ((previous == 0)); then
        if ! drop_db "$DB_NAME" || ! sql "ALTER DATABASE \"$PREVIOUS_DB\" RENAME TO \"$DB_NAME\"" >/dev/null; then
            log "ROLLBACK FAILED: old data is in $PREVIOUS_DB; API and web stay stopped" >&2
            return
        fi
    fi
    if compose exec -T redis redis-cli FLUSHALL </dev/null >/dev/null && compose up -d --wait api web && healthy; then
        log 'previous database restored' >&2
    else
        compose stop api web || true
        log 'previous database restored, but API and web did not come back healthy; they stay stopped' >&2
    fi
}
on_exit() {
    local status=$?
    if ((status != 0 && SWAPPING)); then restore_previous; fi
    compose exec -T postgres rm -f "$DUMP_PATH" </dev/null >/dev/null 2>&1 || true
    drop_db "$TEMP_DB" >/dev/null 2>&1 || true
    rm -rf -- "$WORK"
    exit "$status"
}
trap on_exit EXIT
# Make a signal a failure, so an interrupted swap is still rolled back.
trap 'exit 130' INT
trap 'exit 143' TERM HUP

# A run that died between the two renames leaves the live data only in $PREVIOUS_DB.
current=0
db_exists "$DB_NAME" || current=$?
((current != 2)) || die 'could not query postgres'
if ((current == 1)) && db_exists "$PREVIOUS_DB"; then
    die "$DB_NAME is missing but $PREVIOUS_DB exists (interrupted swap); rename $PREVIOUS_DB back to $DB_NAME first"
fi

drop_db "$TEMP_DB"
sql "CREATE DATABASE \"$TEMP_DB\" OWNER \"$DB_USER\"" >/dev/null
if [[ $MODE == refresh ]]; then
    log "restoring $(basename "$DUMP") from $FEED"
    compose cp "$DUMP" "postgres:$DUMP_PATH"
    compose exec -T postgres pg_restore --list "$DUMP_PATH" >/dev/null
    compose exec -T postgres pg_restore --exit-on-error --no-owner --no-privileges -U "$DB_USER" -d "$TEMP_DB" "$DUMP_PATH"
    run_api node dist/scripts/schema.js
    # Staging must never act on production bank consents.
    psql_in "$TEMP_DB" -q <<'SQL'
BEGIN;
DELETE FROM bank_sync_runs;
UPDATE bank_connections
SET "providerSessionId" = NULL,
    "authorizationStateHash" = NULL,
    status = 'EXPIRED',
    "consentValidUntil" = NULL,
    "lastSyncedAt" = NULL,
    "lastSyncError" = NULL,
    "nextSyncAt" = NULL,
    "syncStartedAt" = NULL,
    "syncStatus" = 'IDLE',
    "syncFailureCount" = 0,
    "updatedAt" = NOW();
COMMIT;
SQL
    left=$(psql_in "$TEMP_DB" -Atc 'SELECT (SELECT count(*) FROM bank_connections WHERE "providerSessionId" IS NOT NULL OR "authorizationStateHash" IS NOT NULL) + (SELECT count(*) FROM bank_sync_runs)')
    [[ $left == 0 ]] || die 'provider sessions or sync runs survived sanitizing'
    if [[ $FEED == server-copy ]]; then
        accounts=$(psql_in "$TEMP_DB" -Atc 'SELECT count(*) FROM accounts')
        [[ $accounts == 1 ]] || die "the owner-only copy holds $accounts accounts"
    fi
else
    log 'creating a seeded database'
    run_api node dist/scripts/schema.js
    run_api node dist/scripts/seed.js
fi

log 'swapping the staging database'
drop_db "$PREVIOUS_DB"
SWAPPING=1
compose stop api web
sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid()" >/dev/null
if db_exists "$DB_NAME"; then sql "ALTER DATABASE \"$DB_NAME\" RENAME TO \"$PREVIOUS_DB\"" >/dev/null; fi
sql "ALTER DATABASE \"$TEMP_DB\" RENAME TO \"$DB_NAME\"" >/dev/null
compose exec -T redis redis-cli FLUSHALL </dev/null >/dev/null
compose up -d --wait api web
healthy || die 'staging is unhealthy after the swap'
SWAPPING=0
drop_db "$PREVIOUS_DB"
log 'staging database replaced'
