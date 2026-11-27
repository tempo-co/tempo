#!/usr/bin/env bash
# Build staging's owner-only copy: restore the newest local backup into a throwaway PostgreSQL container, cut it down to
# the owner's account with the running API image's wisp-staging-copy.sql, dump it and encrypt it to staging's public key.
#
#   DUMP_DIR=<dir> OUTBOX=<dir> [KEEP=<n>] STAGING_COPY_OWNER_ACCOUNT_ID=<uuid> STAGING_COPY_RECIPIENT_FILE=<key.asc> \
#       wisp-staging-copy.sh
#
# The server only ever holds staging's public key: a recipient file holding a secret key is refused. Writes
# wisp-staging-copy-<YYYYMMDD-HHMMSS>.dump.gpg into OUTBOX (group-readable for the staging feed account) and keeps the
# newest KEEP. Exits 1 on any failure, for the failure email.
set -Eeuo pipefail
umask 077

DUMP_DIR=${DUMP_DIR:?DUMP_DIR must be set}
OUTBOX=${OUTBOX:?OUTBOX must be set}
KEEP=${KEEP:-3}
OWNER=${STAGING_COPY_OWNER_ACCOUNT_ID:-}
RECIPIENT=${STAGING_COPY_RECIPIENT_FILE:?STAGING_COPY_RECIPIENT_FILE must be set}
LIVE=wisp-production-postgres-1
API=wisp-production-api-1
SCRATCH=wisp-staging-copy
SCRATCH_DB=wisp_staging_copy
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/wisp-staging-copy.XXXXXX")

log() { echo "staging-copy: $*"; }
die() {
    log "staging copy FAILED: $*" >&2
    exit 1
}
cleanup() {
    docker rm -f -v "$SCRATCH" >/dev/null 2>&1 || true
    rm -rf -- "$WORK"
    rm -f -- "$OUTBOX"/.wisp-staging-copy-*.tmp
}
trap cleanup EXIT

[[ $KEEP =~ ^[1-9][0-9]*$ ]] || die 'KEEP must be a positive integer'
[[ $OWNER =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] ||
    die 'STAGING_COPY_OWNER_ACCOUNT_ID must be a lowercase account uuid'
[[ -d $OUTBOX && ! -L $OUTBOX ]] || die "$OUTBOX is not a directory"

# 1) Staging's public key, and nothing that could decrypt the copy.
[[ -f $RECIPIENT && ! -L $RECIPIENT ]] || die "$RECIPIENT is not a regular file"
mkdir -m 700 "$WORK/gnupg"
gpg() { command gpg --homedir "$WORK/gnupg" --batch --no-tty --quiet "$@"; }
keys=$(gpg --with-colons --show-keys "$RECIPIENT") || die "$RECIPIENT is not an OpenPGP key"
! grep -q '^sec' <<<"$keys" || die "$RECIPIENT holds a secret key; the server keeps only staging's public key"
grep -q '^pub' <<<"$keys" || die "$RECIPIENT holds no public key"

# 2) The filter from the running API image: its rules match the schema that release migrated to.
FILTER=$WORK/filter.sql
docker cp "$API:/usr/src/app/wisp-staging-copy.sql" "$FILTER" >/dev/null || die "no filter in the running $API"
[[ -s $FILTER ]] || die "the filter in $API is empty"
log "filter from $(docker inspect --format '{{.Image}}' "$API")"

# 3) The newest validated scheduled backup; backup.sh publishes only dumps that passed validation.
shopt -s nullglob
dumps=("$DUMP_DIR"/wisp-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump)
((${#dumps[@]})) || die "no wisp-YYYYMMDD-HHMMSS.dump in $DUMP_DIR"
DUMP=${dumps[-1]}
[[ -f $DUMP && ! -L $DUMP && -s $DUMP ]] || die "$DUMP is not a non-empty regular file"
log "restoring $(basename "$DUMP")"

# 4) A throwaway server from the live PostgreSQL image: no network, random password, removed on exit.
image=$(docker inspect --format '{{.Config.Image}}' "$LIVE") || die "no running $LIVE container"
docker rm -f -v "$SCRATCH" >/dev/null 2>&1 || true
password=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
docker run -d --name "$SCRATCH" --network none -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$SCRATCH_DB" \
    "$image" >/dev/null || die 'could not start the throwaway database'
# The image's init server listens on the socket only; TCP answers once the real server runs.
for _ in $(seq 60); do
    docker exec "$SCRATCH" pg_isready -q -h 127.0.0.1 -U postgres && break
    sleep 1
done
docker exec "$SCRATCH" pg_isready -q -h 127.0.0.1 -U postgres || die 'the throwaway database did not start'
docker exec -i "$SCRATCH" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d "$SCRATCH_DB" \
    <"$DUMP" || die 'the backup did not restore'

# 5) Keep only the owner's account; the filter fails on any table without a rule and checks what it kept.
docker exec -i "$SCRATCH" psql --no-psqlrc -X -q -v ON_ERROR_STOP=1 -U postgres -d "$SCRATCH_DB" \
    -c "SELECT set_config('staging_copy.owner_account_id', '$OWNER', false)" -f - <"$FILTER" >/dev/null ||
    die 'the owner-only filter failed'

# 6) Dump, validate and encrypt; only the encrypted copy reaches the outbox.
docker exec "$SCRATCH" pg_dump --format=custom -U postgres "$SCRATCH_DB" >"$WORK/copy.dump" ||
    die 'could not dump the owner-only copy'
docker exec -i "$SCRATCH" pg_restore --list <"$WORK/copy.dump" >/dev/null || die 'the owner-only dump is unreadable'
TARGET=$OUTBOX/wisp-staging-copy-$STAMP.dump.gpg
[[ ! -e $TARGET ]] || die "$TARGET already exists"
TEMP=$OUTBOX/.wisp-staging-copy-$STAMP.tmp
gpg --trust-model always --recipient-file "$RECIPIENT" --output "$TEMP" --encrypt "$WORK/copy.dump" ||
    die 'could not encrypt the owner-only copy'
chmod 640 -- "$TEMP"
mv -T -- "$TEMP" "$TARGET"
log "OK $TARGET ($(stat -c%s -- "$TARGET") bytes)"

# 7) Keep the newest $KEEP copies.
copies=("$OUTBOX"/wisp-staging-copy-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump.gpg)
if ((${#copies[@]} > KEEP)); then
    for old in "${copies[@]:0:${#copies[@]}-KEEP}"; do
        rm -f -- "$old"
        log "PRUNED $old"
    done
fi
