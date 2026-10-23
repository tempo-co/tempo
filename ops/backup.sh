#!/usr/bin/env bash
# Tempo production DB backup: validated custom-format pg_dump, keep the newest $KEEP.
#
#   BACKUP_DIR=<dir> [KEEP=<n>] backup.sh
#
# The backup timer and the pre-deploy hook set their own directories (see install.sh).
set -Eeuo pipefail
umask 077

BACKUP_DIR=${BACKUP_DIR:?BACKUP_DIR must be set}
LOG="$BACKUP_DIR/backup.log"
KEEP=${KEEP:-7}
[[ $KEEP =~ ^[1-9][0-9]*$ ]] || { printf 'ERROR: KEEP must be a positive integer\n' >&2; exit 1; }
MIN_FREE_BYTES=$((1024 * 1024 * 1024)) # refuse to run if host free space < 1 GiB
CONTAINER="tempo-api-production-postgres-1"
DB_USER="tempo"
DB_NAME="tempo"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/tempo-$STAMP.dump"
TEMP_FILE=''

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
fail() { log "FAIL $*"; exit 1; }
cleanup() {
    if [[ -n $TEMP_FILE && -e $TEMP_FILE ]]; then
        rm -f -- "$TEMP_FILE"
    fi
}
trap cleanup EXIT

[[ ! -L $BACKUP_DIR ]] || { printf 'ERROR: backup directory must not be a symlink\n' >&2; exit 1; }
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
touch -- "$LOG"
chmod 600 -- "$LOG"

# 1) Free-space guard: never let backups fill a small disk.
free_bytes=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
[[ $free_bytes =~ ^[0-9]+$ ]] || fail 'could not determine free disk space'
if (( free_bytes < MIN_FREE_BYTES )); then
    fail "skipped: only ${free_bytes} bytes free on / (need >= ${MIN_FREE_BYTES})"
fi

[[ ! -e $TARGET ]] || fail "timestamped backup already exists: $TARGET"
TEMP_FILE=$(mktemp "$BACKUP_DIR/.tempo-$STAMP.XXXXXX.tmp")

# 2) Dump to a private temporary file. Custom format is compressed by pg_dump.
if ! docker exec "$CONTAINER" pg_dump --format=custom -U "$DB_USER" "$DB_NAME" > "$TEMP_FILE"; then
    fail "pg_dump failed for database $DB_NAME"
fi
size=$(stat -c%s -- "$TEMP_FILE")
(( size >= 1000 )) || fail "suspiciously small archive ($size bytes)"

# Read the archive table of contents with the PostgreSQL tools in the same image.
if ! docker exec -i "$CONTAINER" pg_restore --list < "$TEMP_FILE" >/dev/null; then
    fail 'custom-format archive validation failed'
fi

# 3) Publish atomically only after dump and archive validation succeed.
mv -T -- "$TEMP_FILE" "$TARGET"
TEMP_FILE=''
log "OK $TARGET ($size bytes)"

# 4) Retain the newest $KEEP timestamped archives.
python3 - "$BACKUP_DIR" "$KEEP" "$LOG" <<'PY'
from datetime import datetime
from pathlib import Path
import re
import sys

backup_dir = Path(sys.argv[1])
keep = int(sys.argv[2])
log_path = Path(sys.argv[3])
archives = [
    path
    for path in backup_dir.iterdir()
    # Only timestamped archives; manual dumps such as tempo-pre-<reason>-*.dump are never pruned.
    if re.fullmatch(r'tempo-\d{8}-\d{6}\.dump', path.name)
    and path.is_file()
    and not path.is_symlink()
]
archives.sort(key=lambda path: (path.stat().st_mtime_ns, path.name), reverse=True)
with log_path.open('a', encoding='utf-8') as log:
    stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for old in archives[keep:]:
        old.unlink()
        log.write(f'{stamp} PRUNED {old}\n')
PY
