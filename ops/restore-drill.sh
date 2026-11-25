#!/usr/bin/env bash
# Wisp restore drill: restore the newest off-site snapshot into a throwaway PostgreSQL container
# and check that every live table is there, answers, and holds about as many rows as live.
#
#   RESTIC_REPOSITORY=<repo> RESTIC_PASSWORD=<password> \
#   DRILL_ROW_TOLERANCE_PERCENT=<n> DRILL_ROW_TOLERANCE_ROWS=<n> restore-drill.sh
#
# A table passes when its restored row count is within the larger of the two tolerances of the
# live count (rows written since the snapshot). Exits 1 on any failure, for the failure email.
set -Eeuo pipefail
umask 077

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set}" "${RESTIC_PASSWORD:?RESTIC_PASSWORD must be set}"
PERCENT=${DRILL_ROW_TOLERANCE_PERCENT:?DRILL_ROW_TOLERANCE_PERCENT must be set}
ROWS=${DRILL_ROW_TOLERANCE_ROWS:?DRILL_ROW_TOLERANCE_ROWS must be set}
[[ $PERCENT =~ ^[0-9]+$ && $ROWS =~ ^[0-9]+$ ]] || { echo 'ERROR: the row tolerances must be whole numbers' >&2; exit 1; }
LIVE=wisp-production-postgres-1
DRILL=wisp-restore-drill
DRILL_DB=wisp_drill
WORK=$(mktemp -d "${TMPDIR:-/tmp}/wisp-restore-drill.XXXXXX")

log() { echo "restore-drill: $*"; }
die() {
    log "restore drill FAILED: $*" >&2
    exit 1
}
cleanup() {
    docker rm -f -v "$DRILL" >/dev/null 2>&1 || true
    rm -rf -- "$WORK"
}
trap cleanup EXIT

live_sql() { docker exec "$LIVE" psql -U wisp -d wisp -AtX -v ON_ERROR_STOP=1 -c "$1"; }
drill_sql() { docker exec "$DRILL" psql -U postgres -d "$DRILL_DB" -AtX -v ON_ERROR_STOP=1 -c "$1"; }
TABLES_SQL="select quote_ident(schemaname) || '.' || quote_ident(tablename) from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') order by 1"

# 1) The newest snapshot, as the backup uploaded it.
restic dump --retry-lock 15m --host wisp-production --tag wisp-db latest /wisp.dump >"$WORK/wisp.dump" ||
    die 'could not read the newest snapshot from the restic repository'

# 2) A throwaway server from the live PostgreSQL image: no network, random password, removed on exit.
image=$(docker inspect --format '{{.Config.Image}}' "$LIVE") || die "no running $LIVE container"
docker rm -f -v "$DRILL" >/dev/null 2>&1 || true
password=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
docker run -d --name "$DRILL" --network none -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$DRILL_DB" \
    "$image" >/dev/null || die 'could not start the throwaway database'
# The image's init server listens on the socket only; TCP answers once the real server runs.
for _ in $(seq 60); do
    docker exec "$DRILL" pg_isready -q -h 127.0.0.1 -U postgres && break
    sleep 1
done
docker exec "$DRILL" pg_isready -q -h 127.0.0.1 -U postgres || die 'the throwaway database did not start'

docker exec -i "$DRILL" pg_restore --exit-on-error --no-owner --no-privileges -U postgres -d "$DRILL_DB" \
    <"$WORK/wisp.dump" || die 'the snapshot did not restore'

# 3) Every live table answers in the restored copy with a plausible row count.
mapfile -t tables < <(live_sql "$TABLES_SQL") || die 'could not list the live tables'
((${#tables[@]})) || die 'the live database has no tables'
problems=0
for table in "${tables[@]}"; do
    if ! restored=$(drill_sql "select count(*) from $table" 2>"$WORK/error"); then
        if grep -q 'does not exist' "$WORK/error"; then
            log "$table: missing from the restored database"
        else
            log "$table: does not answer ($(head -n 1 "$WORK/error"))"
        fi
        problems=$((problems + 1))
        continue
    fi
    live=$(live_sql "select count(*) from $table") || die "could not count the live rows of $table"
    allowed=$((live * PERCENT / 100))
    ((allowed > ROWS)) || allowed=$ROWS
    drift=$((live - restored))
    ((drift >= 0)) || drift=$((-drift))
    if ((drift > allowed)); then
        log "$table: $restored restored, $live live (more than $allowed apart)"
        problems=$((problems + 1))
    else
        log "$table: $restored restored, $live live"
    fi
done
((problems == 0)) || die "$problems of ${#tables[@]} tables failed"
log "restore drill passed: ${#tables[@]} tables"
